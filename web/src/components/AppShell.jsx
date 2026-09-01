import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import { sma, ema, bollinger, rsi, macd } from "../lib/indicators.js";
import { CandleChart, RSIPane, MACDPane } from "./Chart.jsx";

const INDICATOR_DEFS = [
  { key: "ma20", label: "MA 20", color: "#F5B700", type: "overlay" },
  { key: "ema9", label: "EMA 9", color: "#2ED9A0", type: "overlay" },
  { key: "bb", label: "Bollinger", color: "#7C5CFF", type: "overlay" },
  { key: "rsi", label: "RSI", color: "#7C5CFF", type: "pane" },
  { key: "macd", label: "MACD", color: "#F5B700", type: "pane" },
];

function WhalePulseLayer({ events }) {
  // Positions are illustrative (spread across the visible chart width) —
  // Phase 3 refines this to place each marker at its actual candle x-position.
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {events.map((e, i) => (
        <div
          key={e.id}
          style={{
            position: "absolute",
            left: `${20 + ((i * 17) % 60)}%`,
            top: "55%",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#7C5CFF",
            animation: "whalePulse 2.2s ease-out",
          }}
          title={`${e.event_type || "whale event"} — $${e.amount_usd || "?"}`}
        />
      ))}
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
  const [active, setActive] = useState({ ma20: true, ema9: false, bb: false, rsi: true, macd: false });
  const [drawing, setDrawing] = useState(false);
  const [drawLine, setDrawLine] = useState(null);
  const [pendingPoint, setPendingPoint] = useState(null);

  // Load the real symbol list from the backend on mount.
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

  const closes = candles.map((c) => c.c);
  const indicators = useMemo(
    () => ({
      smaVals: sma(closes, 20),
      emaVals: ema(closes, 9),
      bbVals: bollinger(closes, 20, 2),
      rsiVals: rsi(closes, 14),
      macdVals: macd(closes),
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

  const filtered = symbols.filter((s) => s.display.toLowerCase().includes(query.toLowerCase()));
  const toggleIndicator = (key) => setActive((a) => ({ ...a, [key]: !a[key] }));

  const handleChartClick = (x, y) => {
    if (!pendingPoint) {
      setPendingPoint({ x, y });
      setDrawLine({ x1: x, y1: y, x2: x, y2: y });
    } else {
      setDrawLine({ x1: pendingPoint.x, y1: pendingPoint.y, x2: x, y2: y });
      setPendingPoint(null);
      setDrawing(false);
    }
  };

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

        <button onClick={() => { setDrawing((d) => !d); setPendingPoint(null); if (drawing) setDrawLine(null); }} style={{ background: drawing ? "#F5B70022" : "transparent", color: drawing ? "#F5B700" : "#8B93A3", border: "1px solid " + (drawing ? "#F5B70055" : "#232A38"), borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
          {drawing ? (pendingPoint ? "click end point" : "click start point") : "✎ trendline"}
        </button>
        {drawLine && !drawing && (
          <button onClick={() => setDrawLine(null)} style={{ background: "none", border: "none", color: "#4A5063", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>clear</button>
        )}

        <div style={{ marginLeft: "auto" }}>
          <PriceTicker candles={candles} connected={connected} />
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside style={{ width: 190, borderRight: "1px solid #1D232F", padding: "14px 12px", overflow: "auto" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#4A5063", marginBottom: 10, letterSpacing: 1 }}>WATCHLIST</div>
          {symbols.map((s) => (
            <div key={s.pair} onClick={() => setActiveSymbol(s.pair)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 6px", borderRadius: 6, marginBottom: 2, cursor: "pointer", background: s.pair === activeSymbol ? "#191F2A" : "transparent" }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#E8EAED" }}>{s.display}</span>
            </div>
          ))}
        </aside>

        <main style={{ flex: 1, position: "relative", padding: 16, overflow: "auto" }}>
          <WhalePulseLayer events={whaleEvents} />
          {loading ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>loading candles...</div>
          ) : candles.length === 0 ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>
              No historical candles yet for {activeDisplay} — the relay writes candles as they close, so a brand-new symbol needs a little time to build up data.
            </div>
          ) : (
            <>
              <CandleChart candles={candles} overlays={overlays} height={active.rsi || active.macd ? 300 : 420} up="#2ED9A0" down="#FF5C77" drawLine={drawLine} drawing={drawing} onChartClick={handleChartClick} />
              {active.rsi && <RSIPane values={indicators.rsiVals} height={70} />}
              {active.macd && <MACDPane data={indicators.macdVals} height={70} />}
            </>
          )}
        </main>
      </div>

      <footer style={{ borderTop: "1px solid #1D232F", padding: "8px 20px", fontFamily: "'Manrope', sans-serif", fontSize: 11, color: "#4A5063", textAlign: "center" }}>
        ad space — kept small, kept out of your way
      </footer>
    </div>
  );
}
