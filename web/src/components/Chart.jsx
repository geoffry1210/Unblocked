import { useEffect, useLayoutEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from "lightweight-charts";

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const fmt = (p) => (p < 10 ? p.toFixed(4) : p.toFixed(2));
const toSeconds = (ms) => Math.floor(ms / 1000);

// lightweight-charts requires strictly-ascending, deduplicated time series.
// These helpers convert our {t (ms), o,h,l,c,v} candles into that shape,
// dropping any point whose timestamp doesn't advance past the last one kept.
function toCandleData(candles) {
  const out = [];
  let last = -Infinity;
  for (const c of candles) {
    const time = toSeconds(c.t);
    if (time <= last) continue;
    last = time;
    out.push({ time, open: c.o, high: c.h, low: c.l, close: c.c });
  }
  return out;
}

function toVolumeData(candles, up, down) {
  const out = [];
  let last = -Infinity;
  for (const c of candles) {
    const time = toSeconds(c.t);
    if (time <= last) continue;
    last = time;
    out.push({ time, value: c.v, color: c.c >= c.o ? up : down });
  }
  return out;
}

function toLineData(candles, values) {
  const out = [];
  let last = -Infinity;
  candles.forEach((c, i) => {
    const v = values[i];
    if (v == null) return;
    const time = toSeconds(c.t);
    if (time <= last) return;
    last = time;
    out.push({ time, value: v });
  });
  return out;
}

function toHistData(candles, values, upColor, downColor) {
  const out = [];
  let last = -Infinity;
  candles.forEach((c, i) => {
    const v = values[i];
    if (v == null) return;
    const time = toSeconds(c.t);
    if (time <= last) return;
    last = time;
    out.push({ time, value: v, color: v >= 0 ? upColor : downColor });
  });
  return out;
}

/**
 * Unified trading chart — candles + volume on the main pane, any number of
 * overlay lines (MA/EMA/BB/VWAP) drawn on the same price scale, and any
 * number of indicator panes (RSI/MACD/StochRSI/...) stacked below, all
 * sharing one time axis with native zoom/pan/drag-to-scale.
 *
 * indicatorPanes: [{
 *   key, label, stretchFactor?,
 *   lines: [{ values, color, dash? }],
 *   histogram?: { values, upColor, downColor },
 *   refLines?: [{ value, color }],   // e.g. RSI's 30/70 guides
 * }]
 *
 * Drawings use {time (unix seconds), price} points instead of screen
 * percentages, so they stay pinned to the right spot through pan/zoom —
 * pass onChartClick(time, price) and it'll be called whenever drawTool is
 * armed and the user taps the chart.
 */
export function TradingChart({
  candles,
  overlays = [],
  indicatorPanes = [],
  height = 480,
  up = "#2ED9A0",
  down = "#FF5C77",
  drawings = [],
  pendingPoint,
  drawTool,
  onChartClick,
}) {
  const containerRef = useRef(null);
  const overlaySvgRef = useRef(null);
  const chartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const overlaySeriesRef = useRef([]);
  const paneSeriesRef = useRef({});
  const redrawDrawingsRef = useRef(() => {});
  const drawToolRef = useRef(drawTool);
  const onChartClickRef = useRef(onChartClick);

  useEffect(() => {
    drawToolRef.current = drawTool;
    onChartClickRef.current = onChartClick;
  }, [drawTool, onChartClick]);

  // ---- create chart once ----
  useLayoutEffect(() => {
    const container = containerRef.current;
    const chart = createChart(container, {
      layout: { background: { color: "#0B0E14" }, textColor: "#8B93A3" },
      grid: { vertLines: { color: "#161B26" }, horzLines: { color: "#161B26" } },
      rightPriceScale: { borderColor: "#1D232F" },
      timeScale: { borderColor: "#1D232F", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down },
      0
    );
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });
    mainSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" }, 0);
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeClick((param) => {
      if (!drawToolRef.current || !param.point || param.time == null) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price == null) return;
      onChartClickRef.current?.(param.time, price);
    });

    const redraw = () => redrawDrawingsRef.current();
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    chart.subscribeCrosshairMove(redraw);

    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- candles + volume ----
  useEffect(() => {
    if (!mainSeriesRef.current) return;
    mainSeriesRef.current.setData(toCandleData(candles));
    volumeSeriesRef.current.setData(toVolumeData(candles, up, down));
    redrawDrawingsRef.current();
  }, [candles, up, down]);

  // ---- overlay lines on the main pane (MA/EMA/BB/VWAP) ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    overlaySeriesRef.current.forEach((s) => chart.removeSeries(s));
    overlaySeriesRef.current = overlays.map((o) => {
      const s = chart.addSeries(
        LineSeries,
        { color: o.color, lineWidth: 1, lineStyle: o.dash ? 2 : 0, lastValueVisible: false, priceLineVisible: false },
        0
      );
      s.setData(toLineData(candles, o.values));
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, candles]);

  // ---- indicator panes (RSI/MACD/StochRSI/...) ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    Object.values(paneSeriesRef.current).forEach((entry) => entry.forEach((s) => chart.removeSeries(s)));
    paneSeriesRef.current = {};

    indicatorPanes.forEach((pane, idx) => {
      const paneIndex = idx + 1;
      const series = [];
      (pane.lines || []).forEach((line) => {
        const s = chart.addSeries(
          LineSeries,
          { color: line.color, lineWidth: 1, lineStyle: line.dash ? 2 : 0, lastValueVisible: false, priceLineVisible: false },
          paneIndex
        );
        s.setData(toLineData(candles, line.values));
        series.push(s);
      });
      if (pane.histogram) {
        const s = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, paneIndex);
        s.setData(toHistData(candles, pane.histogram.values, pane.histogram.upColor, pane.histogram.downColor));
        series.push(s);
      }
      paneSeriesRef.current[pane.key] = series;

      const p = chart.panes()[paneIndex];
      if (p) p.setStretchFactor(pane.stretchFactor ?? 1.5);
    });

    const mainPane = chart.panes()[0];
    if (mainPane) mainPane.setStretchFactor(indicatorPanes.length > 0 ? 5 : 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorPanes, candles]);

  // ---- drawings (trendline / horizontal ray / fib) as an SVG layer synced to chart coords ----
  useEffect(() => {
    const draw = () => {
      const chart = chartRef.current;
      const series = mainSeriesRef.current;
      const svg = overlaySvgRef.current;
      const container = containerRef.current;
      if (!chart || !series || !svg || !container) return;
      const rect = container.getBoundingClientRect();
      svg.setAttribute("width", rect.width);
      svg.setAttribute("height", rect.height);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const ns = "http://www.w3.org/2000/svg";
      const ts = chart.timeScale();
      const toXY = (p) => {
        const x = ts.timeToCoordinate(p.time);
        const y = series.priceToCoordinate(p.price);
        return x == null || y == null ? null : { x, y };
      };
      const addLine = (x1, y1, x2, y2, color, dash) => {
        const el = document.createElementNS(ns, "line");
        el.setAttribute("x1", x1);
        el.setAttribute("y1", y1);
        el.setAttribute("x2", x2);
        el.setAttribute("y2", y2);
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1");
        if (dash) el.setAttribute("stroke-dasharray", dash);
        svg.appendChild(el);
      };
      const addText = (x, y, text, color) => {
        const el = document.createElementNS(ns, "text");
        el.setAttribute("x", x);
        el.setAttribute("y", y);
        el.setAttribute("fill", color);
        el.setAttribute("font-size", "11");
        el.setAttribute("font-family", "'JetBrains Mono', monospace");
        el.textContent = text;
        svg.appendChild(el);
      };

      drawings.forEach((d) => {
        if (d.type === "trendline") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) addLine(p1.x, p1.y, p2.x, p2.y, "#F5B700");
        } else if (d.type === "horizontal") {
          const p1 = toXY(d.points[0]);
          if (p1) {
            addLine(0, p1.y, rect.width, p1.y, "#2ED9A0", "4,3");
            addText(4, p1.y - 4, fmt(d.points[0].price), "#2ED9A0");
          }
        } else if (d.type === "fib") {
          const priceA = d.points[0].price;
          const priceB = d.points[1].price;
          const high = Math.max(priceA, priceB);
          const low = Math.min(priceA, priceB);
          FIB_LEVELS.forEach((lv) => {
            const price = high - lv * (high - low);
            const y = series.priceToCoordinate(price);
            if (y == null) return;
            addLine(0, y, rect.width, y, "#7C5CFF", "2,2");
            addText(4, y - 4, `${(lv * 100).toFixed(1)}% ${fmt(price)}`, "#7C5CFF");
          });
        }
      });

      if (pendingPoint) {
        const p = toXY(pendingPoint);
        if (p) {
          const el = document.createElementNS(ns, "circle");
          el.setAttribute("cx", p.x);
          el.setAttribute("cy", p.y);
          el.setAttribute("r", "4");
          el.setAttribute("fill", "#F5B700");
          svg.appendChild(el);
        }
      }
    };
    redrawDrawingsRef.current = draw;
    draw();
  }, [drawings, pendingPoint]);

  return (
    <div style={{ position: "relative", width: "100%", height, cursor: drawTool ? "crosshair" : "default" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <svg ref={overlaySvgRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
    </div>
  );
}
