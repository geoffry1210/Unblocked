const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function fetchSymbols() {
  const res = await fetch(`${API_URL}/symbols`);
  if (!res.ok) throw new Error("Failed to fetch symbols");
  return res.json();
}

export async function fetchCandles(symbol, timeframe, limit = 200) {
  const params = new URLSearchParams({ symbol, tf: timeframe, limit });
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
