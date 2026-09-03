// Binance — spot and USDT-margined perpetual futures.
//
// Both products expose the identical combined-stream kline schema; only the
// WebSocket host differs (spot: stream.binance.com, perp: fstream.binance.com).
// Verified against Binance's public API docs.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";

const TIMEFRAMES = ["1m", "15m", "1h", "4h", "1d"];
const RECONNECT_DELAY_MS = 5000;

const HOSTS = {
  spot: "wss://stream.binance.com:9443",
  perp: "wss://fstream.binance.com",
};

function buildStreamUrl(marketType, symbols) {
  const streams = [];
  for (const symbol of symbols) {
    for (const tf of TIMEFRAMES) {
      streams.push(`${symbol.toLowerCase()}@kline_${tf}`);
    }
  }
  return `${HOSTS[marketType]}/stream?streams=${streams.join("/")}`;
}

export async function startBinanceRelay({ marketType, broadcastCandle }) {
  const symbols = await getActiveSymbols("binance", marketType);
  if (symbols.length === 0) {
    console.warn(`No active binance/${marketType} symbols — skipping (seed the symbols table to enable)`);
    return;
  }
  connect(marketType, symbols, broadcastCandle);
}

function connect(marketType, symbols, broadcastCandle) {
  const url = buildStreamUrl(marketType, symbols);
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`Binance ${marketType} relay connected — ${symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
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
    console.warn(`Binance ${marketType} relay disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(marketType, symbols, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Binance ${marketType} relay error`, err.message);
    ws.close();
  });
}
