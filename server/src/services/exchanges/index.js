// Exchange relay registry. Each adapter owns its own connection, reconnect,
// and candle-write logic — this file just starts whichever exchange/market
// type combos actually have active symbols seeded in the DB, so adding a
// new exchange×market_type pair is: write the adapter file, register it
// below, seed some symbol rows. No other file needs to change.

import { pool } from "../../db/pool.js";
import { startBinanceRelay } from "./binance.js";
import { startBybitRelay } from "./bybit.js";
import { startBitunixRelay } from "./bitunix.js";
import { startMexcRelay } from "./mexc.js";
import { startWeexRelay } from "./weex.js";

const ADAPTERS = {
  binance: (marketType, ctx) => startBinanceRelay({ marketType, ...ctx }),
  bybit: (marketType, ctx) => startBybitRelay({ marketType, ...ctx }),
  bitunix: (_marketType, ctx) => startBitunixRelay(ctx), // perp-only adapter, ignores marketType
  mexc: (_marketType, ctx) => startMexcRelay(ctx),
  weex: (_marketType, ctx) => startWeexRelay(ctx),
};

export async function startAllRelays({ broadcastCandle }) {
  const { rows } = await pool.query(
    "SELECT DISTINCT exchange, market_type FROM symbols WHERE active = true ORDER BY exchange, market_type"
  );

  if (rows.length === 0) {
    console.warn("No active symbols found across any exchange — nothing to relay");
    return;
  }

  for (const { exchange, market_type: marketType } of rows) {
    const start = ADAPTERS[exchange];
    if (!start) {
      console.warn(`No adapter registered for exchange "${exchange}" — skipping`);
      continue;
    }
    start(marketType, { broadcastCandle }).catch((err) => {
      console.error(`Failed to start ${exchange}/${marketType} relay`, err);
    });
  }
}
