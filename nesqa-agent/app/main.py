from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.agent import agent
from app.catalog import CATALOG, PROFILE
from app.models import ChatRequest, ChatResponse, SessionView
from app.order_store import get_order, list_orders
from app.voice import router as voice_router


app = FastAPI(
    title="Nesqa Grocery Voice Agent",
    description="Hackathon MVP for assisted grocery ordering in Abu Dhabi.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/catalog")
def get_catalog() -> dict:
    return CATALOG


@app.get("/api/profile")
def get_profile() -> dict:
    """Return demo-safe profile data; payment methods are masked."""
    return PROFILE


@app.get("/api/orders")
def get_orders() -> dict:
    orders = list_orders()
    return {"orders": orders, "count": len(orders)}


@app.get("/api/orders/{order_id}")
def get_order_by_id(order_id: str) -> dict:
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_defaults=True)
def chat(request: ChatRequest) -> dict:
    if request.session_id and request.session_id not in agent.sessions:
        raise HTTPException(
            status_code=404,
            detail="Session expired or was not found. Start again without a session_id.",
        )
    session = agent.get_or_create(request.session_id, request.mode)
    agent.record_user_message(session, request.message)
    return agent.respond(session, request.message)


@app.get("/api/sessions/{session_id}", response_model=SessionView)
def get_session(session_id: str) -> dict:
    session = agent.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.id,
        "mode": session.mode,
        "stage": session.stage,
        "cart": session.cart,
        "subtotal": round(sum(item["unit_price"] * item["quantity"] for item in session.cart), 2),
        "history_length": len(session.history),
        "delivery_time": session.delivery_time,
    }


@app.get("/api/sessions/{session_id}/history")
def get_session_history(session_id: str) -> dict:
    session = agent.sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.id,
        "stage": session.stage,
        "history": session.history,
    }


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: str) -> None:
    agent.sessions.pop(session_id, None)
