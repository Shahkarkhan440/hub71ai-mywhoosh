from __future__ import annotations

import asyncio
import base64
import importlib
import json

from fastapi.testclient import TestClient
import pytest

from app.agent import agent
from app.main import app
from app import order_store


client = TestClient(app)


def setup_function() -> None:
    agent.sessions.clear()


@pytest.fixture(autouse=True)
def isolate_orders_file(tmp_path, monkeypatch):
    monkeypatch.setattr(order_store, "ORDERS_FILE", tmp_path / "orders.json")


def send(message: str, session_id: str | None = None, mode: str | None = None) -> dict:
    payload = {"message": message}
    if session_id:
        payload["session_id"] = session_id
    if mode:
        payload["mode"] = mode
    response = client.post("/api/chat", json=payload)
    assert response.status_code == 200
    return response.json()


def test_cors_allows_any_origin() -> None:
    response = client.options(
        "/api/chat",
        headers={
            "Origin": "https://frontend.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_express_requires_all_checkout_confirmations() -> None:
    result = send("15 eggs and 1 litre milk", mode="express")
    session_id = result["session_id"]
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["product_id"] == "eggs-15"
    result = send("that's all", session_id)
    assert result["stage"] == "review_cart"
    result = send("yes", session_id)
    assert result["stage"] == "confirm_address"
    assert len(result["available_addresses"]) == 1
    assert result["available_addresses"][0]["id"] == "home"
    result = send("Home", session_id)
    assert result["stage"] == "confirm_instructions"
    result = send("yes", session_id)
    assert result["stage"] == "confirm_phone"
    result = send("yes", session_id)
    assert result["stage"] == "confirm_delivery_time"
    result = send("tomorrow at 6 PM", session_id)
    assert result["stage"] == "confirm_payment"
    assert len(result["available_payment_methods"]) == 2
    result = send("Visa 4242", session_id)
    assert result["stage"] == "final_confirmation"
    result = send("confirm order", session_id)
    assert result["stage"] == "completed"
    assert result["order"]["status"] == "simulated_placed"
    assert result["order"]["delivery_time"]["timezone"] == "Asia/Dubai"
    assert result["order"]["delivery_address"]["id"] == "home"
    assert result["order"]["payment_method"] == {
        "id": "visa-4242",
        "label": "Personal card",
        "type": "Visa",
        "last4": "4242",
    }
    assert "available_addresses" not in result
    assert "available_payment_methods" not in result

    orders_response = client.get("/api/orders")
    assert orders_response.status_code == 200
    orders_payload = orders_response.json()
    assert orders_payload["count"] == 1
    assert orders_payload["orders"][0]["order_id"] == result["order"]["order_id"]
    assert orders_payload["orders"][0]["items"][0]["product_id"] == "eggs-15"

    detail_response = client.get(f"/api/orders/{result['order']['order_id']}")
    assert detail_response.status_code == 200
    assert detail_response.json()["payment_method"]["last4"] == "4242"


def test_unknown_order_returns_404() -> None:
    response = client.get("/api/orders/DEMO-NOTFOUND")
    assert response.status_code == 404


def test_express_honours_a_spoken_size_without_clarifying() -> None:
    result = send("6 eggs and 1 litre milk", mode="express")
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["product_id"] == "eggs-6"


def test_spoken_number_selects_a_size_during_clarification() -> None:
    result = send("eggs", mode="express")
    assert result["stage"] == "clarify_product"

    result = send("I want six pack", result["session_id"])
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["product_id"] == "eggs-6"
    assert result["cart"][0]["quantity"] == 1


def test_zero_inventory_product_is_reported_out_of_stock() -> None:
    result = send("I want straberry", mode="express")

    assert result["stage"] == "collect_items"
    assert result.get("cart", []) == []
    assert "strawberries" in result["reply"].casefold()
    assert "out of stock" in result["reply"].casefold()


def test_out_of_stock_item_is_skipped_from_a_mixed_request() -> None:
    result = send("one kg bananas and strawberries", mode="express")

    assert result["stage"] == "offer_more"
    assert [item["product_id"] for item in result["cart"]] == ["bananas-1kg"]
    assert "out of stock" in result["reply"].casefold()


def test_missing_sizes_and_quantities_are_clarified_before_cart() -> None:
    result = send("bananas, milk pack, and eggs", mode="express")
    session_id = result["session_id"]
    assert result["stage"] == "clarify_product"
    assert "6 pack or 15 pack" in result["reply"]

    result = send("15 pack", session_id)
    assert result["stage"] == "clarify_quantity"
    assert "milk packs" in result["reply"]

    result = send("two", session_id)
    assert result["stage"] == "clarify_quantity"
    assert "bananas" in result["reply"]

    result = send("2 kg", session_id)
    assert result["stage"] == "offer_more"
    quantities = {item["product_id"]: item.get("quantity", 1) for item in result["cart"]}
    assert quantities == {"eggs-15": 1, "milk-1l": 2, "bananas-1kg": 2}


def test_explicit_amounts_do_not_trigger_quantity_questions() -> None:
    result = send("2 kg bananas and two 1 L milk packs", mode="express")
    assert result["stage"] == "offer_more"
    quantities = {item["product_id"]: item.get("quantity", 1) for item in result["cart"]}
    assert quantities == {"milk-1l": 2, "bananas-1kg": 2}


def test_bare_spoken_or_numeric_quantity_is_accepted() -> None:
    for answer in ("One.", "1", "Yeah, just one is enough."):
        result = send("bananas", mode="express")
        result = send(answer, result["session_id"])
        assert result["stage"] == "offer_more"
        assert result["cart"][0]["quantity"] == 1


def test_pending_quantity_can_be_skipped_and_alternatives_listed(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = send("I need some bananas, strawberry.")
    assert result["stage"] == "clarify_quantity"

    result = send(
        "Can you tell me what are the other available? I don't need banana.",
        result["session_id"],
    )

    assert result["stage"] == "collect_items"
    assert result["catalog_group"] == "fruits"
    assert "skipped bananas" in result["reply"].casefold()
    assert [product["product_id"] for product in result["available_products"]] == [
        "apples-1kg",
        "strawberries-250g",
    ]
    assert result["available_products"][0]["in_stock"] is True
    assert result["available_products"][1]["in_stock"] is False
    assert result.get("cart", []) == []


def test_pending_quantity_can_switch_to_another_product(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = send("bananas")
    assert result["stage"] == "clarify_quantity"

    result = send("I don't want bananas, change it to apples", result["session_id"])
    assert result["stage"] == "clarify_quantity"
    assert "apples" in result["reply"].casefold()

    result = send("one", result["session_id"])
    assert result["stage"] == "offer_more"
    assert [item["product_id"] for item in result["cart"]] == ["apples-1kg"]


def test_pending_size_selection_can_skip_product(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = send("eggs")
    assert result["stage"] == "clarify_product"

    result = send("I don't want eggs", result["session_id"])
    assert result["stage"] == "collect_items"
    assert result.get("cart", []) == []
    assert "skipped fresh eggs" in result["reply"].casefold()


def test_payment_matches_label_type_last_four_and_voice_variants() -> None:
    personal_phrases = (
        "personal card",
        "use Visa",
        "4242",
        "my card ending 4242",
        "four two four two",
        "Nalcard",
        "نلکارڈ",
    )
    for phrase in personal_phrases:
        assert agent._match_payment_method(phrase)["id"] == "visa-4242"

    for phrase in ("work card", "Mastercard", "4444", "company card ending 4444"):
        assert agent._match_payment_method(phrase)["id"] == "mastercard-4444"


def test_default_single_mode_uses_express_style_flow() -> None:
    result = send("I need 1 litre milk, 1 loaf of bread and 1 kg bananas")
    session_id = result["session_id"]
    assert result["mode"] == "express"
    assert result["stage"] == "offer_more"
    result = send("nothing else", session_id)
    assert result["stage"] == "review_cart"
    assert result["reply"] == "Subtotal: AED 17.75. Continue?"
    assert "Milk" not in result["reply"]
    assert {item["vendor_id"] for item in result["cart"]} == {"lulu"}
    assert result["match_source"] == "catalog"


def test_removed_normal_mode_is_rejected() -> None:
    response = client.post(
        "/api/chat",
        json={"mode": "normal", "message": "I need milk"},
    )
    assert response.status_code == 422


def test_unknown_item_is_handled() -> None:
    result = send("I need dragon fruit")
    assert result["stage"] == "collect_items"
    assert "couldn't find" in result["reply"]


def test_generic_fruit_request_asks_which_fruit_before_quantity() -> None:
    result = send("I want to order some fruits")
    session_id = result["session_id"]

    assert result["stage"] == "collect_items"
    assert result["catalog_group"] == "fruits"
    assert "Available fruits" in result["reply"]
    assert "out of stock" in result["reply"]
    assert [product["product_id"] for product in result["available_products"]] == [
        "bananas-1kg",
        "apples-1kg",
        "strawberries-250g",
    ]
    assert result["available_products"][-1]["in_stock"] is False
    assert result.get("cart", []) == []

    result = send("bananas", session_id)
    assert result["stage"] == "clarify_quantity"
    assert "kilograms of bananas" in result["reply"].casefold()


def test_show_me_fruits_is_resolved_as_a_category_query() -> None:
    result = send("show me fruits")

    assert result["catalog_group"] == "fruits"
    assert len(result["available_products"]) == 3
    assert result["stage"] == "collect_items"


def test_specific_fruit_request_still_goes_to_quantity() -> None:
    result = send("I want bananas")
    assert result["stage"] == "clarify_quantity"


def test_generic_vegetable_request_lists_relevant_products() -> None:
    result = send("Show me some vegetables")

    assert result["stage"] == "collect_items"
    assert result["catalog_group"] == "vegetables"
    assert [product["product_id"] for product in result["available_products"]] == [
        "tomatoes-1kg",
        "onions-1kg",
    ]
    assert all(product["in_stock"] for product in result["available_products"])


def test_catalog_query_returns_product_categories() -> None:
    result = send("What grocery categories do you have?")

    assert result["stage"] == "collect_items"
    assert [category["name"] for category in result["available_categories"]] == [
        "fruits", "vegetables", "dairy", "pantry", "drinks", "bakery", "meat", "household",
    ]
    assert result["available_categories"][0] == {
        "name": "fruits",
        "product_count": 3,
        "in_stock_count": 2,
    }


def test_named_category_takes_priority_over_the_word_products() -> None:
    result = send("Show dairy products")

    assert result["catalog_group"] == "dairy"
    assert result.get("available_categories", []) == []
    assert [product["product_id"] for product in result["available_products"]] == [
        "eggs-6", "eggs-15", "milk-1l", "yogurt-1kg",
    ]


def test_no_order_without_explicit_final_confirmation() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    for answer in ["no", "yes", "yes", "yes", "yes", "tomorrow at 6 PM", "Visa 4242"]:
        result = send(answer, session_id)
    result = send("maybe", session_id)
    assert result["stage"] == "final_confirmation"
    assert "order" not in result


def test_expired_session_is_not_silently_replaced() -> None:
    response = client.post(
        "/api/chat",
        json={"session_id": "expired-session", "message": "yes"},
    )
    assert response.status_code == 404
    assert "Session expired" in response.json()["detail"]


def test_phone_can_be_updated_in_one_answer() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    for answer in ["no", "yes", "Home", "yes"]:
        result = send(answer, session_id)
    assert result["stage"] == "confirm_phone"
    result = send("+971 55 987 6543", session_id)
    assert result["stage"] == "confirm_delivery_time"
    assert agent.sessions[session_id].phone == "+971 55 987 6543"


def test_model_match_can_resolve_a_misspelled_product(monkeypatch) -> None:
    from app.catalog import CATALOG

    banana = next(product for product in CATALOG["products"] if product["id"] == "bananas-1kg")
    monkeypatch.setattr("app.agent.grouped_model_matches", lambda _: ({"bananas": [banana]}, True))

    result = send("I need 1 kg banannas", mode="express")
    assert result["stage"] == "offer_more"
    assert result["match_source"] == "openai"
    assert result["cart"][0]["product_id"] == "bananas-1kg"


def test_out_of_scope_request_gets_grocery_capability_message(monkeypatch) -> None:
    monkeypatch.setattr("app.agent.grouped_model_matches", lambda _: ({}, False))

    result = send("Can you tell me tomorrow's weather?", mode="express")
    assert result["stage"] == "collect_items"
    assert "cart" not in result
    assert result["reply"] == "I can only help with grocery shopping in Abu Dhabi."


def test_session_history_can_restore_a_text_conversation() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    assert result["history_length"] == 2

    send("that's all", session_id)
    response = client.get(f"/api/sessions/{session_id}/history")
    assert response.status_code == 200
    history = response.json()["history"]
    assert [item["role"] for item in history] == ["user", "assistant", "user", "assistant"]
    assert history[0]["content"] == "1 litre milk"
    assert history[-1]["content"].startswith("Subtotal:")


def test_natural_confirmation_phrases_complete_express_checkout() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    result = send("nope, that's everything", session_id)
    assert result["stage"] == "review_cart"
    result = send("yeah", session_id)
    assert result["stage"] == "confirm_address"
    result = send("use my home address", session_id)
    assert result["stage"] == "confirm_instructions"
    result = send("yep", session_id)
    assert result["stage"] == "confirm_phone"
    result = send("sounds good", session_id)
    assert result["stage"] == "confirm_delivery_time"
    result = send("tomorrow evening", session_id)
    assert result["stage"] == "confirm_payment"
    result = send("use the first one", session_id)
    assert result["stage"] == "final_confirmation"
    result = send("go ahead", session_id)
    assert result["stage"] == "completed"


def test_greetings_are_friendly_and_preserve_the_current_stage() -> None:
    result = send("hi")
    assert result["stage"] == "collect_items"
    assert result["mode"] == "express"
    assert result["reply"] == "Hi! What groceries do you need?"

    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    assert result["stage"] == "offer_more"
    result = send("salam", session_id)
    assert result["stage"] == "offer_more"
    assert result["reply"] == "Hi! Anything else, or today’s deals?"
    assert result["cart"][0]["product_id"] == "milk-1l"

    result = send("Hello, hi.", mode="express")
    assert result["stage"] == "collect_items"
    assert result["reply"].startswith("Hi!")


def test_voice_style_kg_and_no_thanks_advance_cleanly() -> None:
    result = send("bananas", mode="express")
    session_id = result["session_id"]
    assert result["stage"] == "clarify_quantity"

    result = send("Yeah, just one cage is enough.", session_id)
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["quantity"] == 1

    result = send("No, thanks.", session_id)
    assert result["stage"] == "review_cart"
    assert result["requires_confirmation"] is True


def test_milkshake_is_not_silently_substituted_with_plain_milk() -> None:
    from app.catalog import product_matches

    matches = product_matches("I want a milkshake")
    assert "milk" not in matches


def test_user_can_see_deals_add_one_and_then_review() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    result = send("What is on deal?", session_id)
    assert result["stage"] == "offer_more"
    assert result["available_deals"]

    result = send("Add one 5 kg bag of rice", session_id)
    assert result["stage"] == "offer_more"
    assert {item["product_id"] for item in result["cart"]} == {"milk-1l", "rice-5kg"}

    result = send("that's all", session_id)
    assert result["stage"] == "review_cart"
    assert result["requires_confirmation"] is True


def test_offer_more_navigation_phrases_go_to_cart_review() -> None:
    for phrase in (
        "Thanks, go ahead.",
        "Finish the review, cart review.",
        "Please proceed to checkout.",
    ):
        result = send("1 litre milk", mode="express")
        result = send(phrase, result["session_id"])
        assert result["stage"] == "review_cart"
        assert result["requires_confirmation"] is True
        assert "subtotal" in result["reply"].casefold()


def test_deal_summary_includes_sizes_for_duplicate_product_names() -> None:
    result = send("1 litre milk", mode="express")
    result = send("show me deals", result["session_id"])
    assert "Fresh Eggs 6 pack" in result["reply"]
    assert "Fresh Eggs 15 pack" in result["reply"]


def test_cart_quantity_can_be_updated_and_item_removed_during_review() -> None:
    result = send("1 litre milk and 1 kg bananas", mode="express")
    session_id = result["session_id"]
    result = send("go ahead", session_id)
    assert result["stage"] == "review_cart"

    result = send("change milk to 3 packs", session_id)
    assert result["stage"] == "review_cart"
    milk = next(item for item in result["cart"] if item["product_id"] == "milk-1l")
    assert milk["quantity"] == 3
    assert "updated subtotal" in result["reply"]

    result = send("remove bananas", session_id)
    assert result["stage"] == "review_cart"
    assert [item["product_id"] for item in result["cart"]] == ["milk-1l"]


def test_cart_update_can_ask_for_quantity_in_a_follow_up() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    result = send("update the milk quantity", session_id)
    assert result["stage"] == "edit_cart_quantity"

    result = send("four", session_id)
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["quantity"] == 4


def test_existing_item_can_be_incremented_and_new_item_added() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]

    result = send("add another milk pack", session_id)
    assert result["stage"] == "offer_more"
    assert result["cart"][0]["quantity"] == 2

    result = send("add one loaf of bread", session_id)
    assert result["stage"] == "offer_more"
    assert {item["product_id"] for item in result["cart"]} == {"milk-1l", "bread-white"}


def test_new_address_requires_complete_abu_dhabi_address() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    send("no", session_id)
    send("yes", session_id)
    result = send("add address Al Reem Island", session_id)
    assert result["stage"] == "new_address"
    assert "including" in result["reply"]

    result = send("Apartment 804, Gate Tower 3, Al Reem Island, Abu Dhabi", session_id)
    assert result["stage"] == "confirm_instructions"
    assert agent.sessions[session_id].address.startswith("Apartment 804")


def test_delivery_time_is_mandatory_and_unclear_input_does_not_advance() -> None:
    result = send("1 litre milk", mode="express")
    session_id = result["session_id"]
    for answer in ["that's all", "yes", "Home", "yes", "yes"]:
        result = send(answer, session_id)
    assert result["stage"] == "confirm_delivery_time"

    result = send("whenever", session_id)
    assert result["stage"] == "confirm_delivery_time"
    assert "delivery_time" not in result

    result = send("tonight", session_id)
    assert result["stage"] == "confirm_payment"
    assert result["delivery_time"]["timezone"] == "Asia/Dubai"


def test_voice_websocket_transcribes_runs_agent_and_streams_audio(monkeypatch) -> None:
    voice_module = importlib.import_module("app.voice")

    class FakeRealtime:
        def __init__(self) -> None:
            self.events = []
            self.initial = [{"type": "session.created"}]

        async def send(self, raw: str) -> None:
            event = json.loads(raw)
            if event["type"] == "session.update":
                assert "Speak briskly" in event["session"]["instructions"]
                turn_detection = event["session"]["audio"]["input"]["turn_detection"]
                assert turn_detection == {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 400,
                    "create_response": False,
                    "interrupt_response": False,
                }
                self.events.append({"type": "session.updated"})
            elif event["type"] == "input_audio_buffer.commit":
                self.events.append(
                    {
                        "type": "conversation.item.input_audio_transcription.completed",
                        "transcript": "1 litre milk",
                    }
                )
            elif event["type"] == "response.create":
                self.events.append({"type": "response.output_audio.delta", "delta": "AAAA"})
                self.events.append({"type": "response.output_audio.done"})

        async def recv(self) -> str:
            if self.initial:
                return json.dumps(self.initial.pop(0))
            while not self.events:
                await asyncio.sleep(0)
            return json.dumps(self.events.pop(0))

    fake_realtime = FakeRealtime()

    class FakeConnection:
        async def __aenter__(self) -> FakeRealtime:
            return fake_realtime

        async def __aexit__(self, *_: object) -> None:
            return None

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(voice_module, "connect", lambda *args, **kwargs: FakeConnection())

    with client.websocket_connect("/ws/voice?mode=express") as websocket:
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"
        assert ready["input_audio_format"] == {
            "encoding": "pcm16",
            "sample_rate": 24000,
            "channels": 1,
        }

        audio = base64.b64encode(b"\x00\x00" * 2400).decode("ascii")
        websocket.send_json({"type": "audio.append", "audio": audio})
        websocket.send_json({"type": "audio.commit"})

        events = [websocket.receive_json() for _ in range(5)]
        assert [event["type"] for event in events] == [
            "transcript.completed",
            "agent.response",
            "audio.start",
            "audio.delta",
            "audio.done",
        ]
        assert events[1]["transcript"] == "1 litre milk"
        assert events[1]["response"]["stage"] == "offer_more"
        assert events[1]["response"]["cart"][0]["product_id"] == "milk-1l"


def test_transcription_context_echo_is_rejected() -> None:
    voice_module = importlib.import_module("app.voice")
    leaked_context = (
        "An Abu Dhabi grocery order. Common words include Nesqa, LuLu, Carrefour, noon Minutes, "
        "doodh, anda, Al Reem Island, and AED. Measurements include kilograms, kg, liters, packs, "
        "and quantities. In this ordering context, preserve the phrase milk pack and do not merge "
        "it into milkshake."
    )

    assert voice_module._is_transcription_context_echo(leaked_context)
    assert voice_module._is_transcription_context_echo(voice_module.TRANSCRIPTION_CONTEXT)
    assert not voice_module._is_transcription_context_echo("I want a milk pack and six eggs")
