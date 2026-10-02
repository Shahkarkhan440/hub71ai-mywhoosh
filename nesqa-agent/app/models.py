from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: Optional[str] = None
    mode: Optional[Literal["express"]] = None


class CartItem(BaseModel):
    product_id: str
    name: str
    size: str
    quantity: int
    vendor_id: str
    vendor_name: str
    brand: str
    unit_price: float
    promotion: Optional[str] = None


class ChatResponse(BaseModel):
    session_id: str
    mode: Optional[str]
    stage: str
    reply: str
    cart: List[CartItem] = Field(default_factory=list)
    subtotal: float = 0
    requires_confirmation: bool = False
    order: Optional[Dict[str, Any]] = None
    delivery_time: Optional[Dict[str, Any]] = None
    match_source: Optional[str] = None
    history_length: int = 0
    available_addresses: List[Dict[str, Any]] = Field(default_factory=list)
    available_payment_methods: List[Dict[str, Any]] = Field(default_factory=list)
    available_deals: List[Dict[str, Any]] = Field(default_factory=list)
    available_products: List[Dict[str, Any]] = Field(default_factory=list)
    available_categories: List[Dict[str, Any]] = Field(default_factory=list)
    catalog_group: Optional[str] = None


class SessionView(BaseModel):
    session_id: str
    mode: Optional[str]
    stage: str
    cart: List[CartItem]
    subtotal: float
    history_length: int
    delivery_time: Optional[Dict[str, Any]] = None
