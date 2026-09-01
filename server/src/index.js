// Unblocked server — entry point
// Phase 1: fully wired — Binance relay, REST API, WebSocket server.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

import { startBinanceRelay } from "./services/binanceRelay.js";
import { attachWebSocketServer } from "./services/wsServer.js";
import { startWhaleAlertPoller } from "./services/whaleAlertPoller.js";
import candlesRouter from "./routes/candles.js";
import symbolsRouter from "./routes/symbols.js";
import { pool } from "./db/pool.js";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/candles", candlesRouter);
app.use("/symbols", symbolsRouter);

const server = createServer(app);

// Attach the WS server first — it hands back broadcast functions the
// relay needs to push live ticks to subscribed clients.
const { broadcastCandle, broadcastWhaleEvent } = attachWebSocketServer(server);

startBinanceRelay({ broadcastCandle }).catch((err) => {
  console.error("Failed to start Binance relay", err);
});

// Phase 3 — poll CoinRadar's /api/whale/:ticker for each active symbol and
// broadcast new events to subscribed chart clients.
pool
  .query("SELECT pair FROM symbols WHERE active = true")
  .then(({ rows }) => {
    startWhaleAlertPoller({
      symbols: rows.map((r) => r.pair),
      broadcastWhaleEvent,
    });
  })
  .catch((err) => {
    console.error("Failed to start whale alert poller", err);
  });

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`Unblocked server listening on :${port}`));
