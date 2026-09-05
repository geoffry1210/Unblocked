// Splits a symbol list into shards sized so that (symbols-per-shard x
// timeframes-per-symbol) stays under maxStreamsPerConnection, and manages
// one independently-reconnecting WebSocket connection per shard.
//
// Why this exists: with ~24 curated symbols, cramming everything into one
// connection was fine. Once the symbol list grows to hundreds of pairs
// (all USDT/USD/USDC pairs across an exchange), a single connection either
// hits the exchange's own per-connection stream cap or — in Binance's case
// — produces a WebSocket URL far too long to even open. Sharding into
// several smaller connections sidesteps both problems and is standard
// practice for exchanges with large symbol counts.
//
// maxStreamsPerConnection defaults conservatively (200) — well under every
// documented exchange limit here, leaving headroom rather than chasing the
// exact ceiling.

export function shardSymbols(symbols, timeframesPerSymbol, maxStreamsPerConnection = 200) {
  const perShard = Math.max(1, Math.floor(maxStreamsPerConnection / timeframesPerSymbol));
  const shards = [];
  for (let i = 0; i < symbols.length; i += perShard) {
    shards.push(symbols.slice(i, i + perShard));
  }
  return shards;
}

/**
 * Kicks off one independent connection per shard. `connectShard(shardSymbols,
 * shardIndex)` should establish the connection, subscribe, and handle its
 * own reconnect-on-close (same pattern each adapter already uses) — this
 * helper just fans that out across shards and logs the split.
 */
export function startSharded(symbols, timeframesPerSymbol, connectShard, { label, maxStreamsPerConnection = 200 } = {}) {
  const shards = shardSymbols(symbols, timeframesPerSymbol, maxStreamsPerConnection);
  if (shards.length > 1) {
    console.log(`${label}: ${symbols.length} symbols split across ${shards.length} connections (~${shards[0].length} symbols each)`);
  }
  shards.forEach((shardSymbols, i) => connectShard(shardSymbols, i));
}
