'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  TradeScope Live Simulation
//
//  Applies the same algorithm as tradescope-sim.js but pulls real-time price
//  data and news sentiment from Yahoo Finance instead of local CSV files.
//
//  For each symbol in config.watchlist it:
//    1. Fetches the last <lookbackDays> of OHLCV history for indicator warm-up
//    2. Appends today's live quote
//    3. Fetches recent news headlines and scores sentiment
//    4. Runs the TradeScope dual-EMA + RSI + sentiment algorithm
//    5. Prints today's signal table and saves a JSON results file
//
//  Usage:
//    cd tradescope
//    npm install          (first time only)
//    node live-sim.js
//   — or —
//    npm run live
//
//  Configuration:  tradescope/config.js  →  fill in watchlist + live section
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const config           = require('./config');
const Logger           = require('./src/logger');
const DataFetcher      = require('./src/dataFetcher');
const SentimentScorer  = require('./src/sentimentScorer');
const { TradeScopeAlgorithm, SIGNAL } = require('./src/algorithm');

// ── Signal display helpers ────────────────────────────────────────────────────

const SIGNAL_LABEL = {
  [SIGNAL.STRONG_BUY]:  '++ STRONG BUY',
  [SIGNAL.BUY]:         '+  BUY       ',
  [SIGNAL.HOLD]:        '   HOLD      ',
  [SIGNAL.SELL]:        '-  SELL      ',
  [SIGNAL.STRONG_SELL]: '-- STRONG SELL',
};

// ── Validation ────────────────────────────────────────────────────────────────

function getRealSymbols(cfg) {
  return cfg.watchlist.filter(s => s && !s.startsWith('['));
}

// ── Per-symbol pipeline ───────────────────────────────────────────────────────

async function processSymbol(symbol, fetcher, scorer, algorithm, logger) {
  logger.info(`\n── ${symbol} ${'─'.repeat(Math.max(0, 52 - symbol.length))}`);

  // 1. Historical prices
  let bars;
  try {
    bars = await fetcher.fetchHistoricalPrices(symbol);
  } catch (err) {
    logger.error(`${symbol}: price fetch failed — ${err.message}`);
    return null;
  }
  if (!bars || bars.length === 0) {
    logger.warn(`${symbol}: no historical bars returned`);
    return null;
  }

  // 2. Live quote — replace or append today's bar
  let liveBar = null;
  try {
    liveBar         = await fetcher.fetchLiveQuote(symbol);
    const today     = liveBar.date;
    const todayIdx  = bars.findIndex(b => b.date === today);
    if (todayIdx >= 0) bars[todayIdx] = liveBar;   // market closed — update
    else               bars.push(liveBar);          // intraday — append
  } catch (err) {
    logger.warn(`${symbol}: live quote failed (${err.message}) — using last close`);
  }

  // 3. News + sentiment
  const news    = await fetcher.fetchNews(symbol);
  const sentMap = await scorer.score(symbol, news);
  logger.debug(`  ${symbol}: ${Object.keys(sentMap).length} sentiment dates scored`);

  // 4. Merge sentiment onto bars
  bars = bars.map(bar => ({
    ...bar,
    sentiment: sentMap[bar.date] ?? null,
  }));

  // 5. Compute TradeScope signals across the full bar history
  const barsWithSignals = algorithm.computeSignals(bars);
  const latest          = barsWithSignals[barsWithSignals.length - 1];

  // Recent signal context (last 5 bars)
  const recentSignals = barsWithSignals
    .slice(-5)
    .map(b => ({ date: b.date, type: b.signal.type, conf: b.signal.confidence }));

  return { symbol, latest, liveBar, recentSignals, barCount: bars.length };
}

// ── Results display ───────────────────────────────────────────────────────────

