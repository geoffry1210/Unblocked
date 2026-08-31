# Unblocked — free crypto charting platform

Two services, one Postgres database, deployed as two Railway services from one repo.

```
/server   → Node.js: Binance relay, REST API, WebSocket server, Postgres writes
/web      → React frontend: chart UI, indicators, drawing tools
```

## Why two services instead of one

The relay needs to run continuously (holding open Binance WebSocket connections)
independent of whether anyone has the site open. Splitting it from the web
server means:
- The data pipeline keeps recording candles even at zero traffic
- You can restart/redeploy the frontend without dropping live market connections
- Each service scales independently later (frontend on a CDN, relay on a
  single always-on instance)

## Build order (see project plan)

- Phase 0 (this scaffold): repo, schema, symbol list — done here
- Phase 1: `/server` — Binance relay + REST + WebSocket, tested standalone
- Phase 2: `/web` — wire the existing UI concept to real endpoints
- Phase 3: whale-alert integration from CoinRadar
- Phase 4+: indicators, drawing tools, monetization, deploy

## Local dev

```bash
# server
cd server
cp .env.example .env
npm install
npm run dev

# web (once Phase 2 starts)
cd web
npm install
npm run dev
```

## Deployment (Railway)

Two Railway services pointing at the same repo, different root directories
(`/server` and `/web`), sharing one Postgres plugin. Set `DATABASE_URL` as an
env var on the server service only — the web service talks to `server` over
HTTP/WS, never touches Postgres directly.
