// Historical candle backfill — a one-off script, NOT part of the live
// server/relay. Run it manually (locally, from Termux, wherever) pointed at
// the same DATABASE_URL your Render services use, and it walks each
// exchange's public REST kline endpoint to fill in real history.
//
// Why this exists: the live relay (server/src/services/exchanges/*) only
// writes a candle the moment it closes — it has never had a way to reach
// into the past. This script is the missing other half.
//
// Depth policy per timeframe (chosen deliberately, not "as much as
// possible" for everything — full 1-minute history across years would be
// tens of millions of rows per symbol, likely blowing past a free Neon
// instance's storage and taking hours against exchange rate limits):
//   1d / 4h / 1h  -> full history, however far back each exchange/pair goes
//   15m           -> last 2 years
//   1m            -> last 90 days
//
// Ceiling per exchange (crypto reality check, not a limitation of this
// script): no exchange here predates 2017 (Binance's own launch), so "full
// history" tops out there at the earliest, later for newer listings and for
// Bybit/Bitunix. True pre-2017 BTC history would need a different data
// source entirely (e.g. a historical index API) — out of scope here.
//
// Usage:
//   node scripts/backfill.js                       # every active symbol, every exchange
//   node scripts/backfill.js --exchange=binance     # just one exchange
//   node scripts/backfill.js --symbol=BTCUSDT       # just one pair (across exchanges)
//   node scripts/backfill.js --timeframe=1d,4h,1h   # skip 15m/1m (fastest, smallest)
//
// Safe to re-run any time — upsertCandle is an ON CONFLICT DO UPDATE, so
// re-running just re-fills gaps / refreshes overlapping ranges, it never
// duplicates rows.
//
// Network resilience: every request has a hard 15s timeout via
// AbortController. Plain fetch() has NO built-in timeout — over an
// unstable connection (mobile data, VPN) a stalled TCP connection can hang
// forever with no error, which is exactly what silently froze an earlier
// run partway through. Now a stalled request aborts, retries, and if it
// keeps failing, that one symbol/timeframe is marked FAILED and the script
// moves on instead of hanging.

import { pool } from "../src/db/pool.js";
import { upsertCandle } from "../src/db/candles.js";

const TIMEFRAMES = ["1m", "15m", "1h", "4h", "1d"];
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

// ---- per-exchange REST fetchers ----
// Each yields raw candle rows via onBatch(rows) as it pages, rather than
// accumulating everything in memory — these ranges can be tens of
// thousands of candles for older pairs on 1h/1d.

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
    if (lastOpenTime <= cursor) break; // no progress guard
    cursor = lastOpenTime + 1;
    if (data.length < limit) break; // caught up to "now"
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
    // Bybit returns newest-first: [start, open, high, low, close, volume, turnover]
    const rows = list.map((k) => ({ openTime: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
    await onBatch(rows);
    const oldestStart = Number(list[list.length - 1][0]);
    if (oldestStart <= startTime) break; // reached our requested window floor
    if (oldestStart >= end) break; // no progress guard
    end = oldestStart - 1;
    if (list.length < limit) break; // fewer than a full page => reached earliest data
    await sleep(150);
  }
}

const BITUNIX_BASE = "https://fapi.bitunix.com/api/v1/futures/market/kline";

async function backfillBitunix({ symbol, timeframe, startTime, onBatch }) {
  const limit = 200; // Bitunix's documented max
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
    await sleep(120); // stay under Bitunix's 10 req/sec/ip
  }
}

// ---- shared insert helper — small bounded concurrency so we don't hand
// Neon's free-tier connection limit a few hundred simultaneous writes ----
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
  // mexc / weex intentionally omitted — no live relay exists for them yet,
  // so backfilling would just create data that immediately goes stale
  // with no forward feed to keep it current.
};

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );
  return {
    exchange: args.exchange || null,
    symbol: args.symbol || null,
    timeframes: args.timeframe ? args.timeframe.split(",") : TIMEFRAMES,
  };
}

async function main() {
  const { exchange: exchangeFilter, symbol: symbolFilter, timeframes } = parseArgs();

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
    console.log(`Skipping ${skipped.length} symbol(s) on exchanges with no live relay yet: ${[...new Set(skipped.map((s) => s.exchange))].join(", ")}`);
  }

  console.log(`Backfilling ${runnable.length} exchange/market/symbol combo(s) x ${timeframes.length} timeframe(s)\n`);

  let totalCandles = 0;
  for (const { exchange, market_type: marketType, pair: symbol } of runnable) {
    for (const timeframe of timeframes) {
      if (!TIMEFRAMES.includes(timeframe)) continue;
      const startTime = windowStart(timeframe);
      let countForThis = 0;
      process.stdout.write(`${exchange}/${marketType} ${symbol} ${timeframe} ... `);
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
        console.log(`${countForThis} candles`);
        totalCandles += countForThis;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. ${totalCandles} candles written/updated across ${runnable.length} symbol(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill crashed:", err);
  process.exit(1);
});
