# Frontend voice WebSocket contract

Connect the browser to the FastAPI backend. Never put `OPENAI_API_KEY` in the frontend.

```js
// To resume, connect with: ws://localhost:8000/ws/voice?session_id=SAVED_ID
const socket = new WebSocket("ws://localhost:8000/ws/voice");
```

The first server event is:

```json
{
  "type": "session.ready",
  "session_id": "...",
  "mode": "express",
  "stage": "collect_items",
  "input_audio_format": {
    "encoding": "pcm16",
    "sample_rate": 24000,
    "channels": 1
  },
  "output_audio_format": {
    "encoding": "pcm16",
    "sample_rate": 24000,
    "channels": 1
  }
}
```

Save only `session_id` in `localStorage`. The backend owns the cart and checkout state.

## One-click continuous input

Use `getUserMedia` with an `AudioWorklet` to capture microphone samples. Resample them to mono 24 kHz, convert Float32 samples to little-endian signed PCM16, base64-encode each chunk, and send:

```js
socket.send(JSON.stringify({
  type: "audio.append",
  audio: base64Pcm16
}));
```

The backend uses server-side voice activity detection. Keep streaming while the shopper is
speaking; a natural pause automatically ends the turn, runs the NESQA agent, and starts the
spoken reply. Pause microphone streaming during assistant playback, then resume it after
`audio.done` and the playback queue has drained.

The server sends `speech.started` and `speech.stopped` so the UI can show listening and
thinking states. The shopper clicks once to start the voice conversation and clicks the stop
button only when they want to end voice mode.

Manual commit remains supported for older push-to-talk clients:

```js
socket.send(JSON.stringify({ type: "audio.commit" }));
```

Do not send WebM, MP3, WAV headers, or `MediaRecorder` blobs. This endpoint expects raw PCM16. Send at least 100 ms of audio before committing.

To discard the current recording instead:

```js
socket.send(JSON.stringify({ type: "audio.clear" }));
```

## Server events

Handle these events:

| Event | Frontend action |
| --- | --- |
| `speech.started` | Show the listening state. |
| `speech.stopped` | Stop microphone streaming and show the thinking state. |
| `transcript.delta` | Show an interim user caption. |
| `transcript.completed` | Replace the interim caption with the final transcript. |
| `agent.response` | Render `response.reply`, cart, stage, addresses, cards, and order data exactly like `POST /api/chat`. |
| `audio.start` | Prepare a new assistant playback queue. |
| `audio.delta` | Base64-decode raw PCM16 and enqueue it for playback in arrival order. |
| `assistant_transcript.delta` | Optionally show the spoken assistant caption. |
| `audio.done` | Mark assistant playback as complete after the queue drains. |
| `error` | Show `message`; use `code` for UI-specific recovery. |
| `pong` | Optional keepalive response. |

Example handler:

```js
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);

  if (event.type === "session.ready") {
    localStorage.setItem("nesqa_session_id", event.session_id);
  } else if (event.type === "agent.response") {
    renderAgentResponse(event.response);
  } else if (event.type === "audio.delta") {
    enqueuePcm16(base64ToBytes(event.audio), 24000);
  } else if (event.type === "error") {
    showError(event.message);
  }
};
```

Text can use the same live connection:

```js
socket.send(JSON.stringify({
  type: "text.message",
  message: "Deliver it tomorrow at 6 PM"
}));
```

The reply arrives as `agent.response` followed by streamed voice events. This makes text and voice share one session and one grocery state machine.

## Reconnect and close

Reconnect an existing conversation with:

```text
ws://localhost:8000/ws/voice?session_id=SESSION_ID
```

Close the voice connection but retain the backend session:

```js
socket.send(JSON.stringify({ type: "session.close" }));
```

Close it and clear the in-memory backend session:

```js
socket.send(JSON.stringify({
  type: "session.close",
  clear_session: true
}));
localStorage.removeItem("nesqa_session_id");
```

For production, use `wss://` behind HTTPS. The backend Realtime session has no automatic answer path: it transcribes the shopper, runs the existing deterministic checkout flow, then asks Realtime to speak that exact backend reply.
