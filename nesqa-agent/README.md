# Nesqa Grocery Voice Agent

A small hackathon backend for an Abu Dhabi grocery concierge. It supports:

- A single fast grocery flow: capture a grocery list, then explicitly confirm the address, delivery note, phone, mandatory delivery time, card, and final order.
- In-memory conversation sessions (no database).
- Demo-only checkout: no vendor integration and no real charge.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open the interactive API at [http://localhost:8000/docs](http://localhost:8000/docs).

## Run with Docker

Build and start the API:

```bash
docker build -t nesqa-agent .
docker run --rm \
  --name nesqa-agent \
  --env-file .env \
  -p 8000:8000 \
  -v nesqa-orders:/app/storage \
  nesqa-agent
```

The named volume keeps `orders.json` across container replacements. Set `PORT`
if your server platform requires a different container port. Never copy `.env`
or `OPENAI_API_KEY` into the image; provide secrets when starting the container.

## Try a conversation

Start an order (the `mode` field is no longer required):

```bash
curl -s http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"I need eggs, milk and bread"}'
```

Copy `session_id` from the response and send follow-ups:

```bash
curl -s http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"YOUR_SESSION_ID","message":"15 pack"}'
```

The expected sequence is: grocery list → missing size/weight/quantity clarification → cart review → address → instructions → phone → delivery time → payment method → explicit final confirmation.

Items are only added once their amount is clear. For example, the agent asks for an egg pack size, the number of 1 L milk packs, or the kilograms of produce. Explicit requests such as `2 kg bananas` and `two 1 L milk packs` skip those questions.

The cart remains editable before checkout. Users can say `change milk to 3 packs`, `remove bananas`, `add one loaf of bread`, or `add another milk pack`. A command such as `update the milk quantity` triggers a short follow-up asking for the new amount.

Quantity follow-ups accept concise voice replies such as `one`, `1`, or `just one`. Payment selection accepts the saved label, card type, last four digits, a longer spoken card number ending in those digits, or common speech-to-text variants. Voice replies use short prompts and brisk pacing for the live demo.

Delivery time is required before payment selection. Natural phrases such as `6 PM`, `tonight`, `tomorrow morning`, and `tomorrow at 6 PM` are normalized to an ISO 8601 time in `Asia/Dubai`. The selected value is returned as `delivery_time` and copied into the final demo order.

## Main endpoints

- `POST /api/chat` — advance a conversation
- `WS /ws/voice` — stream PCM16 microphone audio and receive transcripts, agent state, and PCM16 assistant audio
- `GET /api/catalog` — inspect dummy vendors, prices, and promotions
- `GET /api/profile` — inspect the masked demo profile
- `GET /api/sessions/{id}` — current session/cart state
- `GET /api/sessions/{id}/history` — conversation transcript for UI restoration
- `DELETE /api/sessions/{id}` — discard a session
- `GET /health` — readiness check

## Next step: voice

Voice is available at `ws://localhost:8000/ws/voice`. The backend keeps the OpenAI key private, relays PCM16 audio to the Realtime API, sends finalized transcripts through `GroceryAgent`, and streams the spoken backend reply to the browser. Critical checkout confirmations therefore use the same deterministic rules as text chat.

See [the frontend voice contract](docs/voice-websocket.md) for message types, reconnect behavior, and audio format requirements.
