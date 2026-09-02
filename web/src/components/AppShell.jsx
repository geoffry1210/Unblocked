import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import { sma, ema, bollinger, rsi, macd, vwap, stochRsi } from "../lib/indicators.js";
import { CandleChart, RSIPane, MACDPane, StochRsiPane } from "./Chart.jsx";
import { AdSlot } from "./AdSlot.jsx";

const INDICATOR_DEFS = [
  { key: "ma20", label: "MA 20", color: "#F5B700", type: "overlay" },
  { key: "ema9", label: "EMA 9", color: "#2ED9A0", type: "overlay" },
  { key: "bb", label: "Bollinger", color: "#7C5CFF", type: "overlay" },
  { key: "vwap", label: "VWAP", color: "#FF9F40", type: "overlay" },
  { key: "rsi", label: "RSI", color: "#7C5CFF", type: "pane" },
  { key: "macd", label: "MACD", color: "#F5B700", type: "pane" },
  { key: "stochrsi", label: "Stoch RSI", color: "#2ED9A0", type: "pane" },
];

const DRAW_TOOLS = [
  { key: "trendline", label: "✎ trendline", clicksNeeded: 2 },
  { key: "horizontal", label: "— h-ray", clicksNeeded: 1 },
  { key: "fib", label: "◇ fib", clicksNeeded: 2 },
];

function drawingsStorageKey(symbol, tf) {
  return `unblocked.drawings.${symbol}.${tf}`;
}

function loadDrawings(symbol, tf) {
  try {
    const raw = localStorage.getItem(drawingsStorageKey(symbol, tf));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function WhalePulseLayer({ events, candles }) {
  // Places each marker at the x-position of the candle whose time window
  // contains the event — event.time comes from CoinRadar as unix seconds,
  // candle.t is a JS ms timestamp. Falls back to skipping markers whose
  // event predates the currently loaded candle window (e.g. right after a
  // symbol/timeframe switch, before the new history has finished loading).
  if (candles.length === 0) return null;
  const w = 100 / candles.length;

  function xForTime(eventTimeSec) {
    const eventMs = eventTimeSec * 1000;
    let idx = candles.findIndex((c) => c.t > eventMs);
    if (idx === -1) idx = candles.length - 1;
    if (idx === 0 && candles[0].t > eventMs) return null;
    return idx * w + w / 2;
  }

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {events.map((e) => {
        const x = xForTime(e.time);
        if (x == null) return null;
        const valLabel = e.value >= 1e6 ? `${(e.value / 1e6).toFixed(2)}M` : e.value >= 1e3 ? `${(e.value / 1e3).toFixed(2)}K` : e.value?.toFixed(2);
        return (
          <div
            key={e.id}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: "55%",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#7C5CFF",
              animation: "whalePulse 2.2s ease-out",
            }}
            title={`🐋 ${valLabel} — ${e.from?.slice(0, 8)}... → ${e.to?.slice(0, 8)}...`}
          />
        );
      })}
    </div>
  );
}

function PriceTicker({ candles, connected }) {
  if (candles.length < 2) {
    return (
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#4A5063" }}>
        {connected ? "loading price..." : "connecting..."}
      </div>
    );
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const up = last.c >= prev.c;
  const [flash, setFlash] = useState(false);
  const lastRef = useRef(last.c);
  useEffect(() => {
    if (last.c !== lastRef.current) {
      setFlash(true);
      lastRef.current = last.c;
      const t = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(t);
    }
  }, [last.c]);
  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 700, color: flash ? (up ? "#2ED9A0" : "#FF5C77") : "#E8EAED", transition: "color 250ms ease", whiteSpace: "nowrap" }}>
      ${last.c < 10 ? last.c.toFixed(4) : last.c.toFixed(2)}
      <span style={{ fontSize: 12, marginLeft: 8, color: up ? "#2ED9A0" : "#FF5C77" }}>
        {up ? "▲" : "▼"} {(((last.c - prev.c) / prev.c) * 100).toFixed(2)}%
      </span>
      {!connected && <span style={{ fontSize: 10, marginLeft: 8, color: "#FF5C77" }}>● reconnecting</span>}
    </div>
  );
}

