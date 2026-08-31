// Phase 1: connects to Binance kline WebSocket streams for every active
// symbol/timeframe in the `symbols` table, normalizes each closed candle,
// writes it to Postgres, and forwards live ticks to wsServer.js for
// broadcast to connected browser clients.
//
// export function startBinanceRelay() { ... }
