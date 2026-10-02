from __future__ import annotations

import json
from pathlib import Path
import re


DATA_DIR = Path(__file__).parent / "data"


def _read_json(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


CATALOG = _read_json("vendors.json")
PROFILE = _read_json("profile.json")
VENDORS = {vendor["id"]: vendor for vendor in CATALOG["vendors"]}


def product_matches(message: str) -> dict[str, list[dict]]:
    """Return products grouped by category when an alias is present in text."""
    text = message.casefold()
    matches: dict[str, list[dict]] = {}
    for product in CATALOG["products"]:
        terms = [product["category"], *product.get("aliases", [])]
        if any(re.search(rf"(?<!\w){re.escape(term.casefold())}(?!\w)", text) for term in terms):
            matches.setdefault(product["category"], []).append(product)
    return matches


def cheapest_offer(product: dict) -> dict:
    return min(product["offers"], key=lambda offer: offer["price"])


def cart_item(product: dict, offer: dict | None = None) -> dict:
    selected = offer or cheapest_offer(product)
    vendor = VENDORS[selected["vendor"]]
    return {
        "product_id": product["id"],
        "name": product["name"],
        "size": product["size"],
        "quantity": 1,
        "vendor_id": vendor["id"],
        "vendor_name": vendor["name"],
        "brand": selected["brand"],
        "unit_price": selected["price"],
        "promotion": selected.get("promotion"),
    }