export function AppShell({ onBack }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [activeSymbol, setActiveSymbol] = useState(null);
  const [tf, setTf] = useState("15m");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState({ ma20: true, ema9: false, bb: false, vwap: false, rsi: true, macd: false, stochrsi: false });

  // Drawing tools — drawTool is which tool is armed (null when off).
  // drawings is the full list for the current symbol+timeframe; each has
  // its own id/type/points so multiple can coexist and be removed individually.
  const [drawTool, setDrawTool] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [pendingPoint, setPendingPoint] = useState(null);

  useEffect(() => {
    fetchSymbols()
      .then((rows) => {
        setSymbols(rows);
        if (rows.length > 0) setActiveSymbol(rows[0].pair);
      })
      .catch((err) => {
        console.error(err);
        setSymbolsError("Could not reach the server — check VITE_API_URL and that /server is running.");
      });
  }, []);

  const { candles, whaleEvents, loading, connected } = useMarketData(activeSymbol || "", tf);

  // Drawings are scoped per symbol+timeframe — load fresh whenever either
  // changes, and cancel any in-progress drawing (a pending first click
  // doesn't carry over to a different chart).
  useEffect(() => {
    if (!activeSymbol) return;
    setDrawings(loadDrawings(activeSymbol, tf));
    setPendingPoint(null);
    setDrawTool(null);
  }, [activeSymbol, tf]);

  useEffect(() => {
    if (!activeSymbol) return;
    try {
      localStorage.setItem(drawingsStorageKey(activeSymbol, tf), JSON.stringify(drawings));
    } catch {
      // Storage can fail (quota, private browsing) — drawings just won't
      // persist across reloads in that case, not worth surfacing an error for.
    }
  }, [drawings, activeSymbol, tf]);

  const closes = candles.map((c) => c.c);
  const indicators = useMemo(
    () => ({
      smaVals: sma(closes, 20),
      emaVals: ema(closes, 9),
      bbVals: bollinger(closes, 20, 2),
      vwapVals: vwap(candles),
      rsiVals: rsi(closes, 14),
      macdVals: macd(closes),
      stochRsiVals: stochRsi(closes, 14, 14, 3),
    }),
    [candles]
  );

  const overlays = [];
  if (active.ma20) overlays.push({ values: indicators.smaVals, color: "#F5B700" });
  if (active.ema9) overlays.push({ values: indicators.emaVals, color: "#2ED9A0" });
  if (active.bb) {
    overlays.push({ values: indicators.bbVals.upper, color: "#7C5CFF", dash: "1,1" });
    overlays.push({ values: indicators.bbVals.lower, color: "#7C5CFF", dash: "1,1" });
  }
  if (active.vwap) overlays.push({ values: indicators.vwapVals, color: "#FF9F40" });

  const filtered = symbols.filter((s) => s.display.toLowerCase().includes(query.toLowerCase()));
  const toggleIndicator = (key) => setActive((a) => ({ ...a, [key]: !a[key] }));

  const selectDrawTool = (key) => {
    setPendingPoint(null);
    setDrawTool((cur) => (cur === key ? null : key));
  };

  const handleChartClick = (x, y) => {
    if (!drawTool) return;
    const toolDef = DRAW_TOOLS.find((t) => t.key === drawTool);
    if (toolDef.clicksNeeded === 1) {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: [{ x, y }] }]);
      setDrawTool(null);
      return;
    }
    if (!pendingPoint) {
      setPendingPoint({ x, y });
    } else {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: [pendingPoint, { x, y }] }]);
      setPendingPoint(null);
      setDrawTool(null);
    }
  };

  const removeDrawing = (id) => setDrawings((prev) => prev.filter((d) => d.id !== id));

  if (symbolsError) {
    return (
      <div style={{ padding: 40, color: "#FF5C77", fontFamily: "'Manrope', sans-serif" }}>
        {symbolsError}
        <div style={{ marginTop: 16 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #2A3140", color: "#E8EAED", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}>← back</button>
        </div>
      </div>
    );
  }

  if (!activeSymbol) {
    return <div style={{ padding: 40, color: "#8B93A3", fontFamily: "'Manrope', sans-serif" }}>Loading symbols...</div>;
  }

  const activeDisplay = symbols.find((s) => s.pair === activeSymbol)?.display || activeSymbol;
  const paneCount = (active.rsi ? 1 : 0) + (active.macd ? 1 : 0) + (active.stochrsi ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #1D232F", flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#8B93A3", cursor: "pointer", fontSize: 13 }}>← back</button>

        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={activeDisplay}
            style={{ background: "#131720", border: "1px solid #2A3140", borderRadius: 6, padding: "6px 10px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, width: 130, outline: "none" }}
          />
          {query && (
            <div style={{ position: "absolute", top: "110%", left: 0, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, zIndex: 10, width: 160, overflow: "hidden" }}>
              {filtered.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#4A5063", fontFamily: "'Manrope', sans-serif" }}>No matches</div>}
              {filtered.map((s) => (
                <div key={s.pair} onClick={() => { setActiveSymbol(s.pair); setQuery(""); }} style={{ padding: "8px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#E8EAED", cursor: "pointer" }}>
                  {s.display}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["1m", "15m", "1h", "4h", "1d"].map((t) => (
            <button key={t} onClick={() => setTf(t)} style={{ background: tf === t ? "#191F2A" : "transparent", color: tf === t ? "#F5B700" : "#8B93A3", border: "1px solid " + (tf === t ? "#2A3140" : "transparent"), borderRadius: 6, padding: "5px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {INDICATOR_DEFS.map((ind) => (
            <button key={ind.key} onClick={() => toggleIndicator(ind.key)} style={{ background: active[ind.key] ? `${ind.color}22` : "transparent", color: active[ind.key] ? ind.color : "#8B93A3", border: "1px solid " + (active[ind.key] ? ind.color + "55" : "#232A38"), borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
              {ind.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {DRAW_TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => selectDrawTool(t.key)}
              style={{ background: drawTool === t.key ? "#F5B70022" : "transparent", color: drawTool === t.key ? "#F5B700" : "#8B93A3", border: "1px solid " + (drawTool === t.key ? "#F5B70055" : "#232A38"), borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}
            >
              {drawTool === t.key ? (pendingPoint ? "click 2nd pt" : t.clicksNeeded === 1 ? "click point" : "click 1st pt") : t.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto" }}>
          <PriceTicker candles={candles} connected={connected} />
        </div>
      </header>

      <div className="app-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside className="symbol-sidebar" style={{ width: 190, borderRight: "1px solid #1D232F", padding: "14px 12px", overflow: "auto" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#4A5063", marginBottom: 10, letterSpacing: 1 }}>WATCHLIST</div>
          {symbols.map((s) => (
            <div key={s.pair} onClick={() => setActiveSymbol(s.pair)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 6px", borderRadius: 6, marginBottom: 2, cursor: "pointer", background: s.pair === activeSymbol ? "#191F2A" : "transparent" }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#E8EAED" }}>{s.display}</span>
            </div>
          ))}
        </aside>

        <main style={{ flex: 1, position: "relative", padding: 16, overflow: "auto" }}>
          <WhalePulseLayer events={whaleEvents} candles={candles} />
          {loading ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>loading candles...</div>
          ) : candles.length === 0 ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>
              No historical candles yet for {activeDisplay} — the relay writes candles as they close, so a brand-new symbol needs a little time to build up data.
            </div>
          ) : (
            <>
              <CandleChart
                candles={candles}
                overlays={overlays}
                height={paneCount > 0 ? 300 : 420}
                up="#2ED9A0"
                down="#FF5C77"
                drawings={drawings}
                pendingPoint={pendingPoint}
                drawTool={drawTool}
                onChartClick={handleChartClick}
              />
              {active.rsi && <RSIPane values={indicators.rsiVals} height={70} />}
              {active.macd && <MACDPane data={indicators.macdVals} height={70} />}
              {active.stochrsi && <StochRsiPane k={indicators.stochRsiVals.k} d={indicators.stochRsiVals.d} height={70} />}

              {drawings.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {drawings.map((d) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 6, padding: "3px 8px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8B93A3" }}>
                      {d.type}
                      <span onClick={() => removeDrawing(d.id)} style={{ cursor: "pointer", color: "#FF5C77", fontWeight: 700 }}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <AdSlot />
    </div>
  );
}
