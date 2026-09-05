// Binance — spot and USDT-margined perpetual futures.
//
// Both products expose the identical combined-stream kline schema; only the
// WebSocket host differs (spot: stream.binance.com, perp: fstream.binance.com).
// Verified against Binance's public API docs.
//
// IMPORTANT: streams are subscribed via the SUBSCRIBE method sent after
// connecting, NOT embedded in the connection URL. The URL-embedded
// combined-stream style (.../stream?streams=a/b/c) works fine for a
// handful of symbols but produces a URL far too long to open once the
// symbol list grows into the hundreds (every USDT/USD/USDC pair) — this
// used to be how it worked here and quietly broke at that scale. Sharding
// (see ../sharding.js) further splits large symbol lists across several
// connections so no single connection's subscription count gets close to
// Binance's documented per-connection ceiling.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";
import { startSharded } from "./sharding.js";

const TIMEFRAMES = ["1m", "15m", "1h", "4h", "1d"];
const RECONNECT_DELAY_MS = 5000;

const HOSTS = {
  spot: "wss://stream.binance.com:9443/stream",
  perp: "wss://fstream.binance.com/stream",
};

export async function startBinanceRelay({ marketType, broadcastCandle }) {
  const symbols = await getActiveSymbols("binance", marketType);
  if (symbols.length === 0) {
    console.warn(`No active binance/${marketType} symbols — skipping (seed the symbols table to enable)`);
    return;
  }
  startSharded(symbols, TIMEFRAMES.length, (shardSymbols, shardIndex) => connect(marketType, shardSymbols, shardIndex, broadcastCandle), {
    label: `Binance ${marketType} relay`,
  });
}

function connect(marketType, symbols, shardIndex, broadcastCandle) {
  const ws = new WebSocket(HOSTS[marketType]);

  ws.on("open", () => {
    console.log(`Binance ${marketType} relay [shard ${shardIndex}] connected — ${symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
    const streams = [];
    for (const symbol of symbols) {
      for (const tf of TIMEFRAMES) {
        streams.push(`${symbol.toLowerCase()}@kline_${tf}`);
      }
    }
    // Binance accepts a single SUBSCRIBE call with all params, but chunk
    // anyway to stay well clear of any per-message size/rate quirks —
    // matches the same defensive chunking Bybit/Bitunix already use.
    let id = 1;
    for (let i = 0; i < streams.length; i += 50) {
      ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams.slice(i, i + 50), id: id++ }));
    }
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const k = msg.data?.k;
    if (!k) return;

    const symbol = k.s;
    const timeframe = k.i;
    const candle = { openTime: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) };

    broadcastCandle("binance", marketType, symbol, timeframe, candle, k.x);

    if (k.x) {
      try {
        await upsertCandle({ exchange: "binance", marketType, symbol, timeframe, openTimeMs: k.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      } catch (err) {
        console.error(`Failed to write binance/${marketType} candle ${symbol} ${timeframe}`, err);
      }
    }
  });

  ws.on("close", () => {
    console.warn(`Binance ${marketType} relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(marketType, symbols, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Binance ${marketType} relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
