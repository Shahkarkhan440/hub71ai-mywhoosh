# Hub71 AI Hackathon — Nesqa

Nesqa is an Abu Dhabi grocery-shopping voice agent built for the Hub71 AI
hackathon.

## Hackathon submission

- **Team name:** Mywhoosh
- **GitHub repository:** [hub71ai-mywhoosh](https://github.com/Shahkarkhan440/hub71ai-mywhoosh)
- **Submission build commit SHA:** `9a307cd5416d03d4bfe2c01a874ac2003e331e30`
- **Live demo:** [nesqa-grocery.hub71-hackat-7654.chatgpt.site](https://nesqa-grocery.hub71-hackat-7654.chatgpt.site/)

## Projects

- `nesqa-agent/` — FastAPI backend, grocery agent, Realtime voice WebSocket,
  demo catalog, order persistence, and Docker deployment.
- `nesqa-web/` — web frontend for text and voice ordering.

Each project has its own README with local setup instructions.

## Prerequisites

- Python 3.11 or newer for `nesqa-agent`
- Node.js 22.13 or newer for `nesqa-web`
- Docker and Docker Compose for the container commands

Run all commands below from the monorepo root unless a command includes a
`cd` into one of the projects.

## Run the Nesqa agent

Create the backend environment file and add your OpenAI API key:

```bash
cp nesqa-agent/.env.example nesqa-agent/.env
```

### Local Python

```bash
cd nesqa-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API is available at `http://localhost:8000`, its interactive documentation
is at `http://localhost:8000/docs`, and the voice WebSocket is
`ws://localhost:8000/ws/voice`.

### Docker Compose

From the monorepo root:

```bash
docker compose \
  --env-file nesqa-agent/.env \
  -f nesqa-agent/docker-compose.yml \
  up -d --build
```

View logs or stop the backend with:

```bash
docker compose -f nesqa-agent/docker-compose.yml logs -f api
docker compose -f nesqa-agent/docker-compose.yml down
```

### Docker run

```bash
docker build -t nesqa-agent ./nesqa-agent
docker run --rm \
  --name nesqa-agent \
  --env-file nesqa-agent/.env \
  -p 8000:8000 \
  -v nesqa-orders:/app/storage \
  nesqa-agent
```

Check that the backend is ready:

```bash
curl http://localhost:8000/health
```

## Run the Nesqa web app

For local development, create `nesqa-web/.env.local` containing:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/voice
```

### Local Node.js

```bash
cd nesqa-web
npm ci
npm run dev
```

Open `http://localhost:5173`. Keep the agent running in a separate terminal.

To create and preview a production build locally:

```bash
cd nesqa-web
npm run build
npm start
```

### Docker run

The web project does not need a custom image for local development. Run it in
the official Node.js container from the monorepo root:

```bash
docker run --rm -it \
  --name nesqa-web \
  -p 5173:5173 \
  -e NEXT_PUBLIC_API_URL=http://localhost:8000 \
  -e NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/voice \
  -v "$PWD/nesqa-web:/app" \
  -v nesqa-web-node-modules:/app/node_modules \
  -w /app \
  node:22-bookworm-slim \
  sh -c 'npm ci && npm run dev -- --hostname 0.0.0.0 --port 5173'
```

## Run both for development

Use two terminals:

```bash
# Terminal 1
docker compose --env-file nesqa-agent/.env -f nesqa-agent/docker-compose.yml up --build
```

```bash
# Terminal 2
cd nesqa-web
npm ci
npm run dev
```

Do not commit either project's real `.env` files or your `OPENAI_API_KEY`.
