const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function fetchSymbols() {
  const res = await fetch(`${API_URL}/symbols`);
  if (!res.ok) throw new Error("Failed to fetch symbols");
  return res.json();
}

// exchange/marketType MUST be passed now that multiple exchanges/markets
// share the same pair names — omitting them used to silently fall back to
// binance/spot server-side regardless of what the user actually selected.
export async function fetchCandles(symbol, timeframe, { exchange = "binance", marketType = "spot", limit = 1000, before } = {}) {
  const params = new URLSearchParams({ symbol, tf: timeframe, exchange, marketType, limit });
  if (before) params.set("before", before);
  const res = await fetch(`${API_URL}/candles?${params}`);
  if (!res.ok) throw new Error("Failed to fetch candles");
  const rows = await res.json();
  // Normalize Postgres numeric strings -> numbers, DB column names -> chart shape
  return rows.map((r) => ({
    o: Number(r.open),
    h: Number(r.high),
    l: Number(r.low),
    c: Number(r.close),
    v: Number(r.volume),
    t: new Date(r.open_time).getTime(),
  }));
}
