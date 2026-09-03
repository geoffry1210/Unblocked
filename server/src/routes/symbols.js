// GET /symbols[?exchange=binance&marketType=spot]
// Returns the list of actively tracked pairs so the frontend can populate
// the symbol search and watchlist without hardcoding the list client-side.
//
// Called with no filters, returns every active symbol across every
// exchange/market type, each tagged with its exchange and marketType so
// the frontend can group or filter them.

import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/", async (req, res) => {
  const { exchange, marketType } = req.query;
  const conditions = ["active = true"];
  const params = [];

  if (exchange) {
    params.push(exchange);
    conditions.push(`exchange = $${params.length}`);
  }
  if (marketType) {
    params.push(marketType);
    conditions.push(`market_type = $${params.length}`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT pair, display, exchange, market_type AS "marketType"
       FROM symbols
       WHERE ${conditions.join(" AND ")}
       ORDER BY exchange, market_type, pair`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch symbols", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
