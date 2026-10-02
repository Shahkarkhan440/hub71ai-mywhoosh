from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
import math
import re
import unicodedata
import uuid

from app.catalog import CATALOG, PROFILE, VENDORS, cart_item, cheapest_offer, product_matches
from app.address_validator import validate_address
from app.delivery_time_parser import delivery_time_payload, parse_delivery_time
from app.intent_parser import classify_stage_intent
from app.order_store import save_order
from app.product_matcher import grouped_model_matches


YES = {
    "yes", "y", "yeah", "yep", "yup", "confirm", "confirmed", "okay", "ok",
    "sure", "proceed", "go ahead", "place it", "do it", "sounds good", "looks good",
}
NO = {"no", "n", "nope", "nah", "change", "not now", "cancel"}
OUT_OF_SCOPE_REPLY = (
    "I can only help with grocery shopping in Abu Dhabi."
)

SPOKEN_NUMBERS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20",
}

CATALOG_GROUPS = {
    "fruits": {
        "triggers": ("fruit", "fruits"),
        "categories": {"bananas", "apples", "strawberries"},
    },
    "vegetables": {
        "triggers": ("vegetable", "vegetables", "veggie", "veggies"),
        "categories": {"tomatoes", "onions"},
    },
    "dairy": {
        "triggers": ("dairy", "dairy products"),
        "categories": {"eggs", "milk", "yogurt"},
    },
    "pantry": {
        "triggers": ("pantry", "pantry items", "staples"),
        "categories": {"rice", "oil", "tea"},
    },
    "drinks": {
        "triggers": ("drink", "drinks", "beverage", "beverages"),
        "categories": {"water", "milk", "tea"},
    },
    "bakery": {
        "triggers": ("bakery", "bakery items"),
        "categories": {"bread"},
    },
    "meat": {
        "triggers": ("meat", "meats"),
        "categories": {"chicken"},
    },
    "household": {
        "triggers": ("household", "cleaning", "cleaning products"),
        "categories": {"detergent"},
    },
}


def _numbers_in_text(text: str) -> list[str]:
    numbers = re.findall(r"\d+(?:\.\d+)?", text)
    lowered = text.casefold()
    numbers.extend(
        value
        for word, value in SPOKEN_NUMBERS.items()
        if re.search(rf"\b{word}\b", lowered)
    )
    return numbers


def _is_yes(text: str) -> bool:
    normalized = text.casefold().strip(" .!?")
    return normalized in YES or normalized.startswith(("yes ", "confirm ", "use it", "keep it"))


