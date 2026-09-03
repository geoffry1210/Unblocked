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

// Now takes fast/slow/signal periods instead of hardcoding 12/26/9 — needed
// so the settings popover's period fields actually do something. Defaults
// preserve the original behavior exactly for anyone not customizing it.
export function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const eFast = ema(closes, fastPeriod);
  const eSlow = ema(closes, slowPeriod);
  const macdLine = closes.map((_, i) => (eFast[i] != null && eSlow[i] != null ? eFast[i] - eSlow[i] : null));
  const validIdx = macdLine.map((v, i) => (v != null ? i : null)).filter((v) => v != null);
  const signalLine = new Array(closes.length).fill(null);
  if (validIdx.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let prev = null;
    validIdx.forEach((idx, n) => {
      if (n === signalPeriod - 1) {
        let sum = 0;
        for (let m = 0; m < signalPeriod; m++) sum += macdLine[validIdx[m]];
        prev = sum / signalPeriod;
        signalLine[idx] = prev;
      } else if (n > signalPeriod - 1) {
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

// ============================================================================
// Batch 2 — expanding toward the full TradingView indicator list. Each of
// these takes `candles` (full OHLCV) unless noted, since most need more
// than just closing price. Formulas follow the standard/common definition
// for each indicator; noted where a well-known variant exists.
// ============================================================================

function trueRange(candles, i) {
  if (i === 0) return candles[0].h - candles[0].l;
  const prevClose = candles[i - 1].c;
  return Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prevClose), Math.abs(candles[i].l - prevClose));
}

// Wilder's smoothing — the specific running-average method Wilder defined
// for ATR/ADX/RSI, distinct from a plain EMA (k = 1/period, not 2/(period+1)).
function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  let firstIdx = values.findIndex((v) => v != null);
  if (firstIdx === -1) return out;
  for (let i = firstIdx; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      // seed with a simple average of the first `period` available values
      if (i - firstIdx + 1 < period) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + values[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

export function atr(candles, period = 14) {
  const tr = candles.map((_, i) => trueRange(candles, i));
  return wilderSmooth(tr, period);
}

// Average Directional Index, plus +DI/-DI (Directional Movement).
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].h - candles[i - 1].h;
    const downMove = candles[i - 1].l - candles[i].l;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const tr = candles.map((_, i) => trueRange(candles, i));
  const smoothTR = wilderSmooth(tr, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);

  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smoothTR[i] == null || smoothTR[i] === 0) continue;
    plusDI[i] = (smoothPlusDM[i] / smoothTR[i]) * 100;
    minusDI[i] = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
  }
  const adxLine = wilderSmooth(dx, period);
  return { adx: adxLine, plusDI, minusDI };
}

export function aroon(candles, period = 14) {
  const n = candles.length;
  const up = new Array(n).fill(null);
  const down = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let hiIdx = i, loIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (candles[j].h >= candles[hiIdx].h) hiIdx = j;
      if (candles[j].l <= candles[loIdx].l) loIdx = j;
    }
    up[i] = ((period - (i - hiIdx)) / period) * 100;
    down[i] = ((period - (i - loIdx)) / period) * 100;
  }
  return { up, down };
}

// Plain Stochastic Oscillator (price-based — distinct from Stochastic RSI above).
export function stochastic(candles, period = 14, dPeriod = 3, smoothK = 3) {
  const n = candles.length;
  const rawK = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    const range = hi - lo;
    rawK[i] = range === 0 ? 100 : ((candles[i].c - lo) / range) * 100;
  }
  const k = sma(rawK.map((v) => v ?? NaN), smoothK).map((v, i) => (rawK[i] == null ? null : Number.isNaN(v) ? null : v));
  const d = sma(k.map((v) => v ?? NaN), dPeriod).map((v, i) => (k[i] == null ? null : Number.isNaN(v) ? null : v));
  return { k, d };
}

export function cci(candles, period = 20) {
  const n = candles.length;
  const typical = candles.map((c) => (c.h + c.l + c.c) / 3);
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += typical[j];
    const mean = sum / period;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(typical[j] - mean);
    meanDev /= period;
    out[i] = meanDev === 0 ? 0 : (typical[i] - mean) / (0.015 * meanDev);
  }
  return out;
}

