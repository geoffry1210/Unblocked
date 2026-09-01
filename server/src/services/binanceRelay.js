// Connects to Binance's combined kline WebSocket stream for every active
// symbol/timeframe pair, writes closed candles to Postgres, and forwards
// every tick (open or closed) to the browser-facing WebSocket server.

import WebSocket from "ws";
import { pool } from "../db/pool.js";

const TIMEFRAMES = ["1m", "15m", "1h", "4h", "1d"];
const RECONNECT_DELAY_MS = 5000;

async function getActiveSymbols() {
  const { rows } = await pool.query(
    "SELECT pair FROM symbols WHERE active = true ORDER BY pair"
  );
  return rows.map((r) => r.pair.toLowerCase());
}

function buildStreamUrl(symbols) {
  const streams = [];
  for (const symbol of symbols) {
    for (const tf of TIMEFRAMES) {
      streams.push(`${symbol}@kline_${tf}`);
    }
  }
  // Binance combined stream endpoint, max ~1024 streams per connection —
  // 15 symbols x 5 timeframes = 75, well within the limit.
  return `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
}

async function upsertCandle(symbol, timeframe, k) {
  await pool.query(
    `INSERT INTO candles (symbol, timeframe, open_time, open, high, low, close, volume)
     VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8)
     ON CONFLICT (symbol, timeframe, open_time)
     DO UPDATE SET open = $4, high = $5, low = $6, close = $7, volume = $8`,
    [symbol, timeframe, k.t, k.o, k.h, k.l, k.c, k.v]
  );
}

export async function startBinanceRelay({ broadcastCandle }) {
  const symbols = await getActiveSymbols();
  if (symbols.length === 0) {
    console.warn("No active symbols in DB — seed the symbols table first (see symbols.md)");
    return;
  }

  connect(symbols, broadcastCandle);
}

function connect(symbols, broadcastCandle) {
  const url = buildStreamUrl(symbols);
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`Binance relay connected — ${symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
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

    const symbol = k.s; // e.g. 'BTCUSDT'
    const timeframe = k.i; // e.g. '15m'
    const candle = {
      openTime: k.t,
      o: Number(k.o),
      h: Number(k.h),
      l: Number(k.l),
      c: Number(k.c),
      v: Number(k.v),
    };

    // Always forward the live tick so the chart's current (unclosed) candle
    // updates in real time.
    broadcastCandle(symbol, timeframe, candle, k.x);

    // Only persist to Postgres once the candle is closed — writing on
    // every tick would be excessive and unnecessary for historical data.
    if (k.x) {
      try {
        await upsertCandle(symbol, timeframe, k);
      } catch (err) {
        console.error(`Failed to write candle ${symbol} ${timeframe}`, err);
      }
    }
  });

  ws.on("close", () => {
    console.warn(`Binance relay disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(symbols, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error("Binance relay error", err.message);
    ws.close();
  });
}
