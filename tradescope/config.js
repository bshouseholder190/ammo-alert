'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  TradeScope Simulation — Configuration
//  Replace every [BRACKET PLACEHOLDER] with your real values before running.
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {

  // ─── Data Sources ──────────────────────────────────────────────────────────
  //
  //  Price files   → one file per symbol, named <SYMBOL>.csv (or .json)
  //  CSV columns   : date,open,high,low,close,volume
  //  JSON format   : [ { "date":"YYYY-MM-DD", "open":0, "high":0,
  //                       "low":0, "close":0, "volume":0 }, ... ]
  //
  //  Sentiment files → one file per symbol, named <SYMBOL>.csv (or .json)
  //  CSV columns   : date,score        (score: float –1.0 to +1.0)
  //  JSON format   : [ { "date":"YYYY-MM-DD", "score": 0.0 }, ... ]
  //
  data: {
    priceDataFolder:     '[ADD PRICE DATA FOLDER HERE]',      // e.g. './data/prices'
    sentimentDataFolder: '[ADD SENTIMENT DATA FOLDER HERE]',  // e.g. './data/sentiment'
    outputFolder:        '[ADD OUTPUT FOLDER HERE]',          // e.g. './results'
    priceFileFormat:     'csv',    // 'csv' or 'json'
    sentimentFileFormat: 'csv',    // 'csv' or 'json'
  },

  // ─── Watchlist ─────────────────────────────────────────────────────────────
  //  Each symbol must have a corresponding price file in priceDataFolder.
  //  Sentiment files are optional — missing files default to neutral (0).
  watchlist: [
    '[ADD SYMBOL 1 HERE]',   // e.g. 'AAPL'
    '[ADD SYMBOL 2 HERE]',   // e.g. 'TSLA'
    '[ADD SYMBOL 3 HERE]',   // e.g. 'MSFT'
  ],

  // ─── Simulation Parameters ─────────────────────────────────────────────────
  simulation: {
    startDate:       '[ADD START DATE HERE]',   // e.g. '2023-01-01'  (YYYY-MM-DD)
    endDate:         '[ADD END DATE HERE]',     // e.g. '2024-01-01'  (YYYY-MM-DD)
    initialCapital:  100000,   // Starting portfolio value in USD
    positionSizePct: 0.10,     // Fraction of portfolio per position  (0.10 = 10 %)
    maxPositions:    5,        // Maximum concurrent open positions
    commissionRate:  0.001,    // Per-trade commission  (0.001 = 0.1 %)
    slippagePct:     0.0005,   // Simulated market-impact slippage (0.05 %)
  },

  // ─── TradeScope Algorithm Parameters ──────────────────────────────────────
  algorithm: {
    // Trend — dual-EMA crossover
    emaShortPeriod: 9,     // Fast EMA lookback (bars)
    emaLongPeriod:  21,    // Slow EMA lookback (bars)

    // Momentum — RSI
    rsiPeriod:     14,
    rsiOverbought: 70,
    rsiOversold:   30,

    // Volume filter — only trade when volume confirms activity
    volumeMaPeriod:    20,   // Simple moving average period for volume baseline
    volumeMultiplier:  1.2,  // Require volume > 1.2× its 20-day average

    // Sentiment overlay
    sentimentWindow:         5,     // Rolling window for smoothing raw sentiment scores
    sentimentBuyThreshold:   0.20,  // Smoothed sentiment must be ≥ this to allow a buy
    sentimentSellThreshold: -0.20,  // Smoothed sentiment ≤ this triggers an exit
    sentimentWeight:         0.30,  // Sentiment's share of the blended confidence score (0–1)
  },

  // ─── Logging ───────────────────────────────────────────────────────────────
  logging: {
    logFile:     '[ADD LOG FILE PATH HERE]',      // e.g. './results/tradescope.log'
    resultsFile: '[ADD RESULTS FILE PATH HERE]',  // e.g. './results/results.json'
    verbose:     true,   // Print per-bar DEBUG lines to console
    logEachTrade: true,  // Print a line for every BUY / SELL execution
  },

  // ─── Live Mode (live-sim.js) ────────────────────────────────────────────────
  //
  //  live-sim.js fetches real-time data from Yahoo Finance — no files needed.
  //  Sentiment is scored from Yahoo Finance news headlines by default.
  //  Optionally wire in a third-party sentiment API by filling in an API key.
  //
  live: {
    // How many calendar days of history to pull for indicator warm-up.
    // Must be large enough for the longest indicator period (emaLongPeriod,
    // rsiPeriod, volumeMaPeriod).  120 days is safe for default settings.
    lookbackDays: 120,

    // Where to write the daily signals JSON file.
    outputFolder: '[ADD OUTPUT FOLDER HERE]',     // e.g. './results/live'

    // ── Optional: Finnhub News Sentiment ──────────────────────────────────
    // Free tier at https://finnhub.io — 60 req/min.
    // Provides pre-computed sentiment scores; overrides keyword scoring when set.
    finnhubApiKey: '[ADD FINNHUB API KEY HERE]',  // e.g. 'abc123xyz'

    // ── Optional: Alpha Vantage News & Sentiment ───────────────────────────
    // Free tier at https://www.alphavantage.co — 25 req/day.
    alphaVantageApiKey: '[ADD ALPHA VANTAGE API KEY HERE]',

    // ── Optional: NewsAPI headlines ────────────────────────────────────────
    // Free tier at https://newsapi.org — 100 req/day, developer plan.
    newsApiKey: '[ADD NEWSAPI KEY HERE]',
  },
};
