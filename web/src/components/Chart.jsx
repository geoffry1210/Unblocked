import { useRef } from "react";

function normLine(values, min, max, len) {
  const range = max - min || 1;
  const w = 100 / len;
  const pts = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = i * w + w / 2;
    const y = ((max - v) / range) * 72;
    pts.push(`${x},${y}`);
  });
  return pts.join(" ");
}

export function CandleChart({ candles, overlays, height, up, down, drawLine, onChartClick, drawing }) {
  const svgRef = useRef(null);
  if (candles.length === 0) return null;

  let max = Math.max(...candles.map((c) => c.h));
  let min = Math.min(...candles.map((c) => c.l));
  overlays.forEach((o) => {
    o.values.forEach((v) => {
      if (v != null) {
        if (v > max) max = v;
        if (v < min) min = v;
      }
    });
  });
  const range = max - min || 1;
  const maxV = Math.max(...candles.map((c) => c.v));
  const w = 100 / candles.length;

  const handleClick = (e) => {
    if (!drawing) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onChartClick(x, y);
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      onClick={handleClick}
      style={{ width: "100%", height, cursor: drawing ? "crosshair" : "default" }}
    >
      {candles.map((c, i) => {
        const x = i * w + w * 0.2;
        const cw = w * 0.6;
        const yHigh = ((max - c.h) / range) * 72;
        const yLow = ((max - c.l) / range) * 72;
        const yOpen = ((max - c.o) / range) * 72;
        const yClose = ((max - c.c) / range) * 72;
        const bullish = c.c >= c.o;
        const color = bullish ? up : down;
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(Math.abs(yClose - yOpen), 0.4);
        const volH = (c.v / maxV) * 20;
        return (
          <g key={i}>
            <line x1={x + cw / 2} x2={x + cw / 2} y1={yHigh} y2={yLow} stroke={color} strokeWidth={0.25} />
            <rect x={x} y={bodyTop} width={cw} height={bodyH} fill={color} opacity={0.95} />
            <rect x={x} y={80 - volH} width={cw} height={volH} fill={color} opacity={0.3} />
          </g>
        );
      })}
      {overlays.map((o, idx) => (
        <polyline
          key={idx}
          points={normLine(o.values, min, max, candles.length)}
          fill="none"
          stroke={o.color}
          strokeWidth={o.width || 0.35}
          strokeDasharray={o.dash || "none"}
          opacity={0.9}
        />
      ))}
      {drawLine && (
        <line x1={drawLine.x1} y1={drawLine.y1} x2={drawLine.x2} y2={drawLine.y2} stroke="#F5B700" strokeWidth={0.4} />
      )}
    </svg>
  );
}

export function RSIPane({ values, height }) {
  if (values.length === 0) return null;
  const pts = normLine(values, 0, 100, values.length).split(" ");
  const scaled = pts.map((p) => {
    const [x, y] = p.split(",").map(Number);
    return `${x},${(y / 72) * 100}`;
  }).join(" ");
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#4A5063", padding: "0 4px" }}>RSI (14)</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }}>
        <line x1="0" y1="30" x2="100" y2="30" stroke="#2A3140" strokeWidth="0.3" strokeDasharray="1,1" />
        <line x1="0" y1="70" x2="100" y2="70" stroke="#2A3140" strokeWidth="0.3" strokeDasharray="1,1" />
        <polyline points={scaled} fill="none" stroke="#7C5CFF" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

export function MACDPane({ data, height }) {
  if (data.macdLine.length === 0) return null;
  const all = [...data.macdLine, ...data.signalLine, ...data.histogram].filter((v) => v != null);
  const max = Math.max(...all, 0.001);
  const min = Math.min(...all, -0.001);
  const range = max - min || 1;
  const w = 100 / data.macdLine.length;
  const scale = (line) =>
    normLine(line, min, max, line.length).split(" ").filter(Boolean).map((p) => {
      const [x, y] = p.split(",").map(Number);
      return `${x},${(y / 72) * 100}`;
    }).join(" ");
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#4A5063", padding: "0 4px" }}>MACD (12,26,9)</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }}>
        {data.histogram.map((v, i) => {
          if (v == null) return null;
          const zeroY = ((max - 0) / range) * 100;
          const y = ((max - v) / range) * 100;
          const h = Math.abs(y - zeroY);
          return (
            <rect key={i} x={i * w + w * 0.25} y={Math.min(y, zeroY)} width={w * 0.5} height={Math.max(h, 0.3)} fill={v >= 0 ? "#2ED9A0" : "#FF5C77"} opacity={0.6} />
          );
        })}
        <polyline points={scale(data.macdLine)} fill="none" stroke="#F5B700" strokeWidth="0.6" />
        <polyline points={scale(data.signalLine)} fill="none" stroke="#7C5CFF" strokeWidth="0.6" />
      </svg>
    </div>
  );
}
