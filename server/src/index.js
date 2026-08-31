// Unblocked server — entry point
// Phase 0: structure only. Phase 1 fills in each piece below.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

// import { pool } from "./db/pool.js";                    // Phase 1
// import { startBinanceRelay } from "./services/binanceRelay.js"; // Phase 1
// import { attachWebSocketServer } from "./services/wsServer.js"; // Phase 1
// import candlesRouter from "./routes/candles.js";         // Phase 1

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// app.use("/candles", candlesRouter);                      // Phase 1

const server = createServer(app);

// attachWebSocketServer(server);                           // Phase 1 — live candle push to clients
// startBinanceRelay();                                     // Phase 1 — subscribes to Binance, writes to Postgres

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`Unblocked server listening on :${port}`));
