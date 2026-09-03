// GET /candles?symbol=BTCUSDT&tf=15m&exchange=binance&marketType=spot&limit=200&before=<ms>
// Serves historical candles for the initial chart load and for paging in
// older history as the user pans left, before the WebSocket subscription
// takes over for live updates.
//
// exchange/marketType default to binance/spot so existing frontend calls
// that don't pass them yet keep working unchanged.
//
// `before` (optional, ms epoch) fetches candles strictly older than that
// timestamp — this is how the frontend loads more history on demand
// instead of being capped at whatever the initial page returned.

import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const VALID_TIMEFRAMES = new Set(["1m", "15m", "1h", "4h", "1d"]);

router.get("/", async (req, res) => {
  const { symbol, tf, limit = "200", exchange = "binance", marketType = "spot", before } = req.query;

  if (!symbol || !tf) {
    return res.status(400).json({ error: "symbol and tf are required" });
  }
  if (!VALID_TIMEFRAMES.has(tf)) {
    return res.status(400).json({ error: `tf must be one of ${[...VALID_TIMEFRAMES].join(", ")}` });
  }
  const parsedLimit = Math.min(Number(limit) || 200, 2000);
  const beforeMs = before ? Number(before) : null;
  if (before && (Number.isNaN(beforeMs) || beforeMs <= 0)) {
    return res.status(400).json({ error: "before must be a positive epoch-ms timestamp" });
  }

  try {
    const conditions = ["symbol = $1", "timeframe = $2", "exchange = $3", "market_type = $4"];
    const params = [symbol.toUpperCase(), tf, exchange, marketType];
    if (beforeMs) {
      params.push(new Date(beforeMs).toISOString());
      conditions.push(`open_time < $${params.length}`);
    }
    params.push(parsedLimit);

    const { rows } = await pool.query(
      `SELECT open_time, open, high, low, close, volume
       FROM candles
       WHERE ${conditions.join(" AND ")}
       ORDER BY open_time DESC
       LIMIT $${params.length}`,
      params
    );

    // Reverse to ascending order — frontend expects oldest-first for charting.
    res.json(rows.reverse());
  } catch (err) {
    console.error("Failed to fetch candles", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
