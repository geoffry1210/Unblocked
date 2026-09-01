// GET /candles?symbol=BTCUSDT&tf=15m&limit=200
// Serves historical candles for the initial chart load, before the
// WebSocket subscription takes over for live updates.

import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const VALID_TIMEFRAMES = new Set(["1m", "15m", "1h", "4h", "1d"]);

router.get("/", async (req, res) => {
  const { symbol, tf, limit = "200" } = req.query;

  if (!symbol || !tf) {
    return res.status(400).json({ error: "symbol and tf are required" });
  }
  if (!VALID_TIMEFRAMES.has(tf)) {
    return res.status(400).json({ error: `tf must be one of ${[...VALID_TIMEFRAMES].join(", ")}` });
  }
  const parsedLimit = Math.min(Number(limit) || 200, 1000);

  try {
    const { rows } = await pool.query(
      `SELECT open_time, open, high, low, close, volume
       FROM candles
       WHERE symbol = $1 AND timeframe = $2
       ORDER BY open_time DESC
       LIMIT $3`,
      [symbol.toUpperCase(), tf, parsedLimit]
    );

    // Reverse to ascending order — frontend expects oldest-first for charting.
    res.json(rows.reverse());
  } catch (err) {
    console.error("Failed to fetch candles", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
