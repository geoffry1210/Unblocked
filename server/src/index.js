// Unblocked server — entry point
// Phase 1: fully wired — Binance relay, REST API, WebSocket server.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

import { startBinanceRelay } from "./services/binanceRelay.js";
import { attachWebSocketServer } from "./services/wsServer.js";
import candlesRouter from "./routes/candles.js";
import symbolsRouter from "./routes/symbols.js";

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

// Exported for Phase 3 — CoinRadar's whale-alert logic will call this
// (directly, or via an internal endpoint) to push events to the chart.
export { broadcastWhaleEvent };

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`Unblocked server listening on :${port}`));