export function williamsR(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    const range = hi - lo;
    out[i] = range === 0 ? 0 : ((hi - candles[i].c) / range) * -100;
  }
  return out;
}

export function obv(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) out[i] = out[i - 1] + candles[i].v;
    else if (candles[i].c < candles[i - 1].c) out[i] = out[i - 1] - candles[i].v;
    else out[i] = out[i - 1];
  }
  return out;
}

export function momentum(closes, period = 10) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) out[i] = closes[i] - closes[i - period];
  return out;
}

export function roc(closes, period = 9) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i - period] === 0 ? null : ((closes[i] - closes[i - period]) / closes[i - period]) * 100;
  }
  return out;
}

// Awesome Oscillator — SMA(5) - SMA(34) of the midpoint price (h+l)/2.
export function awesomeOscillator(candles) {
  const mid = candles.map((c) => (c.h + c.l) / 2);
  const fast = sma(mid, 5);
  const slow = sma(mid, 34);
  return mid.map((_, i) => (fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null));
}

// Accelerator Oscillator — AO minus its own SMA(5).
export function acceleratorOscillator(candles) {
  const ao = awesomeOscillator(candles);
  const aoSma = sma(ao.map((v) => v ?? NaN), 5);
  return ao.map((_, i) => (ao[i] == null || Number.isNaN(aoSma[i]) ? null : ao[i] - aoSma[i]));
}

export function standardDeviation(closes, period = 20) {
  const mean = sma(closes, period);
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - mean[i], 2);
    out[i] = Math.sqrt(sumSq / period);
  }
  return out;
}

export function donchianChannels(candles, period = 20) {
  const n = candles.length;
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const mid = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    upper[i] = hi;
    lower[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { upper, lower, mid };
}

export function keltnerChannels(candles, period = 20, mult = 2) {
  const closes = candles.map((c) => c.c);
  const mid = ema(closes, period);
  const atrVals = atr(candles, period);
  const upper = mid.map((v, i) => (v != null && atrVals[i] != null ? v + mult * atrVals[i] : null));
  const lower = mid.map((v, i) => (v != null && atrVals[i] != null ? v - mult * atrVals[i] : null));
  return { upper, lower, mid };
}

export function moneyFlowIndex(candles, period = 14) {
  const n = candles.length;
  const typical = candles.map((c) => (c.h + c.l + c.c) / 3);
  const rawFlow = typical.map((tp, i) => tp * candles[i].v);
  const out = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typical[j] > typical[j - 1]) posFlow += rawFlow[j];
      else if (typical[j] < typical[j - 1]) negFlow += rawFlow[j];
    }
    out[i] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  }
  return out;
}

export function chaikinMoneyFlow(candles, period = 20) {
  const n = candles.length;
  const mfv = candles.map((c) => {
    const range = c.h - c.l;
    const mult = range === 0 ? 0 : ((c.c - c.l) - (c.h - c.c)) / range;
    return mult * c.v;
  });
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sumMfv = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMfv += mfv[j];
      sumVol += candles[j].v;
    }
    out[i] = sumVol === 0 ? 0 : sumMfv / sumVol;
  }
  return out;
}

export function vwma(candles, period = 20) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sumPV = 0, sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += candles[j].c * candles[j].v;
      sumV += candles[j].v;
    }
    out[i] = sumV === 0 ? null : sumPV / sumV;
  }
  return out;
}

export function balanceOfPower(candles) {
  return candles.map((c) => (c.h === c.l ? 0 : (c.c - c.o) / (c.h - c.l)));
}

export function trix(closes, period = 15) {
  const e1 = ema(closes, period);
  const e2 = ema(e1.map((v) => v ?? NaN), period);
  const e3 = ema(e2.map((v) => v ?? NaN), period);
  const out = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    if (e3[i] == null || e3[i - 1] == null || e3[i - 1] === 0 || Number.isNaN(e3[i]) || Number.isNaN(e3[i - 1])) continue;
    out[i] = ((e3[i] - e3[i - 1]) / e3[i - 1]) * 100;
  }
  return out;
}

