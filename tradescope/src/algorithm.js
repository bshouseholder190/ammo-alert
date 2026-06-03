'use strict';

const { ema, sma, rsi, rollingAvg } = require('./indicators');

// ── Signal types ──────────────────────────────────────────────────────────────
const SIGNAL = Object.freeze({
  STRONG_BUY:  'STRONG_BUY',
  BUY:         'BUY',
  HOLD:        'HOLD',
  SELL:        'SELL',
  STRONG_SELL: 'STRONG_SELL',
});

// ── TradeScope Algorithm ──────────────────────────────────────────────────────
//
//  Signal logic (per bar):
//
//  STRONG BUY  — EMA cross-up  + RSI not overbought + volume spike + bullish sentiment
//  BUY         — EMA above     + RSI ok              + volume ok   + sentiment ≥ 0
//  SELL        — EMA cross-down  OR  (RSI overbought AND bearish sentiment)
//                               OR  (bearish sentiment AND EMA bearish)
//  STRONG SELL — EMA cross-down + RSI overbought + bearish sentiment
//  HOLD        — no condition met
//
//  Confidence score (0–100):
//    70 % technical  (EMA divergence magnitude + RSI headroom)
//    30 % sentiment  (configurable via sentimentWeight)
//
class TradeScopeAlgorithm {
  constructor(config, logger) {
    this.cfg    = config.algorithm;
    this.logger = logger;
  }

  // Compute indicators + signal for every bar in `bars` (sorted oldest→newest).
  // Returns a new array with `indicators` and `signal` fields appended to each bar.
  computeSignals(bars) {
    const closes  = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    const rawSent = bars.map(b => b.sentiment);

    const emaShort  = ema(closes,  this.cfg.emaShortPeriod);
    const emaLong   = ema(closes,  this.cfg.emaLongPeriod);
    const rsiSeries = rsi(closes,  this.cfg.rsiPeriod);
    const volumeMa  = sma(volumes, this.cfg.volumeMaPeriod);

    // Null sentiment → 0 (neutral) before smoothing
    const sentFilled = rawSent.map(s => (s === null || s === undefined) ? 0 : s);
    const smoothSent = rollingAvg(sentFilled, this.cfg.sentimentWindow);

    return bars.map((bar, i) => {
      const ind = {
        emaShort:        emaShort[i],
        emaLong:         emaLong[i],
        rsi:             rsiSeries[i],
        volumeMa:        volumeMa[i],
        smoothSentiment: smoothSent[i],
      };
      const prevInd = i > 0 ? {
        emaShort: emaShort[i - 1],
        emaLong:  emaLong[i - 1],
      } : null;

      return { ...bar, indicators: ind, signal: this._signal(bar, ind, prevInd) };
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _signal(bar, ind, prevInd) {
    const {
      rsiOverbought, rsiOversold,
      volumeMultiplier,
      sentimentBuyThreshold, sentimentSellThreshold, sentimentWeight,
    } = this.cfg;

    if (ind.emaShort === null || ind.emaLong === null || ind.rsi === null) {
      return { type: SIGNAL.HOLD, confidence: 0, reason: 'insufficient data' };
    }

    // ── Derived booleans ─────────────────────────────────────────────────────
    const emaAbove     = ind.emaShort > ind.emaLong;
    const emaCrossUp   = prevInd && (prevInd.emaShort <= prevInd.emaLong) && emaAbove;
    const emaCrossDown = prevInd && (prevInd.emaShort >= prevInd.emaLong) && !emaAbove;

    const volumeOk     = ind.volumeMa === null
      || bar.volume >= ind.volumeMa * volumeMultiplier;

    const rsiOk        = ind.rsi < rsiOverbought;
    const rsiOverBought = ind.rsi >= rsiOverbought;

    const sentiment    = ind.smoothSentiment ?? 0;
    const sentBullish  = sentiment >= sentimentBuyThreshold;
    const sentBearish  = sentiment <= sentimentSellThreshold;

    // ── Confidence score (0–100) ─────────────────────────────────────────────
    const confidence = this._confidence(ind, emaAbove, sentiment, sentimentWeight);

    // ── Signal rules (most specific first) ───────────────────────────────────
    if (emaCrossDown && rsiOverBought && sentBearish) {
      return { type: SIGNAL.STRONG_SELL, confidence,
               reason: 'EMA cross-down + RSI overbought + bearish sentiment' };
    }
    if (emaCrossDown) {
      return { type: SIGNAL.SELL, confidence, reason: 'EMA cross-down' };
    }
    if (rsiOverBought && sentBearish) {
      return { type: SIGNAL.SELL, confidence, reason: 'RSI overbought + bearish sentiment' };
    }
    if (sentBearish && !emaAbove) {
      return { type: SIGNAL.SELL, confidence, reason: 'bearish sentiment + EMA bearish' };
    }
    if (emaCrossUp && rsiOk && sentBullish && volumeOk) {
      return { type: SIGNAL.STRONG_BUY, confidence,
               reason: 'EMA cross-up + volume confirmed + bullish sentiment' };
    }
    if (emaAbove && rsiOk && sentiment >= 0 && volumeOk) {
      return { type: SIGNAL.BUY, confidence,
               reason: 'EMA bullish + RSI ok + sentiment neutral/bullish' };
    }

    return { type: SIGNAL.HOLD, confidence, reason: 'no signal' };
  }

  _confidence(ind, emaAbove, sentiment, sentWeight) {
    // Technical component: EMA spread + RSI headroom
    const emaDivergence = ind.emaShort !== 0
      ? Math.abs((ind.emaShort - ind.emaLong) / ind.emaShort)
      : 0;
    const rsiHeadroom = emaAbove
      ? Math.max(0, (50 - ind.rsi) / 50)   // lower RSI → more upside room
      : Math.max(0, (ind.rsi - 50) / 50);  // higher RSI → more downside room
    const techScore = Math.min(1, emaDivergence * 20 + rsiHeadroom * 0.5);

    // Sentiment component (normalised 0–1)
    const normSent = emaAbove
      ? (Math.max(-1, Math.min(1, sentiment)) + 1) / 2
      : (1 - Math.max(-1, Math.min(1, sentiment))) / 2;

    return Math.round(((1 - sentWeight) * techScore + sentWeight * normSent) * 100);
  }
}

module.exports = { TradeScopeAlgorithm, SIGNAL };
