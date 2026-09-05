// Core historical-backfill logic, extracted so it can run either as a CLI
// script (server/scripts/backfill.js) OR triggered over HTTP from
// server/src/routes/adminBackfill.js — the latter runs it on Render's own
// network, which is what you want for Binance specifically: Render can
// reach Binance directly (the live relay proves this — it's been writing
// Binance candles this whole time), so running from there sidesteps a
// mobile carrier/VPN connection dropping mid-backfill entirely, rather
// than trying to make the phone-side run more resilient to a connection
// that just isn't reliably reachable to begin with.
//
// Depth policy per timeframe (deliberately not "as much as possible" for
// everything — full 1-minute history across years would be tens of
// millions of rows per symbol, likely blowing past a free Neon instance's
// storage and taking hours against exchange rate limits):
//   1d / 4h / 1h  -> full history, however far back each exchange/pair goes
//   15m           -> last 2 years
//   1m            -> last 90 days

import { pool } from "../db/pool.js";
import { upsertCandle } from "../db/candles.js";

export const TIMEFRAMES = ["1m", "15m", "1h", "4h", "1d"];
const DEPTH_POLICY = {
  "1d": { mode: "full" },
  "4h": { mode: "full" },
  "1h": { mode: "full" },
  "15m": { mode: "window", days: 730 },
  "1m": { mode: "window", days: 90 },
};

const FETCH_TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err.name === "AbortError";
      const label = timedOut ? `timed out after ${FETCH_TIMEOUT_MS}ms` : err.message;
      if (attempt === retries) throw new Error(label);
      await sleep(500 * (attempt + 1));
    }
  }
}

const BINANCE_HOSTS = {
  spot: { base: "https://api.binance.com/api/v3/klines", limit: 1000 },
  perp: { base: "https://fapi.binance.com/fapi/v1/klines", limit: 1500 },
};

async function backfillBinance({ marketType, symbol, timeframe, startTime, onBatch }) {
  const { base, limit } = BINANCE_HOSTS[marketType];
  let cursor = startTime;
  for (;;) {
    const url = `${base}?symbol=${symbol}&interval=${timeframe}&startTime=${cursor}&limit=${limit}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) break;
    const rows = data.map((k) => ({ openTime: k[0], o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
    await onBatch(rows);
    const lastOpenTime = data[data.length - 1][0];
    if (lastOpenTime <= cursor) break;
    cursor = lastOpenTime + 1;
    if (data.length < limit) break;
    await sleep(200);
  }
}

const TF_TO_BYBIT = { "1m": "1", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const BYBIT_CATEGORY = { spot: "spot", perp: "linear" };

async function backfillBybit({ marketType, symbol, timeframe, startTime, onBatch }) {
  const category = BYBIT_CATEGORY[marketType];
  const interval = TF_TO_BYBIT[timeframe];
  const limit = 1000;
  let end = Date.now();
  for (;;) {
    const url = `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${interval}&end=${end}&limit=${limit}`;
    const json = await fetchJson(url);
    const list = json?.result?.list;
    if (!Array.isArray(list) || list.length === 0) break;
    const rows = list.map((k) => ({ openTime: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
    await onBatch(rows);
    const oldestStart = Number(list[list.length - 1][0]);
    if (oldestStart <= startTime) break;
    if (oldestStart >= end) break;
    end = oldestStart - 1;
    if (list.length < limit) break;
    await sleep(150);
  }
}

const BITUNIX_BASE = "https://fapi.bitunix.com/api/v1/futures/market/kline";

async function backfillBitunix({ symbol, timeframe, startTime, onBatch }) {
  const limit = 200;
  let cursor = startTime;
  const now = Date.now();
  for (;;) {
    const url = `${BITUNIX_BASE}?symbol=${symbol}&interval=${timeframe}&startTime=${cursor}&endTime=${now}&limit=${limit}`;
    const json = await fetchJson(url);
    const data = json?.data;
    if (!Array.isArray(data) || data.length === 0) break;
    const rows = data.map((k) => ({ openTime: Number(k.time), o: Number(k.open), h: Number(k.high), l: Number(k.low), c: Number(k.close), v: Number(k.baseVol) }));
    await onBatch(rows);
    const lastOpenTime = rows[rows.length - 1].openTime;
    if (lastOpenTime <= cursor) break;
    cursor = lastOpenTime + 1;
    if (data.length < limit) break;
    await sleep(120);
  }
}

async function insertRows(exchange, marketType, symbol, timeframe, rows) {
  const CONCURRENCY = 8;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map((r) =>
        upsertCandle({ exchange, marketType, symbol, timeframe, openTimeMs: r.openTime, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }).catch((err) =>
          console.error(`  insert failed ${exchange}/${marketType} ${symbol} ${timeframe} @${r.openTime}:`, err.message)
        )
      )
    );
  }
}

function windowStart(timeframe) {
  const policy = DEPTH_POLICY[timeframe];
  if (policy.mode === "full") return 0;
  return Date.now() - policy.days * 86400_000;
}

const FETCHERS = {
  binance: (args) => backfillBinance(args),
  bybit: (args) => backfillBybit(args),
  bitunix: (args) => backfillBitunix(args),
  // mexc / weex intentionally omitted — no live relay exists for them yet.
};

/**
 * Runs a backfill pass. `onProgress(line)` gets a log line per
 * symbol/timeframe combo as it completes — the HTTP route uses this to
 * keep an in-memory status the phone can poll instead of tailing logs.
 */
export async function runBackfill({ exchangeFilter = null, symbolFilter = null, timeframes = TIMEFRAMES, onProgress = () => {} } = {}) {
  const { rows: combos } = await pool.query(
    `SELECT DISTINCT exchange, market_type, pair FROM symbols
     WHERE active = true
       AND ($1::text IS NULL OR exchange = $1)
       AND ($2::text IS NULL OR pair = $2)
     ORDER BY exchange, market_type, pair`,
    [exchangeFilter, symbolFilter]
  );

  const runnable = combos.filter((c) => FETCHERS[c.exchange]);
  const skipped = combos.filter((c) => !FETCHERS[c.exchange]);
  if (skipped.length) {
    onProgress(`Skipping ${skipped.length} symbol(s) on exchanges with no live relay yet: ${[...new Set(skipped.map((s) => s.exchange))].join(", ")}`);
  }
  onProgress(`Backfilling ${runnable.length} exchange/market/symbol combo(s) x ${timeframes.length} timeframe(s)`);

  let totalCandles = 0;
  const failures = [];
  for (const { exchange, market_type: marketType, pair: symbol } of runnable) {
    for (const timeframe of timeframes) {
      if (!TIMEFRAMES.includes(timeframe)) continue;
      const startTime = windowStart(timeframe);
      let countForThis = 0;
      try {
        await FETCHERS[exchange]({
          marketType,
          symbol,
          timeframe,
          startTime,
          onBatch: async (rows) => {
            await insertRows(exchange, marketType, symbol, timeframe, rows);
            countForThis += rows.length;
          },
        });
        onProgress(`${exchange}/${marketType} ${symbol} ${timeframe} ... ${countForThis} candles`);
        totalCandles += countForThis;
      } catch (err) {
        onProgress(`${exchange}/${marketType} ${symbol} ${timeframe} ... FAILED: ${err.message}`);
        failures.push({ exchange, marketType, symbol, timeframe, error: err.message });
      }
    }
  }

  const summary = `Done. ${totalCandles} candles written/updated across ${runnable.length} symbol(s). ${failures.length} failure(s).`;
  onProgress(summary);
  return { totalCandles, symbolCount: runnable.length, failures, summary };
}