export function elderForceIndex(candles, period = 13) {
  const raw = candles.map((c, i) => (i === 0 ? null : (c.c - candles[i - 1].c) * c.v));
  return ema(raw.map((v) => v ?? NaN), period).map((v, i) => (raw[i] == null ? null : v));
}

// SuperTrend — trend-following overlay built on ATR bands, flips direction
// when price crosses the current band. Returns {value, direction} per bar
// (direction: 1 = uptrend/support line below price, -1 = downtrend/resistance above).
export function superTrend(candles, period = 10, mult = 3) {
  const n = candles.length;
  const atrVals = atr(candles, period);
  const value = new Array(n).fill(null);
  const direction = new Array(n).fill(null);
  let prevUpper = null, prevLower = null, prevDir = 1;

  for (let i = 0; i < n; i++) {
    if (atrVals[i] == null) continue;
    const hl2 = (candles[i].h + candles[i].l) / 2;
    let basicUpper = hl2 + mult * atrVals[i];
    let basicLower = hl2 - mult * atrVals[i];

    const finalUpper = prevUpper != null && candles[i - 1].c <= prevUpper ? Math.min(basicUpper, prevUpper) : basicUpper;
    const finalLower = prevLower != null && candles[i - 1].c >= prevLower ? Math.max(basicLower, prevLower) : basicLower;

    let dir = prevDir;
    if (candles[i].c > finalUpper) dir = 1;
    else if (candles[i].c < finalLower) dir = -1;

    value[i] = dir === 1 ? finalLower : finalUpper;
    direction[i] = dir;
    prevUpper = finalUpper;
    prevLower = finalLower;
    prevDir = dir;
  }
  return { value, direction };
}

// Ichimoku Cloud — five lines: Tenkan-sen, Kijun-sen, Senkou Span A/B
// (plotted 26 periods forward, but returned here un-shifted — the chart
// layer is responsible for the forward display offset if desired), and
// Chikou Span (close plotted 26 periods back).
export function ichimoku(candles, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  const n = candles.length;
  const midpoint = (period) => {
    const out = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (candles[j].h > hi) hi = candles[j].h;
        if (candles[j].l < lo) lo = candles[j].l;
      }
      out[i] = (hi + lo) / 2;
    }
    return out;
  };
  const tenkan = midpoint(tenkanPeriod);
  const kijun = midpoint(kijunPeriod);
  const senkouA = tenkan.map((v, i) => (v != null && kijun[i] != null ? (v + kijun[i]) / 2 : null));
  const senkouB = midpoint(senkouBPeriod);
  const chikou = candles.map((c) => c.c);
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

export function ultimateOscillator(candles, p1 = 7, p2 = 14, p3 = 28) {
  const n = candles.length;
  const bp = new Array(n).fill(null); // buying pressure
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const prevClose = candles[i - 1].c;
    const trueLow = Math.min(candles[i].l, prevClose);
    const trueHigh = Math.max(candles[i].h, prevClose);
    bp[i] = candles[i].c - trueLow;
    tr[i] = trueHigh - trueLow;
  }
  const avg = (period, i) => {
    let sumBP = 0, sumTR = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumBP += bp[j] ?? 0;
      sumTR += tr[j] ?? 0;
    }
    return sumTR === 0 ? 0 : sumBP / sumTR;
  };
  const out = new Array(n).fill(null);
  for (let i = p3; i < n; i++) {
    const avg1 = avg(p1, i), avg2 = avg(p2, i), avg3 = avg(p3, i);
    out[i] = ((4 * avg1 + 2 * avg2 + avg3) / 7) * 100;
  }
  return out;
}

export function typicalPrice(candles) {
  return candles.map((c) => (c.h + c.l + c.c) / 3);
}
export function medianPrice(candles) {
  return candles.map((c) => (c.h + c.l) / 2);
}
export function averagePrice(candles) {
  return candles.map((c) => (c.o + c.h + c.l + c.c) / 4);
}

export function envelopes(closes, period = 20, pct = 2.5) {
  const mid = sma(closes, period);
  const upper = mid.map((v) => (v == null ? null : v * (1 + pct / 100)));
  const lower = mid.map((v) => (v == null ? null : v * (1 - pct / 100)));
  return { upper, lower, mid };
}
