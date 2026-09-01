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

## Deployment (Render + Neon)

**Database — Neon**
1. Create a project at neon.tech (works fine from a phone browser, no CLI needed)
2. Copy the connection string from the project dashboard into `DATABASE_URL`
3. Run `server/schema.sql` against it using Neon's built-in SQL editor in
   the web console — no `psql` required. Then run the seed insert from
   `server/symbols.md` the same way.

**Server — Render**
1. Render dashboard → New → Blueprint → connect this GitHub repo. Render
   reads `render.yaml` at the repo root and configures the `unblocked-server`
   service automatically (free plan, root dir `server`, health check `/health`)
2. In the service's Environment tab, paste in `DATABASE_URL` (from Neon) and
   `WEB_ORIGIN` (leave as a placeholder until `/web` is deployed in Phase 2)
3. Deploy. First boot may take a minute (free tier cold start)

**Keeping the relay alive — UptimeRobot**
Render's free tier spins down after 15 minutes without inbound traffic, and
the relay's Binance connection is outbound-only — so without a keep-alive
ping, the service (and its Binance connection) can go to sleep even while
nobody's watching the site.

1. Sign up at uptimerobot.com (free)
2. Add a new HTTP(s) monitor pointed at `https://<your-render-service>.onrender.com/health`
3. Set the check interval to 5 minutes (free plan default)

This is an unofficial workaround, not a Render-documented feature — reliable
in practice, but budget for Render's $7/mo Starter tier once the project has
real users and sleep/wake reliability actually matters.

**Web (Phase 2 — now included)**
`render.yaml` also defines `unblocked-web` as a static site built from `/web`.
Same Blueprint deploy covers both services.

One gotcha: Vite bakes `VITE_API_URL`/`VITE_WS_URL` into the build at build
time, not at runtime. If you change them after the first deploy, you need to
trigger a redeploy (not just restart) for the new values to take effect.
Set them correctly *before* the first deploy: point `VITE_API_URL` /
`VITE_WS_URL` at `unblocked-server`'s Render URL, and set the server's
`WEB_ORIGIN` to `unblocked-web`'s Render URL for CORS to work both ways.
