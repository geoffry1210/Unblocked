import { pool } from "./pool.js";

export async function upsertCandle({ exchange, marketType, symbol, timeframe, openTimeMs, o, h, l, c, v }) {
  await pool.query(
    `INSERT INTO candles (exchange, market_type, symbol, timeframe, open_time, open, high, low, close, volume)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8, $9, $10)
     ON CONFLICT (exchange, market_type, symbol, timeframe, open_time)
     DO UPDATE SET open = $6, high = $7, low = $8, close = $9, volume = $10`,
    [exchange, marketType, symbol, timeframe, openTimeMs, o, h, l, c, v]
  );
}

export async function getActiveSymbols(exchange, marketType) {
  const { rows } = await pool.query(
    "SELECT pair FROM symbols WHERE active = true AND exchange = $1 AND market_type = $2 ORDER BY pair",
    [exchange, marketType]
  );
  return rows.map((r) => r.pair);
}
