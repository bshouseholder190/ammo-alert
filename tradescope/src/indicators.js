'use strict';

// ── Exponential Moving Average ───────────────────────────────────────────────
// Seeds from the first full-period SMA; returns null for positions before seed.
function ema(prices, period) {
  const result = new Array(prices.length).fill(null);
  if (prices.length < period) return result;

  const k = 2 / (period + 1);
  let sum  = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  result[period - 1] = sum / period;

  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── Simple Moving Average ────────────────────────────────────────────────────
function sma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

// ── Relative Strength Index (Wilder smoothing) ───────────────────────────────
function rsi(prices, period) {
  const result = new Array(prices.length).fill(null);
  if (prices.length < period + 1) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else          avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ── Rolling average (skips nulls, window shrinks at edges) ───────────────────
function rollingAvg(values, window) {
  return values.map((_, i) => {
    const slice = [];
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      if (values[j] !== null && values[j] !== undefined) slice.push(values[j]);
    }
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

module.exports = { ema, sma, rsi, rollingAvg };
