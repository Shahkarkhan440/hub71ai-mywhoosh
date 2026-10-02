from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any


DEFAULT_ORDERS_FILE = Path(__file__).parent / "data" / "orders.json"
ORDERS_FILE = Path(os.getenv("ORDERS_FILE", str(DEFAULT_ORDERS_FILE)))
_LOCK = Lock()


def _read_orders_unlocked() -> list[dict[str, Any]]:
    if not ORDERS_FILE.exists():
        return []
    data = json.loads(ORDERS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Orders file must contain a JSON array.")
    return data


def list_orders() -> list[dict[str, Any]]:
    with _LOCK:
        orders = _read_orders_unlocked()
    return sorted(orders, key=lambda order: order.get("created_at", ""), reverse=True)


def get_order(order_id: str) -> dict[str, Any] | None:
    return next((order for order in list_orders() if order.get("order_id") == order_id), None)


def save_order(order: dict[str, Any]) -> None:
    """Append an order using an atomic replace so the JSON file stays valid."""
    with _LOCK:
        ORDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        orders = _read_orders_unlocked()
        orders.append(order)
        temporary_file = ORDERS_FILE.with_suffix(".json.tmp")
        temporary_file.write_text(
            json.dumps(orders, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        temporary_file.replace(ORDERS_FILE)
