import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import { sma, ema, bollinger, rsi, macd, vwap, stochRsi } from "../lib/indicators.js";
import { TradingChart } from "./Chart.jsx";
import { AdSlot } from "./AdSlot.jsx";

// Each indicator now carries its own config (period, color, etc.), not just
// an on/off flag — this is what makes the settings popover possible.
const INDICATOR_DEFS = {
  ma20: { label: "MA", type: "overlay", defaults: { enabled: true, period: 20, color: "#F5B700" } },
  ema9: { label: "EMA", type: "overlay", defaults: { enabled: false, period: 9, color: "#2ED9A0" } },
  bb: { label: "Bollinger", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" } },
  vwap: { label: "VWAP", type: "overlay", defaults: { enabled: false, color: "#FF9F40" } },
  rsi: { label: "RSI", type: "pane", defaults: { enabled: true, period: 14, color: "#7C5CFF" } },
  macd: { label: "MACD", type: "pane", defaults: { enabled: false, fast: 12, slow: 26, signal: 9, color: "#F5B700" } },
  stochrsi: { label: "Stoch RSI", type: "pane", defaults: { enabled: false, period: 14, smoothD: 3, color: "#2ED9A0" } },
};

const COLOR_PRESETS = ["#F5B700", "#2ED9A0", "#7C5CFF", "#FF5C77", "#FF9F40", "#4FA9FF"];

const DRAW_TOOLS = [
  { key: "trendline", label: "✎ line", clicksNeeded: 2 },
  { key: "horizontal", label: "— ray", clicksNeeded: 1 },
  { key: "fib", label: "◇ fib", clicksNeeded: 2 },
  { key: "rectangle", label: "▭ zone", clicksNeeded: 2 },
  { key: "text", label: "T note", clicksNeeded: 1 },
];

function drawingsStorageKey(symbol, tf) {
  return `unblocked.drawings.v2.${symbol}.${tf}`;
}
function indicatorConfigStorageKey() {
  return "unblocked.indicators.v1";
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : fallback;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function defaultIndicatorConfig() {
  const cfg = {};
  Object.entries(INDICATOR_DEFS).forEach(([key, def]) => {
    cfg[key] = { ...def.defaults };
  });
  return cfg;
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
    <div ref={boxRef} style={{ position: "relative", width: 200 }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={activeDisplay || "search pair..."}
        style={{ width: "100%", background: "#131720", border: "1px solid #2A3140", borderRadius: 6, padding: "7px 10px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, outline: "none" }}
      />
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, zIndex: 30, width: 220, maxHeight: 260, overflow: "auto" }}>
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

// Small popover for adjusting a single indicator's period(s) and color.
// Renders as a floating card anchored under the indicator's chip.
function IndicatorSettings({ indKey, def, cfg, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const numberField = (label, field, min = 1, max = 200) => (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace" }}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={cfg[field]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange({ ...cfg, [field]: v });
        }}
        style={{ width: 56, background: "#0B0E14", border: "1px solid #2A3140", borderRadius: 4, color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "3px 6px" }}
      />
    </label>
  );

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: "110%", left: 0, zIndex: 30, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, padding: 12, width: 190, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace" }}>{def.label} settings</div>

      {"period" in cfg && numberField("Period", "period", 2, 200)}
      {"mult" in cfg && numberField("Std Dev ×", "mult", 1, 5)}
      {"fast" in cfg && numberField("Fast", "fast", 2, 100)}
      {"slow" in cfg && numberField("Slow", "slow", 2, 200)}
      {"signal" in cfg && numberField("Signal", "signal", 2, 50)}
      {"smoothD" in cfg && numberField("Smooth D", "smoothD", 1, 20)}

      <div>
        <div style={{ fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Color</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ ...cfg, color: c })}
              style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: cfg.color === c ? "2px solid #E8EAED" : "2px solid transparent", cursor: "pointer" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorChip({ indKey, def, cfg, onToggle, onChange }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = "period" in cfg || "fast" in cfg;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: cfg.enabled ? `${cfg.color}22` : "transparent",
          border: "1px solid " + (cfg.enabled ? cfg.color + "55" : "#232A38"),
          borderRadius: 6,
          padding: "3px 4px 3px 10px",
        }}
      >
        <button
          onClick={() => onToggle(indKey)}
          style={{ background: "none", border: "none", color: cfg.enabled ? cfg.color : "#8B93A3", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", padding: "2px 0" }}
        >
          {def.label}{"period" in cfg ? ` ${cfg.period}` : ""}
        </button>
        {hasSettings && (
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            title="Settings"
            style={{ background: "none", border: "none", color: cfg.enabled ? cfg.color : "#4A5063", cursor: "pointer", fontSize: 11, padding: "2px 6px" }}
          >
            ⚙
          </button>
        )}
      </div>
      {settingsOpen && (
        <IndicatorSettings indKey={indKey} def={def} cfg={cfg} onChange={(next) => onChange(indKey, next)} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

export function AppShell({ onBack }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [activeSymbol, setActiveSymbol] = useState(null);
  const [tf, setTf] = useState("15m");
  const [indicatorConfig, setIndicatorConfig] = useState(() => {
    const saved = loadJSON(indicatorConfigStorageKey(), null);
    const defaults = defaultIndicatorConfig();
    if (!saved) return defaults;
    // Merge saved values over defaults so newly-added indicators/fields
    // (from future updates) don't end up undefined for existing users.
    const merged = {};
    Object.keys(defaults).forEach((k) => { merged[k] = { ...defaults[k], ...(saved[k] || {}) }; });
    return merged;
  });

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
    setDrawings(loadJSON(drawingsStorageKey(activeSymbol, tf), []));
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

  useEffect(() => {
    try {
      localStorage.setItem(indicatorConfigStorageKey(), JSON.stringify(indicatorConfig));
    } catch {
      // same as above
    }
  }, [indicatorConfig]);

  const closes = candles.map((c) => c.c);
  const cfg = indicatorConfig;
  const indicators = useMemo(
    () => ({
      smaVals: sma(closes, cfg.ma20.period),
      emaVals: ema(closes, cfg.ema9.period),
      bbVals: bollinger(closes, cfg.bb.period, cfg.bb.mult),
      vwapVals: vwap(candles),
      rsiVals: rsi(closes, cfg.rsi.period),
      macdVals: macd(closes, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal),
      stochRsiVals: stochRsi(closes, cfg.stochrsi.period, cfg.stochrsi.period, cfg.stochrsi.smoothD),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candles, cfg.ma20.period, cfg.ema9.period, cfg.bb.period, cfg.bb.mult, cfg.rsi.period, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal, cfg.stochrsi.period, cfg.stochrsi.smoothD]
  );

  const overlays = [];
  if (cfg.ma20.enabled) overlays.push({ values: indicators.smaVals, color: cfg.ma20.color });
  if (cfg.ema9.enabled) overlays.push({ values: indicators.emaVals, color: cfg.ema9.color });
  if (cfg.bb.enabled) {
    overlays.push({ values: indicators.bbVals.upper, color: cfg.bb.color, dash: true });
    overlays.push({ values: indicators.bbVals.lower, color: cfg.bb.color, dash: true });
  }
  if (cfg.vwap.enabled) overlays.push({ values: indicators.vwapVals, color: cfg.vwap.color });

  const indicatorPanes = [];
  if (cfg.rsi.enabled) {
    indicatorPanes.push({
      key: "rsi",
      lines: [{ values: indicators.rsiVals, color: cfg.rsi.color }],
      bounds: [0, 100],
      refLines: [{ value: 30, color: "#2A3140" }, { value: 70, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }
  if (cfg.macd.enabled) {
    indicatorPanes.push({
      key: "macd",
      lines: [
        { values: indicators.macdVals.macdLine, color: cfg.macd.color },
        { values: indicators.macdVals.signalLine, color: "#7C5CFF" },
      ],
      histogram: { values: indicators.macdVals.histogram, upColor: "#2ED9A055", downColor: "#FF5C7755" },
      stretchFactor: 1.4,
    });
  }
  if (cfg.stochrsi.enabled) {
    indicatorPanes.push({
      key: "stochrsi",
      lines: [
        { values: indicators.stochRsiVals.k, color: cfg.stochrsi.color },
        { values: indicators.stochRsiVals.d, color: "#F5B700" },
      ],
      bounds: [0, 100],
      refLines: [{ value: 20, color: "#2A3140" }, { value: 80, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }

  const toggleIndicator = (key) => setIndicatorConfig((c) => ({ ...c, [key]: { ...c[key], enabled: !c[key].enabled } }));
  const updateIndicator = (key, next) => setIndicatorConfig((c) => ({ ...c, [key]: next }));

  const selectDrawTool = (key) => {
    setPendingPoint(null);
    setDrawTool((cur) => (cur === key ? null : key));
  };

  const handleChartClick = (time, price) => {
    if (!drawTool) return;
    const toolDef = DRAW_TOOLS.find((t) => t.key === drawTool);
    const point = { time, price };

    if (drawTool === "text") {
      const text = window.prompt("Note text:");
      if (text) {
        setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: "text", points: [point], text, color: "#E8EAED" }]);
      }
      setDrawTool(null);
      return;
    }

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
      <header style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px", borderBottom: "1px solid #1D232F" }}>
        {/* Row 1 — identity + price, always visible without wrapping */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#8B93A3", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>← back</button>
          <SymbolSearch symbols={symbols} activeDisplay={activeDisplay} onSelect={setActiveSymbol} />
          <div style={{ marginLeft: "auto" }}>
            <PriceTicker candles={candles} connected={connected} />
          </div>
        </div>

        {/* Row 2 — timeframe + indicators, wraps freely on narrow screens */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["1m", "15m", "1h", "4h", "1d"].map((t) => (
              <button key={t} onClick={() => setTf(t)} style={{ background: tf === t ? "#191F2A" : "transparent", color: tf === t ? "#F5B700" : "#8B93A3", border: "1px solid " + (tf === t ? "#2A3140" : "transparent"), borderRadius: 6, padding: "5px 9px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 18, background: "#1D232F" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(INDICATOR_DEFS).map(([key, def]) => (
              <IndicatorChip key={key} indKey={key} def={def} cfg={indicatorConfig[key]} onToggle={toggleIndicator} onChange={updateIndicator} />
            ))}
          </div>
        </div>

        {/* Row 3 — drawing tools */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {DRAW_TOOLS.map((t) => (
            <button
              key={t.key}
              onClick={() => selectDrawTool(t.key)}
              style={{ background: drawTool === t.key ? "#F5B70022" : "transparent", color: drawTool === t.key ? "#F5B700" : "#8B93A3", border: "1px solid " + (drawTool === t.key ? "#F5B70055" : "#232A38"), borderRadius: 6, padding: "4px 9px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}
            >
              {drawTool === t.key ? (pendingPoint ? "click 2nd pt" : t.clicksNeeded === 1 ? "click point" : "click 1st pt") : t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Chart region intentionally consumes the large majority of the page. */}
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
              {d.type}{d.type === "text" ? `: ${d.text?.slice(0, 16)}` : ""}
              <span onClick={() => removeDrawing(d.id)} style={{ cursor: "pointer", color: "#FF5C77", fontWeight: 700 }}>×</span>
            </div>
          ))}
        </div>
      )}

      <AdSlot />
    </div>
  );
}
