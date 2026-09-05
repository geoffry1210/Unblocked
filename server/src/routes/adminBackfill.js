// POST /internal/backfill/run — triggers a backfill pass that runs on
// Render's own network (fire-and-forget: this request returns immediately,
// the actual backfill keeps running server-side afterward). This exists
// specifically because Binance backfills kept failing when run from a
// phone over a mobile carrier + VPN — Render's network already reaches
// Binance fine (the live relay proves it), so running there sidesteps the
// unreliable connection entirely instead of trying to paper over it.
//
// Protected by a shared secret (BACKFILL_SECRET env var) since this
// triggers real outbound API calls + DB writes and shouldn't be triggerable
// by anyone who finds the URL. Set it in the Render dashboard (or ask
// Claude, which already has Render env var access) before using this.
//
// GET /internal/backfill/status — poll this instead of tailing logs.

import { Router } from "express";
import { runBackfill, TIMEFRAMES } from "../services/backfillRunner.js";

const router = Router();

// In-memory only — resets on redeploy/restart, which is fine, this is a
// status *indicator*, not a durable record (the candles table is the
// durable record; this is just "is it running right now / what happened
// last time").
let state = { running: false, startedAt: null, finishedAt: null, log: [], result: null };

function requireSecret(req, res, next) {
  const provided = req.headers["x-backfill-key"];
  if (!process.env.BACKFILL_SECRET) {
    return res.status(500).json({ error: "BACKFILL_SECRET is not set on the server — set it before using this endpoint" });
  }
  if (provided !== process.env.BACKFILL_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

router.post("/run", requireSecret, (req, res) => {
  if (state.running) {
    return res.status(409).json({ error: "a backfill is already running", state });
  }

  const { exchange = null, symbol = null, timeframe } = req.body || {};
  const timeframes = Array.isArray(timeframe) && timeframe.length > 0 ? timeframe : TIMEFRAMES;

  state = { running: true, startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null };

  // Fire-and-forget — respond right away, keep running after the response
  // is sent. This is the whole point: the triggering request (from your
  // phone) can complete instantly and doesn't need to stay connected for
  // the ~20-40 minutes the actual backfill takes.
  runBackfill({
    exchangeFilter: exchange,
    symbolFilter: symbol,
    timeframes,
    onProgress: (line) => {
      console.log(`[backfill] ${line}`);
      state.log.push(line);
      if (state.log.length > 200) state.log.shift(); // keep it bounded
    },
  })
    .then((result) => {
      state.result = result;
    })
    .catch((err) => {
      state.log.push(`CRASHED: ${err.message}`);
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  res.json({ started: true, exchange, symbol, timeframes });
});

router.get("/status", requireSecret, (_req, res) => {
  res.json(state);
});

export default router;
