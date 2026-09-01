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