function printSignalTable(results, logger) {
  logger.section("TODAY'S TRADESCOPE SIGNALS");

  // Column header
  logger.info(
    'Symbol'.padEnd(8) + '  ' +
    'Price'.padStart(10) + '  ' +
    'Chg%'.padStart(7) + '  ' +
    'Signal'.padEnd(16) + '  ' +
    'Conf'.padStart(5) + '  ' +
    'EMA9'.padStart(9) + '  ' +
    'EMA21'.padStart(9) + '  ' +
    'RSI'.padStart(6) + '  ' +
    'Sent'.padStart(6) + '  ' +
    'Reason'
  );
  logger.info('─'.repeat(110));

  const actionable = [];

  for (const r of results) {
    if (!r) continue;
    const { symbol, latest, liveBar } = r;
    const { signal, indicators }      = latest;

    const price   = `$${latest.close.toFixed(2)}`;
    const chg     = liveBar?.liveData?.changePct != null
      ? `${liveBar.liveData.changePct >= 0 ? '+' : ''}${liveBar.liveData.changePct.toFixed(2)}%`
      : 'N/A';
    const sigLabel = SIGNAL_LABEL[signal.type] ?? signal.type;
    const emaS    = indicators.emaShort?.toFixed(2) ?? 'N/A';
    const emaL    = indicators.emaLong?.toFixed(2)  ?? 'N/A';
    const rsiVal  = indicators.rsi?.toFixed(1)      ?? 'N/A';
    const sent    = (indicators.smoothSentiment ?? 0).toFixed(2);

    logger.info(
      symbol.padEnd(8)     + '  ' +
      price.padStart(10)   + '  ' +
      chg.padStart(7)      + '  ' +
      sigLabel.padEnd(16)  + '  ' +
      `${signal.confidence}%`.padStart(5) + '  ' +
      emaS.padStart(9)     + '  ' +
      emaL.padStart(9)     + '  ' +
      rsiVal.padStart(6)   + '  ' +
      sent.padStart(6)     + '  ' +
      signal.reason
    );

    if (signal.type !== SIGNAL.HOLD) actionable.push(r);
  }

  if (actionable.length > 0) {
    logger.info('');
    logger.info('── Actionable signals ───────────────────────────────────────');
    for (const r of actionable) {
      const { symbol, latest, liveBar } = r;
      const ld = liveBar?.liveData;
      logger.info('');
      logger.info(`  ${symbol}  —  ${SIGNAL_LABEL[latest.signal.type].trim()}`);
      logger.info(`    Price       : $${latest.close.toFixed(2)}${ld ? `  (prev close $${ld.prevClose?.toFixed(2) ?? 'N/A'})` : ''}`);
      logger.info(`    Confidence  : ${latest.signal.confidence}%`);
      logger.info(`    Reason      : ${latest.signal.reason}`);
      if (ld?.fiftyTwoWeekHigh) {
        logger.info(`    52w range   : $${ld.fiftyTwoWeekLow?.toFixed(2)} – $${ld.fiftyTwoWeekHigh?.toFixed(2)}`);
      }
      logger.info(`    Recent sigs : ${r.recentSignals.map(s => `${s.date}:${s.type}(${s.conf}%)`).join('  ')}`);
    }
  } else {
    logger.info('');
    logger.info('  No actionable signals today — all symbols HOLD.');
  }
}

// ── Save results to disk ──────────────────────────────────────────────────────

function saveResults(results, cfg, logger) {
  const outDir = cfg.live?.outputFolder ?? cfg.data?.outputFolder;
  if (!outDir || outDir.startsWith('[')) {
    logger.warn('Output folder not configured — skipping JSON save.');
    return;
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const today   = new Date().toISOString().split('T')[0];
  const outFile = path.join(outDir, `live-signals-${today}.json`);

  const payload = {
    runAt:    new Date().toISOString(),
    watchlist: cfg.watchlist.filter(s => !s.startsWith('[')),
    signals: results
      .filter(Boolean)
      .map(r => ({
        symbol:       r.symbol,
        date:         r.latest.date,
        price:        r.latest.close,
        signal:       r.latest.signal,
        indicators:   r.latest.indicators,
        liveData:     r.liveBar?.liveData ?? null,
        recentSignals: r.recentSignals,
        barsAnalyzed: r.barCount,
      })),
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  logger.info(`\nSignals saved → ${outFile}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runLive() {
  const logger    = new Logger(config);
  const fetcher   = new DataFetcher(config, logger);
  const scorer    = new SentimentScorer(config, logger);
  const algorithm = new TradeScopeAlgorithm(config, logger);

  const symbols = getRealSymbols(config);

  logger.section('TradeScope Live Simulation');
  logger.info(`Run time    : ${new Date().toISOString()}`);
  logger.info(`Watchlist   : ${symbols.length > 0 ? symbols.join(', ') : '(none configured)'}`);
  logger.info(`Lookback    : ${config.live?.lookbackDays ?? 120} calendar days`);
  logger.info(`EMA         : ${config.algorithm.emaShortPeriod} / ${config.algorithm.emaLongPeriod}`);
  logger.info(`RSI         : ${config.algorithm.rsiPeriod}  OB:${config.algorithm.rsiOverbought} / OS:${config.algorithm.rsiOversold}`);
  logger.info(`Sentiment   : ${[
    !config.live?.finnhubApiKey?.startsWith('[')      && 'Finnhub',
    !config.live?.alphaVantageApiKey?.startsWith('[') && 'Alpha Vantage',
    !config.live?.newsApiKey?.startsWith('[')         && 'NewsAPI',
  ].filter(Boolean).join(', ') || 'keyword scoring (Yahoo Finance news)'}`);

  if (symbols.length === 0) {
    logger.warn('\nWatchlist is empty — add symbols to config.watchlist and re-run.');
    logger.close();
    return;
  }

  logger.section('Fetching Data');

  const results = [];
  for (const symbol of symbols) {
    const result = await processSymbol(symbol, fetcher, scorer, algorithm, logger);
    results.push(result);
  }

  const successful = results.filter(Boolean);
  if (successful.length === 0) {
    logger.error('All symbols failed to load data. Check your watchlist and network.');
    logger.close();
    return;
  }

  printSignalTable(successful, logger);
  saveResults(successful, config, logger);

  logger.section('Live Simulation Complete');
  logger.close();
}

runLive().catch(err => {
  console.error('[FATAL]', err.message);
  if (err.message.includes('yahoo-finance2')) {
    console.error('Run: cd tradescope && npm install');
  }
  process.exit(1);
});
