// Indicator math — SMA, EMA, Bollinger Bands, RSI, MACD.
// Note: RSI/MACD here use simplified smoothing (not full Wilder smoothing),
// carried over from the UI concept phase. Fine for display; revisit if you
// ever need values that match TradingView's exactly to the decimal.

export function sma(closes, period) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out[i] = sum / period;
  }
  return out;
}

export function ema(closes, period) {
  const out = new Array(closes.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < closes.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = closes[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - mid[i], 2);
    const std = Math.sqrt(sumSq / period);
    upper[i] = mid[i] + mult * std;
    lower[i] = mid[i] - mult * std;
  }
  return { upper, lower, mid };
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    let g = 0, l = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) g += diff; else l -= diff;
    }
    const avgG = g / period, avgL = l / period;
    const rs = avgL === 0 ? 100 : avgG / avgL;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function macd(closes) {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const validIdx = macdLine.map((v, i) => (v != null ? i : null)).filter((v) => v != null);
  const signalLine = new Array(closes.length).fill(null);
  if (validIdx.length >= 9) {
    const k = 2 / 10;
    let prev = null;
    validIdx.forEach((idx, n) => {
      if (n === 8) {
        let sum = 0;
        for (let m = 0; m < 9; m++) sum += macdLine[validIdx[m]];
        prev = sum / 9;
        signalLine[idx] = prev;
      } else if (n > 8) {
        prev = macdLine[idx] * k + prev * (1 - k);
        signalLine[idx] = prev;
      }
    });
  }
  const histogram = closes.map((_, i) => (macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null));
  return { macdLine, signalLine, histogram };
}

// VWAP — volume-weighted average price, cumulative from the start of the
// loaded candle window. Resets whenever the candle window changes (symbol
// or timeframe switch), same as most charting tools default to session
// VWAP; a rolling/session-boundary version is a nice-to-have beyond v1.
export function vwap(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].h + candles[i].l + candles[i].c) / 3;
    cumPV += typicalPrice * candles[i].v;
    cumV += candles[i].v;
    out[i] = cumV === 0 ? null : cumPV / cumV;
  }
  return out;
}

// Stochastic RSI — the stochastic formula applied to RSI's own output
// (not price), so it needs an RSI series as input, not raw candles. This
// is a different indicator from a plain Stochastic Oscillator (which uses
// high/low price), and reacts faster / ranges more often at the extremes.
export function stochRsi(closes, rsiPeriod = 14, stochPeriod = 14, dPeriod = 3) {
  const rsiVals = rsi(closes, rsiPeriod);
  const n = closes.length;
  const k = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (rsiVals[i] == null) continue;
    // Need `stochPeriod` consecutive non-null RSI values ending at i.
    const start = i - stochPeriod + 1;
    if (start < 0 || rsiVals[start] == null) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      if (rsiVals[j] > hi) hi = rsiVals[j];
      if (rsiVals[j] < lo) lo = rsiVals[j];
    }
    const range = hi - lo;
    k[i] = range === 0 ? 0 : ((rsiVals[i] - lo) / range) * 100;
  }
  const d = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const start = i - dPeriod + 1;
    if (start < 0 || k[start] == null) continue;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += k[j];
    d[i] = sum / dPeriod;
  }
  return { k, d };
}
