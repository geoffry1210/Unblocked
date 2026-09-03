// Weex — NOT YET IMPLEMENTED.
//
// Why: no concrete, verifiable WebSocket endpoint URL or kline message
// schema was found for Weex's public market-data API — only marketing/wiki
// pages confirming a WS API exists, not its technical spec. Rather than
// guess at a connection URL and message format, this is left as a stub
// until real API docs can be found and verified (Weex may require a
// developer account to access full docs — worth checking their dashboard
// directly rather than public search).

export async function startWeexRelay() {
  console.warn("Weex adapter not yet implemented — no verified public API docs found, see comment in weex.js");
}
