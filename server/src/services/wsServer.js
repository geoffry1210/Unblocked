// WebSocket server browser clients connect to for live candle updates.
//
// Protocol (client -> server):
//   { "type": "subscribe",   "symbol": "BTCUSDT", "timeframe": "15m" }
//   { "type": "unsubscribe", "symbol": "BTCUSDT", "timeframe": "15m" }
//
// Protocol (server -> client):
//   { "type": "candle", "symbol": "BTCUSDT", "timeframe": "15m", "candle": {...}, "closed": false }
//   { "type": "whale",  "symbol": "BTCUSDT", "event": {...} }
//
// One client can subscribe to multiple symbol+timeframe channels at once
// (e.g. main chart + watchlist mini-charts).

import { WebSocketServer } from "ws";

const channelKey = (symbol, timeframe) => `${symbol}:${timeframe}`;

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

      const { type, symbol, timeframe } = msg;
      if (!symbol || !timeframe) return;
      const key = channelKey(symbol, timeframe);

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

  // Called by binanceRelay.js on every tick (open or closed candle)
  function broadcastCandle(symbol, timeframe, candle, closed) {
    const key = channelKey(symbol, timeframe);
    const clients = channels.get(key);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify({ type: "candle", symbol, timeframe, candle, closed });
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  // Called when a whale event comes in from CoinRadar (Phase 3)
  function broadcastWhaleEvent(symbol, event) {
    // Broadcast to every timeframe channel for this symbol — the marker
    // is timestamp-based, so the frontend places it correctly regardless
    // of which timeframe is currently displayed.
    for (const [key, clients] of channels.entries()) {
      if (!key.startsWith(`${symbol}:`)) continue;
      const payload = JSON.stringify({ type: "whale", symbol, event });
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  }

  return { broadcastCandle, broadcastWhaleEvent };
}