def _is_no(text: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
    return normalized in NO or normalized.startswith(("no ", "nope", "nah", "not now", "change "))


def _is_greeting(text: str) -> bool:
    normalized = re.sub(r"[^a-z\s]", "", text.casefold()).strip()
    words = normalized.split()
    greeting_words = {
        "hi", "hello", "hey", "there", "good", "morning", "afternoon", "evening",
        "salam", "salaam", "assalamu", "alaikum", "marhaba",
    }
    greeting_core = {"hi", "hello", "hey", "morning", "afternoon", "evening", "salam", "salaam", "marhaba"}
    return bool(words) and all(word in greeting_words for word in words) and any(word in greeting_core for word in words)


def _wants_cart_review(text: str) -> bool:
    """Recognize navigation commands before treating the message as a product query."""
    normalized = re.sub(r"[^a-z0-9']+", " ", text.casefold()).strip()
    direct_phrases = (
        "that's all",
        "that is all",
        "that's everything",
        "that is everything",
        "nothing else",
        "no more",
        "all done",
        "go ahead",
        "move on",
        "proceed",
        "continue",
        "checkout",
        "check out",
        "finish",
        "finalize",
    )
    if any(re.search(rf"\b{re.escape(phrase)}\b", normalized) for phrase in direct_phrases):
        return True
    return bool(
        re.search(r"\b(?:review|show|open|finish|finalize|complete)\b.*\bcart\b", normalized)
        or re.search(r"\bcart\b.*\b(?:review|checkout|check out)\b", normalized)
    )


@dataclass
class Session:
    id: str
    mode: str = "express"
    stage: str = "collect_items"
    cart: list[dict] = field(default_factory=list)
    pending_products: list[dict] = field(default_factory=list)
    pending_categories: list[tuple[str, list[dict]]] = field(default_factory=list)
    pending_request_text: str = ""
    pending_quantity_product: dict | None = None
    pending_quantity_category: str | None = None
    pending_cart_edit_product: dict | None = None
    cart_edit_return_stage: str | None = None
    pending_notice: str | None = None
    address: str | None = None
    selected_address_id: str | None = None
    instructions: str | None = None
    phone: str | None = None
    delivery_time: dict | None = None
    payment_id: str | None = None
    selected_payment_method: dict | None = None
    match_source: str | None = None
    collecting_more: bool = False
    history: list[dict] = field(default_factory=list)
    order: dict | None = None


class GroceryAgent:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    def new_session(self, mode: str | None = None) -> Session:
        session = Session(id=str(uuid.uuid4()))
        self.sessions[session.id] = session
        return session

    def get_or_create(self, session_id: str | None, mode: str | None) -> Session:
        session = self.sessions.get(session_id) if session_id else None
        if session is None:
            return self.new_session(mode)
        return session

    def record_user_message(self, session: Session, message: str) -> None:
        session.history.append(
            {
                "role": "user",
                "content": message,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def respond(self, session: Session, message: str) -> dict:
        text = message.strip()

        if _is_greeting(text):
            return self._greeting_reply(session)

        if session.stage == "collect_items":
            return self._collect(session, text)
        if session.stage == "clarify_product":
            return self._clarify_product(session, text)
        if session.stage == "clarify_quantity":
            return self._clarify_quantity(session, text)
        if session.stage == "edit_cart_quantity":
            return self._complete_cart_quantity_edit(session, text)
        if session.stage == "offer_more":
            return self._offer_more(session, text)
        if session.stage == "review_cart":
            cart_edit = self._handle_cart_edit(session, text, "review_cart")
            if cart_edit is not None:
                return cart_edit
            if re.search(r"\b(?:add|include|need|want)\b", text.casefold()):
                session.collecting_more = True
                return self._collect(session, text)
            intent = "affirm" if _is_yes(text) else classify_stage_intent(session.stage, text)
            if intent == "affirm":
                session.stage = "confirm_address"
                return self._ask_address(session)
            if _is_no(text) or intent == "change_cart":
                session.stage = "collect_items"
                return self._result(session, "No problem. Tell me what you want to add or change.")
            return self._result(session, "Please confirm the cart, or tell me what you want to change.", True)
        if session.stage == "confirm_address":
            return self._confirm_address(session, text)
        if session.stage == "new_address":
            check = validate_address(text)
            if check.missing_fields:
                missing = ", ".join(check.missing_fields)
                return self._result(
                    session,
                    f"Please provide the full address in one sentence, including {missing}.",
                )
            session.address = text
            session.selected_address_id = None
            session.stage = "confirm_instructions"
            return self._ask_instructions(session)
        if session.stage == "confirm_instructions":
            return self._confirm_instructions(session, text)
        if session.stage == "new_instructions":
            session.instructions = "No special instructions" if text.casefold() in {"none", "no instructions"} else text
            session.stage = "confirm_phone"
            return self._ask_phone(session)
        if session.stage == "confirm_phone":
            return self._confirm_phone(session, text)
        if session.stage == "new_phone":
            digits = re.sub(r"\D", "", text)
            if len(digits) not in {10, 12} or not (digits.startswith("05") or digits.startswith("9715")):
                return self._result(session, "Please provide a valid UAE mobile number, such as +971 50 123 4567.")
            session.phone = text.strip()
            session.stage = "confirm_delivery_time"
            return self._ask_delivery_time(session)
        if session.stage == "confirm_delivery_time":
            return self._confirm_delivery_time(session, text)
        if session.stage == "confirm_payment":
            return self._confirm_payment(session, text)
        if session.stage == "final_confirmation":
            return self._final_confirmation(session, text)
        if session.stage == "completed":
            return self._result(session, "You’re all set. Start a new order anytime.")
        if session.stage == "cancelled":
            return self._result(session, "This order was cancelled. Start a new session whenever you are ready.")
        return self._result(session, "I lost our place. Please start a new session.")

    def _greeting_reply(self, session: Session) -> dict:
        if session.stage == "collect_items":
            return self._result(session, "Hi! What groceries do you need?")
        if session.stage == "clarify_product":
            choices = " or ".join(product["size"] for product in session.pending_products)
            return self._result(session, f"Hi! Which size would you like: {choices}?")
        if session.stage == "clarify_quantity" and session.pending_quantity_product:
            return self._result(session, f"Hi! {self._quantity_prompt(session.pending_quantity_product)}")
        if session.stage == "edit_cart_quantity" and session.pending_cart_edit_product:
            return self._result(
                session,
                f"Hi! What quantity should I set for {session.pending_cart_edit_product['name']}?",
            )
        if session.stage == "offer_more":
            return self._result(session, "Hi! Anything else, or today’s deals?")
        if session.stage == "review_cart":
            return self._result(
                session,
                f"Hi! Subtotal AED {self._subtotal(session):.2f}. Continue?",
                True,
            )
        if session.stage == "confirm_address":
            return self._ask_address(session)
        if session.stage == "new_address":
            return self._result(session, "Hi! Please provide the complete delivery address in Abu Dhabi.")
        if session.stage == "confirm_instructions":
            return self._ask_instructions(session)
        if session.stage == "new_instructions":
            return self._result(session, "Hi! What delivery instruction should I use? You can also say none.")
        if session.stage == "confirm_phone":
            return self._ask_phone(session)
        if session.stage == "new_phone":
            return self._result(session, "Hi! What UAE mobile number should I use for delivery?")
        if session.stage == "confirm_delivery_time":
            return self._ask_delivery_time(session)
        if session.stage == "confirm_payment":
            return self._ask_payment(session)
        if session.stage == "final_confirmation":
            return self._result(session, "Hi! Say confirm order to place it, or cancel to stop.", True)
        if session.stage == "completed":
            return self._result(session, "Hi! Your demo order is already complete. I hope shopping felt effortless.")
        if session.stage == "cancelled":
            return self._result(session, "Hi! This order is cancelled, but I’m ready whenever you want to shop again.")
        return self._result(session, "Hi! How can I help with your grocery order?")

    def _collect(self, session: Session, text: str) -> dict:
        group_result = self._catalog_group_result(session, text)
        if group_result is not None:
            return group_result

        model_result = grouped_model_matches(text)
        if model_result is not None:
            model_matches, is_grocery_request = model_result
        else:
            model_matches, is_grocery_request = {}, True
        if model_matches:
            grouped = model_matches
            session.match_source = "openai"
        else:
            grouped = product_matches(text)
            session.match_source = "openai" if model_result is not None else "catalog"
        if model_result is not None and not is_grocery_request:
            return self._result(session, OUT_OF_SCOPE_REPLY)
        if re.search(r"\bmilkshakes?\b", text.casefold()):
            grouped.pop("milk", None)
            if grouped:
                session.pending_notice = (
                    "Milkshake isn’t available in the demo catalog. If you meant fresh milk, you can add milk next."
                )
            else:
                return self._result(
                    session,
                    "Milkshake isn’t available in the demo catalog. I can help with fresh milk if that’s what you meant.",
                )
        if not grouped:
            return self._result(session, "I couldn't find those items in the demo catalog. Try eggs, milk, bread, rice, bananas, chicken, water, yogurt, vegetables, oil, tea, or detergent.")

        for category, products in list(grouped.items()):
            explicit = self._explicit_product(category, products, text)
            if explicit is not None:
                grouped[category] = [explicit]
        session.pending_request_text = text
        session.pending_categories = list(grouped.items())
        return self._consume_categories(session)

    def _catalog_group_result(self, session: Session, text: str) -> dict | None:
        """List relevant catalog products instead of guessing one from a broad category."""
        lowered = text.casefold()
        names_a_catalog_group = any(
            re.search(rf"(?<!\w){re.escape(trigger)}(?!\w)", lowered)
            for group in CATALOG_GROUPS.values()
            for trigger in group["triggers"]
        )
        asks_for_catalog = bool(
            re.search(r"\b(?:category|categories)\b", lowered)
            or re.search(r"\bwhat\b.*\b(?:products|items|groceries)\b.*\b(?:have|available|sell)\b", lowered)
            or re.search(r"\b(?:show|list)\b.*\b(?:products|items|groceries)\b", lowered)
        ) and not names_a_catalog_group
        if asks_for_catalog:
            categories = []
            for group_name, group in CATALOG_GROUPS.items():
                products = [
                    product
                    for product in CATALOG["products"]
                    if product["category"] in group["categories"]
                ]
                categories.append(
                    {
                        "name": group_name,
                        "product_count": len(products),
                        "in_stock_count": sum(
                            product.get("available_quantity", 1) > 0 for product in products
                        ),
                    }
                )
            names = ", ".join(category["name"] for category in categories)
            return self._result(
                session,
                f"I have {names}. Which category would you like?",
                available_categories=categories,
            )

        for group_name, group in CATALOG_GROUPS.items():
            trigger_match = next(
                (
                    re.search(rf"(?<!\w){re.escape(trigger)}(?!\w)", lowered)
                    for trigger in sorted(group["triggers"], key=len, reverse=True)
                    if re.search(rf"(?<!\w){re.escape(trigger)}(?!\w)", lowered)
                ),
                None,
            )
            if trigger_match is None:
                continue

            products = [
                product
                for product in CATALOG["products"]
                if product["category"] in group["categories"]
            ]
            specific_terms = {
                term.casefold()
                for product in products
                for term in (product["category"], *product.get("aliases", []))
            }
            if any(
                re.search(rf"(?<!\w){re.escape(term)}(?!\w)", lowered)
                for term in specific_terms
            ):
                continue

            if group_name == "fruits":
                words_before = re.findall(r"[a-z]+", lowered[: trigger_match.start()])
                preceding_word = words_before[-1] if words_before else None
                if preceding_word not in {
                    None, "a", "any", "assorted", "buy", "fresh", "mixed", "more",
                    "list", "me", "need", "order", "show", "some", "the", "want",
                }:
                    continue

            product_cards = []
            available_names = []
            unavailable_names = []
            duplicate_names = {
                product["name"]
                for product in products
                if sum(candidate["name"] == product["name"] for candidate in products) > 1
            }
            for product in products:
                offer = cheapest_offer(product)
                in_stock = product.get("available_quantity", 1) > 0
                display_name = (
                    f"{product['name']} {product['size']}"
                    if product["name"] in duplicate_names
                    else product["name"]
                )
                product_cards.append(
                    {
                        "product_id": product["id"],
                        "name": product["name"],
                        "category": product["category"],
                        "size": product["size"],
                        "in_stock": in_stock,
                        "available_quantity": product.get("available_quantity"),
                        "starting_price": offer["price"],
                        "currency": CATALOG["currency"],
                        "vendor_name": VENDORS[offer["vendor"]]["name"],
                        "promotion": offer.get("promotion"),
                    }
                )
                (available_names if in_stock else unavailable_names).append(display_name)

            reply = f"Available {group_name}: {', '.join(available_names)}."
            if unavailable_names:
                reply += f" {', '.join(unavailable_names)} are out of stock."
            reply += " Which would you like?"
            return self._result(
                session,
                reply,
                available_products=product_cards,
                catalog_group=group_name,
            )
        return None

    def _explicit_product(self, category: str, products: list[dict], text: str) -> dict | None:
        """Select a variant only when the shopper actually supplied its size."""
        lowered = text.casefold()
        if category == "eggs" and "dozen" in lowered:
            return next((product for product in products if product["id"] == "eggs-15"), None)
        numbers = _numbers_in_text(text)
        for product in products:
            if any(number in product["size"] for number in numbers):
                return product
        return None

    def _consume_categories(self, session: Session) -> dict:
        while session.pending_categories:
            category, products = session.pending_categories.pop(0)
            available_products = [
                product for product in products if product.get("available_quantity", 1) > 0
            ]
            if not available_products:
                names = ", ".join(dict.fromkeys(product["name"] for product in products))
                verb = "are" if names.casefold().endswith("s") else "is"
                stock_notice = f"Sorry, {names} {verb} currently out of stock."
                session.pending_notice = (
                    f"{session.pending_notice} {stock_notice}" if session.pending_notice else stock_notice
                )
                continue
            products = available_products
            if len(products) > 1:
                session.pending_products = products
                session.stage = "clarify_product"
                choices = " or ".join(product["size"] for product in products)
                return self._result(session, f"For {category}, would you like {choices}?")
            quantity_result = self._queue_or_add_quantity(session, category, products[0])
            if quantity_result is not None:
                return quantity_result

        if not session.cart:
            session.stage = "collect_items"
            return self._result(session, "What else would you like?")

        session.stage = "offer_more"
        if session.collecting_more:
            session.collecting_more = False
            reply = "Added. Anything else, or review cart?"
        else:
            reply = "Added. Anything else, or today’s deals?"
        return self._result(session, reply)

    def _offer_more(self, session: Session, text: str) -> dict:
        lowered = text.casefold().strip(" .!?")
        cart_edit = self._handle_cart_edit(session, text, "offer_more")
        if cart_edit is not None:
            return cart_edit
        if "deal" in lowered or "offer" in lowered or "promotion" in lowered:
            deals = self._available_deals()
            names = ", ".join(f"{deal['name']} {deal['size']}" for deal in deals[:3])
            return self._result(
                session,
                f"Today’s deals include {names}. Tell me what to add, or say that’s all.",
                available_deals=deals,
            )
        if lowered == "cancel":
            session.stage = "cancelled"
            return self._result(session, "Order cancelled.")
        if _is_no(text) or _wants_cart_review(text):
            session.stage = "review_cart"
            reply = f"Subtotal: AED {self._subtotal(session):.2f}. Continue?"
            return self._result(session, reply, True)
        if _is_yes(text):
            return self._result(session, "What else would you like to add?")
        session.collecting_more = True
        return self._collect(session, text)

    def _cart_items_mentioned(self, session: Session, text: str) -> list[dict]:
        grouped = product_matches(text)
        if not grouped:
            model_result = grouped_model_matches(text)
            if model_result is not None:
                grouped = model_result[0]
        categories = set(grouped)
        product_ids = {
            product["id"]
            for products in grouped.values()
            for product in products
        }
        catalog_by_id = {product["id"]: product for product in CATALOG["products"]}
        matched = [
            item
            for item in session.cart
            if item["product_id"] in product_ids
            or catalog_by_id[item["product_id"]]["category"] in categories
        ]
        if not matched and len(session.cart) == 1 and re.search(r"\b(?:it|this item|that item)\b", text.casefold()):
            return [session.cart[0]]
        return matched

    def _handle_cart_edit(self, session: Session, text: str, return_stage: str) -> dict | None:
        lowered = text.casefold()
        remove_requested = bool(re.search(r"\b(?:remove|delete|drop|take out|get rid of)\b", lowered))
        update_requested = bool(re.search(r"\b(?:update|change|set|make)\b", lowered)) and bool(
            re.search(r"\b(?:quantity|amount|packs?|packets?|bottles?|kg|kilograms?|items?|to)\b|\d", lowered)
        )
        if not remove_requested and not update_requested:
            return None

        matched = self._cart_items_mentioned(session, text)
        if not matched:
            return self._result(session, "Which item in your cart would you like to change?")
        if len(matched) > 1:
            names = ", ".join(item["name"] for item in matched)
            return self._result(session, f"I found multiple matching items: {names}. Which one should I change?")

        item = matched[0]
        if remove_requested:
            session.cart.remove(item)
            if not session.cart:
                session.stage = "collect_items"
                return self._result(session, f"Removed {item['name']}. Your cart is empty. What would you like to add?")
            return self._cart_edit_result(session, return_stage, f"Removed {item['name']}.")

        product = next(product for product in CATALOG["products"] if product["id"] == item["product_id"])
        quantity = self._edit_quantity(product, text)
        if quantity is None:
            session.pending_cart_edit_product = product
            session.cart_edit_return_stage = return_stage
            session.stage = "edit_cart_quantity"
            return self._result(session, f"What quantity should I set for {item['name']}?")
        if quantity < 1 or quantity > 20:
            return self._result(session, "Please choose a quantity between 1 and 20.")
        item["quantity"] = quantity
        return self._cart_edit_result(session, return_stage, f"Updated {item['name']} to {quantity}.")

    def _edit_quantity(self, product: dict, text: str) -> int | None:
        quantity = self._quantity_from_text(product["category"], product, text)
        if quantity is not None:
            return quantity
        number_words = {
            "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
            "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        }
        match = re.search(
            r"\b(?:to|quantity\s*(?:to|is|=)?|amount\s*(?:to|is|=)?)\s*"
            r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b",
            text.casefold(),
        )
        if not match:
            return None
        return int(number_words.get(match.group(1), match.group(1)))

    def _complete_cart_quantity_edit(self, session: Session, text: str) -> dict:
        product = session.pending_cart_edit_product
        if product is None:
            session.stage = "review_cart"
            return self._result(session, "Which cart item would you like to update?", True)
        quantity = self._edit_quantity(product, text)
        if quantity is None:
            quantity = self._quantity_from_text(product["category"], product, text, allow_bare_number=True)
        if quantity is None or quantity < 1 or quantity > 20:
            return self._result(session, "Please choose a clear quantity between 1 and 20.")
        item = next(item for item in session.cart if item["product_id"] == product["id"])
        item["quantity"] = quantity
        return_stage = session.cart_edit_return_stage or "review_cart"
        session.pending_cart_edit_product = None
        session.cart_edit_return_stage = None
        return self._cart_edit_result(session, return_stage, f"Updated {item['name']} to {quantity}.")

    def _cart_edit_result(self, session: Session, return_stage: str, prefix: str) -> dict:
        session.stage = return_stage
        subtotal = self._subtotal(session)
        if return_stage == "review_cart":
            return self._result(
                session,
                f"{prefix} The updated subtotal is AED {subtotal:.2f}. Is the cart correct now?",
                True,
            )
        return self._result(
            session,
            f"{prefix} The updated subtotal is AED {subtotal:.2f}. Anything else, or shall I review the cart?",
        )

    def _available_deals(self) -> list[dict]:
        deals = []
        for product in CATALOG["products"]:
            for offer in product["offers"]:
                if offer.get("promotion"):
                    deals.append(
                        {
                            "product_id": product["id"],
                            "name": product["name"],
                            "size": product["size"],
                            "vendor_name": VENDORS[offer["vendor"]]["name"],
                            "price": offer["price"],
                            "promotion": offer["promotion"],
                        }
                    )
        return deals

    def _clarify_product(self, session: Session, text: str) -> dict:
        selected = None
        numbers = _numbers_in_text(text)
        for product in session.pending_products:
            if product["size"].casefold() in text.casefold() or any(number in product["size"] for number in numbers):
                selected = product
                break
        if selected is None and ("cheap" in text.casefold() or "any" in text.casefold()):
            selected = min(session.pending_products, key=lambda product: cheapest_offer(product)["price"])
        if selected is None:
            choices = ", ".join(product["size"] for product in session.pending_products)
            return self._result(session, f"Please choose one of these sizes: {choices}.")
        session.pending_products = []
        category = selected["category"]
        quantity = self._quantity_from_text(category, selected, session.pending_request_text)
        if quantity is None:
            quantity = self._quantity_from_text(category, selected, text, allow_bare_number=True)
        if quantity is None:
            session.pending_quantity_product = selected
            session.pending_quantity_category = category
            session.stage = "clarify_quantity"
            return self._result(session, self._quantity_prompt(selected))
        self._add_product(session, selected, text, quantity=quantity)
        return self._consume_categories(session)

    def _queue_or_add_quantity(self, session: Session, category: str, product: dict) -> dict | None:
        quantity = self._quantity_from_text(category, product, session.pending_request_text)
        if quantity is None:
            session.pending_quantity_product = product
            session.pending_quantity_category = category
            session.stage = "clarify_quantity"
            return self._result(session, self._quantity_prompt(product))
        self._add_product(session, product, quantity=quantity)
        return None

    def _clarify_quantity(self, session: Session, text: str) -> dict:
        product = session.pending_quantity_product
        category = session.pending_quantity_category
        if product is None or category is None:
            session.stage = "collect_items"
            return self._result(session, "Tell me which grocery item and amount you need.")
        quantity = self._quantity_from_text(category, product, text, allow_bare_number=True)
        if quantity is None or quantity < 1 or quantity > 20:
            return self._result(session, f"Please give a clear amount. {self._quantity_prompt(product)}")
        self._add_product(session, product, quantity=quantity)
        session.pending_quantity_product = None
        session.pending_quantity_category = None
        return self._consume_categories(session)

    def _quantity_prompt(self, product: dict) -> str:
        category = product["category"]
        if category in {"bananas", "chicken", "rice", "yogurt", "tomatoes", "onions", "apples", "detergent"}:
            if product["size"] == "1 kg":
                return f"How many kilograms of {product['name'].lower()} would you like? For example, 1 kilogram or 2 kilograms."
            return f"How many {product['size']} packs of {product['name'].lower()} would you like?"
        if category == "bread":
            return f"How many {product['size']} loaves of bread would you like?"
        if category == "milk":
            return f"How many {product['size']} milk packs would you like?"
        if category == "oil":
            return f"How many {product['size']} bottles of oil would you like?"
        return f"How many {product['size']} packs of {product['name'].lower()} would you like?"

    def _quantity_from_text(
        self,
        category: str,
        product: dict,
        text: str,
        allow_bare_number: bool = False,
    ) -> int | None:
        lowered = text.casefold()
        parts = re.split(r"\s*(?:,|;|\band\b|\bplus\b)\s*", lowered)
        terms = [category, *product.get("aliases", [])]
        matching_part = next(
            (
                part
                for part in parts
                if any(re.search(rf"\b{re.escape(term.casefold())}\b", part) for term in terms)
            ),
            None,
        )
        if matching_part:
            lowered = matching_part
        if category == "eggs" and "dozen" in lowered:
            return 1

        number_words = {
            "one": 1, "a": 1, "an": 1, "another": 1, "two": 2, "three": 3, "four": 4,
            "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        }
        number_pattern = r"(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|another|a|an)"

        def number_value(raw: str) -> float:
            return float(number_words.get(raw, raw))

        sized_package_match = re.search(
            rf"\b{number_pattern}\s+\d+(?:\.\d+)?\s*(?:kg|g|l|litres?|liters?)\s*"
            r"(?:[a-z]+\s+){0,3}(?:packs?|packets?|bottles?|bags?|cartons?)\b",
            lowered,
        )
        if sized_package_match:
            return int(number_value(sized_package_match.group(1)))

        package_match = re.search(
            rf"\b{number_pattern}\s*(packs?|packets?|bottles?|loaf|loaves|boxes?|bags?|trays?|cartons?)\b",
            lowered,
        )
        if package_match:
            value = int(number_value(package_match.group(1)))
            size_number = re.match(r"\d+", product["size"])
            if category == "eggs" and size_number and value == int(size_number.group()):
                return 1
            return value

        unit_match = re.search(
            rf"\b{number_pattern}\s*(kg|kgs|kilos?|kilograms?|cages?|key\s+gee|g|grams?|l|litres?|liters?)\b",
            lowered,
        )
        if unit_match:
            requested = number_value(unit_match.group(1))
            requested_unit = unit_match.group(2)
            base_match = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|l)", product["size"].casefold())
            if not base_match:
                return None
            base = float(base_match.group(1))
            base_unit = base_match.group(2)
            if requested_unit.startswith("gram") or requested_unit == "g":
                requested /= 1000
                requested_unit = "kg"
            elif requested_unit.startswith(("litre", "liter")):
                requested_unit = "l"
            elif requested_unit.startswith("kilogram") or requested_unit in {
                "kg", "kgs", "kilo", "kilos", "cage", "cages", "key gee",
            }:
                requested_unit = "kg"
            if requested_unit != base_unit:
                return None
            units = requested / base
            return int(units) if units >= 1 and math.isclose(units, round(units)) else None

        category_terms = [category, *product.get("aliases", [])]
        for term in sorted(category_terms, key=len, reverse=True):
            match = re.search(rf"\b{number_pattern}\s+(?:of\s+)?{re.escape(term.casefold())}\b", lowered)
            if match:
                value = int(number_value(match.group(1)))
                size_number = re.match(r"\d+", product["size"])
                if category == "eggs" and size_number and value == int(size_number.group()):
                    return 1
                return value

        normalized_size = re.sub(r"\s+", "", product["size"].casefold())
        if normalized_size in re.sub(r"\s+", "", lowered):
            return 1
        if allow_bare_number:
            bare = re.fullmatch(r"\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*", lowered)
            if bare:
                return int(number_value(bare.group(1)))
            mentioned_numbers = re.findall(
                r"\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b",
                lowered,
            )
            if len(mentioned_numbers) == 1:
                return int(number_value(mentioned_numbers[0]))
        return None

    def _add_product(
        self,
        session: Session,
        product: dict,
        preference_text: str = "",
        quantity: int = 1,
    ) -> None:
        offers = product["offers"]
        selected_offer = cheapest_offer(product)
        lowered = preference_text.casefold()
        for offer in offers:
            if offer["brand"].casefold() in lowered:
                selected_offer = offer
                break
        new_item = cart_item(product, selected_offer)
        existing = next((item for item in session.cart if item["product_id"] == new_item["product_id"]), None)
        if existing:
            existing["quantity"] += quantity
        else:
            new_item["quantity"] = quantity
            session.cart.append(new_item)

    def _ask_address(self, session: Session) -> dict:
        home = next(
            (address for address in PROFILE["addresses"] if address["id"] == "home"),
            None,
        )
        if home:
            return self._result(
                session,
                f"Use your Home address at {home['address']}?",
                True,
            )
        session.stage = "new_address"
        return self._result(session, "I couldn’t find a saved Home address. What delivery address should I use?")

    def _confirm_address(self, session: Session, text: str) -> dict:
        lowered = text.casefold()
        selected = next(
            (
                address
                for address in PROFILE["addresses"]
                if address["id"].casefold() in lowered or address["label"].casefold() in lowered
            ),
            None,
        )
        if _is_yes(text):
            default_id = PROFILE["preferences"]["default_address_id"]
            selected = next(address for address in PROFILE["addresses"] if address["id"] == default_id)
        intent = classify_stage_intent(session.stage, text) if selected is None else "unknown"
        if selected is None and intent == "home":
            selected = next((address for address in PROFILE["addresses"] if address["id"] == "home"), None)
        if selected:
            session.selected_address_id = selected["id"]
            session.address = selected["address"]
            session.stage = "confirm_instructions"
            return self._ask_instructions(session)
        if "new" in lowered or "another" in lowered or "add address" in lowered or intent == "new_address":
            session.stage = "new_address"
            candidate = re.sub(r"^(?:please\s+)?(?:add|use)\s+(?:a\s+)?(?:new\s+)?address\s*[:,-]?\s*", "", text, flags=re.I)
            if candidate != text and candidate.strip():
                return self.respond(session, candidate)
            return self._result(session, "What is the new delivery address?")
        return self._result(session, "Say Home to use the saved address, or say new address.", True)

    def _ask_instructions(self, session: Session) -> dict:
        selected = next(
            (address for address in PROFILE["addresses"] if address["id"] == session.selected_address_id),
            None,
        )
        if selected:
            return self._result(
                session,
                f"Keep this delivery note: “{selected['delivery_instructions']}”?",
                True,
            )
        return self._result(session, "Any delivery note? You can say none.", True)

    def _confirm_instructions(self, session: Session, text: str) -> dict:
        intent = "keep_note" if _is_yes(text) else classify_stage_intent(session.stage, text)
        if intent == "keep_note":
            selected = next(
                (address for address in PROFILE["addresses"] if address["id"] == session.selected_address_id),
                None,
            )
            session.instructions = selected["delivery_instructions"] if selected else "No special instructions"
            session.stage = "confirm_phone"
            return self._ask_phone(session)
        if intent == "no_note" or text.casefold().strip(" .!?") in {"none", "no note", "no instructions"}:
            session.instructions = "No special instructions"
            session.stage = "confirm_phone"
            return self._ask_phone(session)
        if intent == "unknown" and not _is_no(text):
            return self._result(session, "Would you like to keep, update, or remove the delivery note?", True)
        session.stage = "new_instructions"
        if intent == "update_note" and not _is_no(text) and len(text) > 3 and text.casefold() not in {"update it", "change it"}:
            return self.respond(session, text)
        return self._result(session, "What delivery instruction should I use? You can also say 'none'.")

    def _ask_phone(self, session: Session) -> dict:
        return self._result(session, f"Use delivery number {PROFILE['phone']}?", True)

    def _confirm_phone(self, session: Session, text: str) -> dict:
        intent = "keep_phone" if _is_yes(text) else classify_stage_intent(session.stage, text)
        if intent == "keep_phone":
            session.phone = PROFILE["phone"]
            session.stage = "confirm_delivery_time"
            return self._ask_delivery_time(session)
        digits = re.sub(r"\D", "", text)
        if len(digits) in {10, 12} and (digits.startswith("05") or digits.startswith("9715")):
            session.phone = text.strip()
            session.stage = "confirm_delivery_time"
            return self._ask_delivery_time(session)
        if intent == "update_phone" or _is_no(text):
            session.stage = "new_phone"
            return self._result(session, "What UAE phone number should I use for delivery?")
        return self._result(session, "Would you like to keep the saved phone number or update it?", True)

    def _ask_delivery_time(self, session: Session) -> dict:
        return self._result(
            session,
            "What delivery time? For example, 6 PM or tonight.",
        )

    def _confirm_delivery_time(self, session: Session, text: str) -> dict:
        selection = parse_delivery_time(text)
        if not selection.understood:
            return self._result(session, selection.clarification)
        session.delivery_time = delivery_time_payload(selection)
        session.stage = "confirm_payment"
        return self._ask_payment(
            session,
            prefix=f"Delivery is set for {session.delivery_time['display_text']}.",
        )

    def _ask_payment(self, session: Session, prefix: str | None = None) -> dict:
        cards = " or ".join(f"{card['label']} ending {card['last4']}" for card in PROFILE["payment_methods"])
        reply = f"Choose a card: {cards}."
        if prefix:
            reply = f"{prefix} {reply}"
        return self._result(session, reply, True)

    def _confirm_payment(self, session: Session, text: str) -> dict:
        lowered = text.casefold()
        selected = self._match_payment_method(text)
        if selected is None and _is_yes(text):
            default_id = PROFILE["preferences"]["default_payment_method_id"]
            selected = next(card for card in PROFILE["payment_methods"] if card["id"] == default_id)
        if selected is None:
            intent = classify_stage_intent(session.stage, text)
            if intent == "personal_card" or "default" in lowered or "first" in lowered:
                selected = next(card for card in PROFILE["payment_methods"] if card["id"] == "visa-4242")
            elif intent == "work_card" or "second" in lowered:
                selected = next(card for card in PROFILE["payment_methods"] if card["id"] == "mastercard-4444")
        if selected is None:
            return self._ask_payment(session)
        session.payment_id = selected["id"]
        session.selected_payment_method = selected
        session.stage = "final_confirmation"
        total = self._total(session)
        return self._result(
            session,
            f"Deliver {session.delivery_time['display_text']}. Charge AED {total:.2f} to "
            f"{selected['type']} ending {selected['last4']}. Confirm order?",
            True,
        )

    def _match_payment_method(self, text: str) -> dict | None:
        lowered = text.casefold()
        normalized = "".join(
            character
            for character in unicodedata.normalize("NFKD", lowered)
            if character.isalnum()
        )
        raw_digits = "".join(re.findall(r"\d", lowered))
        spoken_digit_map = {
            "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3",
            "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
        }
        spoken_digits = "".join(
            spoken_digit_map[word]
            for word in re.findall(r"[a-z]+", lowered)
            if word in spoken_digit_map
        )
        aliases = {
            "visa-4242": {"personal", "personalcard", "mycard", "defaultcard", "nalcard", "نلکارڈ"},
            "mastercard-4444": {"work", "workcard", "companycard", "businesscard"},
        }

        candidates = []
        for card in PROFILE["payment_methods"]:
            card_forms = {
                re.sub(r"[^a-z0-9]", "", card["label"].casefold()),
                re.sub(r"[^a-z0-9]", "", card["type"].casefold()),
                card["id"].replace("-", "").casefold(),
                *aliases.get(card["id"], set()),
            }
            number_matches = (
                bool(raw_digits) and raw_digits.endswith(card["last4"])
            ) or (
                len(spoken_digits) >= 4 and spoken_digits.endswith(card["last4"])
            )
            name_matches = any(
                form and (
                    form in normalized
                    or (len(normalized) >= 5 and form.endswith(normalized))
                    or SequenceMatcher(None, normalized, form).ratio() >= 0.78
                )
                for form in card_forms
            )
            if number_matches or name_matches or lowered.strip() in card_forms:
                candidates.append(card)
        return candidates[0] if len(candidates) == 1 else None

    def _final_confirmation(self, session: Session, text: str) -> dict:
        intent = classify_stage_intent(session.stage, text) if not _is_yes(text) and not _is_no(text) else "unknown"
        if _is_no(text) or intent == "cancel":
            session.stage = "cancelled"
            return self._result(session, "Order cancelled. No charge was made.")
        if not _is_yes(text) and intent != "confirm_order":
            return self._result(session, "I need an explicit confirmation. Say 'confirm order' to place it, or 'cancel'.", True)
        saved_address = next(
            (address for address in PROFILE["addresses"] if address["id"] == session.selected_address_id),
            None,
        )
        selected_address = {
            "id": saved_address["id"] if saved_address else "custom",
            "label": saved_address["label"] if saved_address else "New address",
            "address": session.address,
            "delivery_instructions": session.instructions,
        }
        selected_payment = {
            "id": session.selected_payment_method["id"],
            "label": session.selected_payment_method["label"],
            "type": session.selected_payment_method["type"],
            "last4": session.selected_payment_method["last4"],
        }
        session.order = {
            "order_id": f"DEMO-{uuid.uuid4().hex[:8].upper()}",
            "status": "simulated_placed",
            "session_id": session.id,
            "mode": session.mode,
            "items": [dict(item) for item in session.cart],
            "subtotal": round(self._subtotal(session), 2),
            "delivery_fee": round(self._total(session) - self._subtotal(session), 2),
            "total": round(self._total(session), 2),
            "currency": "AED",
            "delivery_address": selected_address,
            "payment_method": selected_payment,
            "phone": session.phone,
            "delivery_time": session.delivery_time,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "note": "Hackathon demo only; no vendor was contacted and no payment was charged.",
        }
        save_order(session.order)
        session.stage = "completed"
        return self._result(session, f"Demo order {session.order['order_id']} placed. Total AED {session.order['total']:.2f}.")

    def _cart_lines(self, session: Session) -> str:
        return "\n".join(f"- {item['name']} {item['size']} — {item['brand']} from {item['vendor_name']}: AED {item['unit_price']:.2f}" for item in session.cart)

    def _subtotal(self, session: Session) -> float:
        return sum(item["unit_price"] * item["quantity"] for item in session.cart)

    def _total(self, session: Session) -> float:
        vendors = {item["vendor_id"] for item in session.cart}
        delivery = sum(VENDORS[vendor]["delivery_fee"] for vendor in vendors)
        return self._subtotal(session) + delivery

    def _result(
        self,
        session: Session,
        reply: str,
        requires_confirmation: bool = False,
        available_deals: list[dict] | None = None,
        available_products: list[dict] | None = None,
        available_categories: list[dict] | None = None,
        catalog_group: str | None = None,
    ) -> dict:
        if session.pending_notice:
            reply = f"{session.pending_notice} {reply}"
            session.pending_notice = None
        session.history.append(
            {
                "role": "assistant",
                "content": reply,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        result = {
            "session_id": session.id,
            "mode": session.mode,
            "stage": session.stage,
            "reply": reply,
            "cart": session.cart,
            "subtotal": round(self._subtotal(session), 2),
            "requires_confirmation": requires_confirmation,
            "order": session.order,
            "delivery_time": session.delivery_time,
            "match_source": session.match_source,
            "history_length": len(session.history),
            "available_addresses": [],
            "available_payment_methods": [],
            "available_deals": available_deals or [],
            "available_products": available_products or [],
            "available_categories": available_categories or [],
            "catalog_group": catalog_group,
        }
        if session.stage == "confirm_address":
            result["available_addresses"] = PROFILE["addresses"]
        if session.stage == "confirm_payment":
            result["available_payment_methods"] = PROFILE["payment_methods"]
        return result


agent = GroceryAgent()
