// Phase 3 — CoinRadar whale-alert integration.
//
// CoinRadar exposes GET /api/whale/:ticker (structured JSON transfer events,
// same underlying data as its Telegram /whale command). Rather than CoinRadar
// pushing to us, we poll it per symbol — simpler operationally since it keeps
// CoinRadar stateless about our service's existence, matching how the website
// API layer over there was built (plain GET endpoints, no webhooks).
//
// Dedupe is by tx hash so a symbol's recurring poll doesn't re-broadcast the
// same whale move every cycle.

const COINRADAR_API_URL = process.env.COINRADAR_API_URL || "https://coinradar-iehp.onrender.com";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min — matches CoinRadar's own dev-watch cadence, stays well inside free-tier API limits

// USDT pairs only in v1 (see symbols.md) — ticker for CoinRadar's API is the
// base asset, so strip the quote currency.
function tickerFromSymbol(symbol) {
  return symbol.replace(/USDT$/, "");
}

export function startWhaleAlertPoller({ symbols, broadcastWhaleEvent }) {
  const seenHashes = new Set();

  async function pollSymbol(symbol) {
    const ticker = tickerFromSymbol(symbol);
    try {
      const res = await fetch(`${COINRADAR_API_URL}/api/whale/${ticker}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found || !data.supported || !Array.isArray(data.events)) return;

      for (const event of data.events) {
        const key = event.hash || `${event.time}-${event.from}-${event.to}`;
        if (seenHashes.has(key)) continue;
        seenHashes.add(key);
        broadcastWhaleEvent(symbol, event);
      }
    } catch (err) {
      console.error(`Whale poll failed for ${symbol}:`, err.message);
    }
  }

  async function pollAll() {
    for (const symbol of symbols) {
      await pollSymbol(symbol);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  pollAll();
  const interval = setInterval(pollAll, POLL_INTERVAL_MS);

  const pruneInterval = setInterval(() => {
    if (seenHashes.size > 2000) seenHashes.clear();
  }, 60 * 60 * 1000);

  return () => {
    clearInterval(interval);
    clearInterval(pruneInterval);
  };
}
