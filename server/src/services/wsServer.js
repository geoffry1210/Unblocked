// Phase 1: WebSocket server browser clients connect to. Clients subscribe
// to a symbol+timeframe channel; binanceRelay.js pushes live candle updates
// here, which get broadcast only to clients subscribed to that channel.
//
// export function attachWebSocketServer(httpServer) { ... }
