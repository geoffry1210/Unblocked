// MEXC — NOT YET IMPLEMENTED.
//
// Why: MEXC's spot WebSocket kline stream now requires Protocol Buffers
// decoding (channel `spot@public.kline.v3.api.pb@<symbol>@<interval>` —
// the `.pb` suffix means the push payload is protobuf-encoded, not JSON).
// That needs MEXC's published .proto schema and a protobuf runtime dep,
// which is a meaningfully bigger lift than the plain-JSON exchanges here
// and wasn't verified in enough depth to ship with confidence.
//
// MEXC's futures WS (wss://contract.mexc.com/ws, channel "push.kline",
// plain JSON) looks implementable the same way as the other adapters —
// that's the more realistic next step if MEXC support is wanted before
// tackling the protobuf spot stream.

export async function startMexcRelay() {
  console.warn("MEXC adapter not yet implemented — see comment in mexc.js for why and what's next");
}
