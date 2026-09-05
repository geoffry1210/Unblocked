// Bitunix — perpetual futures only (their public API is futures-focused;
// no spot public WS endpoint was found in their docs). Verified against
// bitunix.com/api-docs/futures/websocket.
//
// IMPORTANT DIFFERENCE FROM BINANCE/BYBIT: Bitunix's kline push message
// carries only a push timestamp (`ts`) and the current OHLCV for that
// timestamp — no candle open-time and no "closed"/"confirm" flag. Candle
// boundaries and close detection are therefore INFERRED here (bucket =
// ts floored to the interval), not exchange-confirmed. A candle is
// persisted once we observe the *next* bucket starting, meaning writes
// lag the real close by up to ~500ms (their push interval). This is a
// reasonable heuristic, not a guarantee — worth knowing if exact candle
// close timing ever matters here.
//
// Sharded across multiple connections once the symbol list grows large
// (see ../sharding.js) — see binance.js's comment for the general
// rationale; applies equally here now that Bitunix pairs aren't limited
// to a small curated list.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";
import { startSharded } from "./sharding.js";

const RECONNECT_DELAY_MS = 5000;
const PING_INTERVAL_MS = 20000;
const WS_URL = "wss://fapi.bitunix.com/public/";

const TF_TO_CHANNEL = { "1m": "market_kline_1min", "15m": "market_kline_15min", "1h": "market_kline_60min", "4h": "market_kline_4h", "1d": "market_kline_1day" };
const CHANNEL_TO_TF = Object.fromEntries(Object.entries(TF_TO_CHANNEL).map(([tf, ch]) => [ch, tf]));
const TF_TO_MS = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const TIMEFRAMES = Object.keys(TF_TO_CHANNEL);

export async function startBitunixRelay({ broadcastCandle }) {
  const marketType = "perp";
  const symbols = await getActiveSymbols("bitunix", marketType);
  if (symbols.length === 0) {
    console.warn("No active bitunix/perp symbols — skipping (seed the symbols table to enable)");
    return;
  }
  startSharded(symbols, TIMEFRAMES.length, (shardSymbols, shardIndex) => connect(shardSymbols, shardIndex, broadcastCandle), {
    label: "Bitunix perp relay",
  });
}

function connect(symbols, shardIndex, broadcastCandle) {
  const ws = new WebSocket(WS_URL);
  let pingTimer;
  // key `${symbol}:${tf}` -> last seen {bucket, candle}, so we can detect
  // when a new bucket starts and treat the prior one as closed.
  const lastSeen = new Map();

  ws.on("open", () => {
    console.log(`Bitunix perp relay [shard ${shardIndex}] connected — ${symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
    const args = [];
    for (const symbol of symbols) {
      for (const tf of TIMEFRAMES) {
        args.push({ symbol, ch: TF_TO_CHANNEL[tf] });
      }
    }
    for (let i = 0; i < args.length; i += 50) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 50) }));
    }
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: "ping", ping: Math.floor(Date.now() / 1000) }));
    }, PING_INTERVAL_MS);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const tf = CHANNEL_TO_TF[msg.ch];
    if (!tf || !msg.data || !msg.symbol) return;

    const symbol = msg.symbol;
    const intervalMs = TF_TO_MS[tf];
    const bucket = Math.floor(Number(msg.ts) / intervalMs) * intervalMs;
    const candle = { openTime: bucket, o: Number(msg.data.o), h: Number(msg.data.h), l: Number(msg.data.l), c: Number(msg.data.c), v: Number(msg.data.b) };
    const key = `${symbol}:${tf}`;
    const prev = lastSeen.get(key);

    broadcastCandle("bitunix", "perp", symbol, tf, candle, false);

    if (prev && prev.bucket !== bucket) {
      broadcastCandle("bitunix", "perp", symbol, tf, prev.candle, true);
      try {
        await upsertCandle({ exchange: "bitunix", marketType: "perp", symbol, timeframe: tf, openTimeMs: prev.candle.openTime, o: prev.candle.o, h: prev.candle.h, l: prev.candle.l, c: prev.candle.c, v: prev.candle.v });
      } catch (err) {
        console.error(`Failed to write bitunix/perp candle ${symbol} ${tf}`, err);
      }
    }
    lastSeen.set(key, { bucket, candle });
  });

  ws.on("close", () => {
    clearInterval(pingTimer);
    console.warn(`Bitunix perp relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(symbols, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Bitunix perp relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
