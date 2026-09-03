// WebSocket server browser clients connect to for live candle updates.
//
// Protocol (client -> server):
//   { "type": "subscribe",   "exchange": "binance", "marketType": "spot", "symbol": "BTCUSDT", "timeframe": "15m" }
//   { "type": "unsubscribe", "exchange": "binance", "marketType": "spot", "symbol": "BTCUSDT", "timeframe": "15m" }
//
// Protocol (server -> client):
//   { "type": "candle", "exchange": "binance", "marketType": "spot", "symbol": "BTCUSDT", "timeframe": "15m", "candle": {...}, "closed": false }
//   { "type": "whale",  "symbol": "BTCUSDT", "event": {...} }
//
// One client can subscribe to multiple exchange+marketType+symbol+timeframe
// channels at once (e.g. main chart + watchlist mini-charts).

import { WebSocketServer } from "ws";

const channelKey = (exchange, marketType, symbol, timeframe) => `${exchange}:${marketType}:${symbol}:${timeframe}`;

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // channel -> Set of client sockets subscribed to it
  const channels = new Map();

  wss.on("connection", (ws) => {
    ws.subscriptions = new Set();

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed messages
      }

      // exchange/marketType default to binance/spot so older clients (or
      // ones that haven't been updated yet) keep working unchanged.
      const { type, symbol, timeframe } = msg;
      const exchange = msg.exchange || "binance";
      const marketType = msg.marketType || "spot";
      if (!symbol || !timeframe) return;
      const key = channelKey(exchange, marketType, symbol, timeframe);

      if (type === "subscribe") {
        if (!channels.has(key)) channels.set(key, new Set());
        channels.get(key).add(ws);
        ws.subscriptions.add(key);
      }

      if (type === "unsubscribe") {
        channels.get(key)?.delete(ws);
        ws.subscriptions.delete(key);
      }
    });

    ws.on("close", () => {
      // Clean up all channel memberships for this client
      for (const key of ws.subscriptions) {
        channels.get(key)?.delete(ws);
      }
    });
  });

  // Called by an exchange adapter on every tick (open or closed candle)
  function broadcastCandle(exchange, marketType, symbol, timeframe, candle, closed) {
    const key = channelKey(exchange, marketType, symbol, timeframe);
    const clients = channels.get(key);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify({ type: "candle", exchange, marketType, symbol, timeframe, candle, closed });
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  // Called when a whale event comes in from CoinRadar (Phase 3). Whale
  // events are on-chain/ticker-based, not exchange-specific, so this
  // broadcasts to every channel for the symbol regardless of which
  // exchange or market type the client currently has open.
  function broadcastWhaleEvent(symbol, event) {
    for (const [key, clients] of channels.entries()) {
      if (!key.includes(`:${symbol}:`)) continue;
      const payload = JSON.stringify({ type: "whale", symbol, event });
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  }

  return { broadcastCandle, broadcastWhaleEvent };
}
