import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import { sma, ema, bollinger, rsi, macd, vwap, stochRsi } from "../lib/indicators.js";
import { TradingChart } from "./Chart.jsx";
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
  return `unblocked.drawings.v2.${symbol}.${tf}`;
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
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {events.map((e) => {
        const x = xForTime(e.time);
        if (x == null) return null;
        const valLabel = e.value >= 1e6 ? `${(e.value / 1e6).toFixed(2)}M` : e.value >= 1e3 ? `${(e.value / 1e3).toFixed(2)}K` : e.value?.toFixed(2);
        return (
          <div
            key={e.id}
            style={{ position: "absolute", left: `${x}%`, top: "30%", width: 10, height: 10, borderRadius: "50%", background: "#7C5CFF", animation: "whalePulse 2.2s ease-out" }}
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

// Search bar with autocomplete — the sole way to pick a symbol now that the
// watchlist sidebar is gone. Keyboard nav (up/down/enter) included since a
// dropdown you can only tap is annoying on desktop.
function SymbolSearch({ symbols, activeDisplay, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query) return symbols.slice(0, 8);
    const q = query.toLowerCase();
    return symbols.filter((s) => s.display.toLowerCase().includes(q)).slice(0, 8);
  }, [symbols, query]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (s) => {
    onSelect(s.pair);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: 220 }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={activeDisplay || "search pair..."}
        style={{ width: "100%", background: "#131720", border: "1px solid #2A3140", borderRadius: 6, padding: "7px 10px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, outline: "none" }}
      />
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, zIndex: 20, width: 220, maxHeight: 260, overflow: "auto" }}>
          {filtered.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#4A5063", fontFamily: "'Manrope', sans-serif" }}>No matches</div>}
          {filtered.map((s, i) => (
            <div
              key={s.pair}
              onMouseDown={() => pick(s)}
              onMouseEnter={() => setHighlight(i)}
              style={{ padding: "8px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#E8EAED", cursor: "pointer", background: i === highlight ? "#232A38" : "transparent" }}
            >
              {s.display}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ onBack }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [activeSymbol, setActiveSymbol] = useState(null);
  const [tf, setTf] = useState("15m");
  const [active, setActive] = useState({ ma20: true, ema9: false, bb: false, vwap: false, rsi: true, macd: false, stochrsi: false });

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
      // Storage can fail (quota, private browsing) — not worth surfacing.
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
    overlays.push({ values: indicators.bbVals.upper, color: "#7C5CFF", dash: true });
    overlays.push({ values: indicators.bbVals.lower, color: "#7C5CFF", dash: true });
  }
  if (active.vwap) overlays.push({ values: indicators.vwapVals, color: "#FF9F40" });

  const indicatorPanes = [];
  if (active.rsi) {
    indicatorPanes.push({ key: "rsi", lines: [{ values: indicators.rsiVals, color: "#7C5CFF" }], stretchFactor: 1.4 });
  }
  if (active.macd) {
    indicatorPanes.push({
      key: "macd",
      lines: [
        { values: indicators.macdVals.macdLine, color: "#F5B700" },
        { values: indicators.macdVals.signalLine, color: "#7C5CFF" },
      ],
      histogram: { values: indicators.macdVals.histogram, upColor: "#2ED9A055", downColor: "#FF5C7755" },
      stretchFactor: 1.4,
    });
  }
  if (active.stochrsi) {
    indicatorPanes.push({
      key: "stochrsi",
      lines: [
        { values: indicators.stochRsiVals.k, color: "#2ED9A0" },
        { values: indicators.stochRsiVals.d, color: "#F5B700" },
      ],
      stretchFactor: 1.4,
    });
  }

  const toggleIndicator = (key) => setActive((a) => ({ ...a, [key]: !a[key] }));

  const selectDrawTool = (key) => {
    setPendingPoint(null);
    setDrawTool((cur) => (cur === key ? null : key));
  };

  // time is unix seconds (from the chart), price is the real chart price —
  // both come straight from TradingChart's click handler now.
  const handleChartClick = (time, price) => {
    if (!drawTool) return;
    const toolDef = DRAW_TOOLS.find((t) => t.key === drawTool);
    const point = { time, price };
    if (toolDef.clicksNeeded === 1) {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: [point] }]);
      setDrawTool(null);
      return;
    }
    if (!pendingPoint) {
      setPendingPoint(point);
    } else {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: [pendingPoint, point] }]);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #1D232F", flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#8B93A3", cursor: "pointer", fontSize: 13 }}>← back</button>

        <SymbolSearch symbols={symbols} activeDisplay={activeDisplay} onSelect={setActiveSymbol} />

        <div style={{ display: "flex", gap: 6 }}>
          {["1m", "15m", "1h", "4h", "1d"].map((t) => (
            <button key={t} onClick={() => setTf(t)} style={{ background: tf === t ? "#191F2A" : "transparent", color: tf === t ? "#F5B700" : "#8B93A3", border: "1px solid " + (tf === t ? "#2A3140" : "transparent"), borderRadius: 6, padding: "5px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

      {/* Chart region intentionally consumes the large majority of the page —
          no sidebar competing for width, symbol switching lives entirely in
          the search box above. */}
      <main style={{ flex: "1 1 80%", position: "relative", padding: "12px 16px 4px", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <WhalePulseLayer events={whaleEvents} candles={candles} />
        {loading ? (
          <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>loading candles...</div>
        ) : candles.length === 0 ? (
          <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>
            No historical candles yet for {activeDisplay} — the relay writes candles as they close, so a brand-new symbol needs a little time to build up data.
          </div>
        ) : (
          <TradingChart
            candles={candles}
            overlays={overlays}
            indicatorPanes={indicatorPanes}
            height="100%"
            up="#2ED9A0"
            down="#FF5C77"
            drawings={drawings}
            pendingPoint={pendingPoint}
            drawTool={drawTool}
            onChartClick={handleChartClick}
          />
        )}
      </main>

      {drawings.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 16px 8px" }}>
          {drawings.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 6, padding: "3px 8px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8B93A3" }}>
              {d.type}
              <span onClick={() => removeDrawing(d.id)} style={{ cursor: "pointer", color: "#FF5C77", fontWeight: 700 }}>×</span>
            </div>
          ))}
        </div>
      )}

      <AdSlot />
    </div>
  );
}
