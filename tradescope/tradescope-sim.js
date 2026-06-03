'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  TradeScope Simulation Bot
//
//  Entry point — orchestrates data loading, signal generation, portfolio
//  execution, and result logging for every symbol in config.watchlist.
//
//  Usage:
//    node tradescope-sim.js
//
//  Before running, fill in all [BRACKET PLACEHOLDERS] in config.js.
// ══════════════════════════════════════════════════════════════════════════════

const config     = require('./config');
const Logger     = require('./src/logger');
const DataLoader = require('./src/dataLoader');
const { TradeScopeAlgorithm, SIGNAL } = require('./src/algorithm');
const Portfolio  = require('./src/portfolio');

// ── Config validation ─────────────────────────────────────────────────────────

function validateConfig(cfg, logger) {
  const missing = [];
  if (cfg.data.priceDataFolder.startsWith('['))    missing.push('data.priceDataFolder');
  if (cfg.simulation.startDate.startsWith('['))    missing.push('simulation.startDate');
  if (cfg.simulation.endDate.startsWith('['))      missing.push('simulation.endDate');
  if (cfg.watchlist.every(s => s.startsWith('['))) missing.push('watchlist (all symbols are placeholders)');

  if (missing.length) {
    logger.warn('The following config values are still placeholders:');
    missing.forEach(k => logger.warn(`  ✗  ${k}`));
    logger.warn('Edit tradescope/config.js to fill them in.');
    return false;
  }
  return true;
}

// ── Per-symbol data pipeline ──────────────────────────────────────────────────

function loadSymbol(symbol, cfg, loader, algorithm, logger) {
  let priceData;
  try {
    priceData = loader.loadPriceData(symbol);
  } catch (err) {
    logger.error(`Skipping ${symbol}: ${err.message}`);
    return null;
  }

  const sentimentData = loader.loadSentimentData(symbol);

  priceData     = loader.filterByDateRange(priceData,     cfg.simulation.startDate, cfg.simulation.endDate);
  const sentIn  = loader.filterByDateRange(sentimentData, cfg.simulation.startDate, cfg.simulation.endDate);

  if (priceData.length === 0) {
    logger.warn(`${symbol}: no price bars in date range [${cfg.simulation.startDate} → ${cfg.simulation.endDate}]`);
    return null;
  }

  const merged = loader.mergeSentimentWithPrice(priceData, sentIn);
  return algorithm.computeSignals(merged);
}

// ── Execution loop ────────────────────────────────────────────────────────────

function executeBar(symbol, bar, portfolio, logger) {
  const { signal } = bar;
  const isSellSignal = signal.type === SIGNAL.SELL || signal.type === SIGNAL.STRONG_SELL;
  const isBuySignal  = signal.type === SIGNAL.BUY  || signal.type === SIGNAL.STRONG_BUY;

  // Exits take priority over entries
  if (portfolio.positions[symbol] && isSellSignal) {
    const trade = portfolio.sell(symbol, bar.date, bar.close, signal.reason);
    if (trade) {
      const flag = trade.pnl >= 0 ? '✓' : '✗';
      logger.trade(
        `${flag} SELL  ${symbol.padEnd(6)} @ $${trade.price.toFixed(2).padStart(10)} | ` +
        `P&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2).padStart(10)} ` +
        `(${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%) | ${signal.reason}`
      );
    }
  }

  if (!portfolio.positions[symbol] && isBuySignal) {
    const trade = portfolio.buy(symbol, bar.date, bar.close, signal.confidence);
    if (trade) {
      logger.trade(
        `  BUY   ${symbol.padEnd(6)} @ $${trade.price.toFixed(2).padStart(10)} | ` +
        `${trade.shares} shares | confidence: ${signal.confidence}% | ${signal.reason}`
      );
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runSimulation() {
  const logger    = new Logger(config);
  const loader    = new DataLoader(config, logger);
  const algorithm = new TradeScopeAlgorithm(config, logger);
  const portfolio = new Portfolio(config);

  // ── Banner ──────────────────────────────────────────────────────────────────
  logger.section('TradeScope Simulation Bot');
  logger.info(`Run date      : ${new Date().toISOString()}`);
  logger.info(`Date range    : ${config.simulation.startDate}  →  ${config.simulation.endDate}`);
  logger.info(`Initial cap   : $${config.simulation.initialCapital.toLocaleString()}`);
  logger.info(`Position size : ${(config.simulation.positionSizePct * 100).toFixed(0)}% per trade`);
  logger.info(`Max positions : ${config.simulation.maxPositions}`);
  logger.info(`Commission    : ${(config.simulation.commissionRate * 100).toFixed(2)}%`);
  logger.info(`Watchlist     : ${config.watchlist.join(', ')}`);
  logger.info(`EMA periods   : ${config.algorithm.emaShortPeriod} / ${config.algorithm.emaLongPeriod}`);
  logger.info(`RSI period    : ${config.algorithm.rsiPeriod} (OB:${config.algorithm.rsiOverbought} / OS:${config.algorithm.rsiOversold})`);
  logger.info(`Sentiment wt  : ${(config.algorithm.sentimentWeight * 100).toFixed(0)}%`);

  const configured = validateConfig(config, logger);
  if (!configured) {
    logger.warn('\nPlaceholder config detected — aborting before trying to read data files.');
    logger.warn('Fill in config.js and re-run: node tradescope-sim.js\n');
    logger.close();
    return;
  }

  // ── Load data + compute signals ─────────────────────────────────────────────
  logger.section('Loading Data & Computing Signals');

  const symbolBars = {};
  for (const symbol of config.watchlist) {
    const bars = loadSymbol(symbol, config, loader, algorithm, logger);
    if (bars && bars.length > 0) symbolBars[symbol] = bars;
  }

  if (Object.keys(symbolBars).length === 0) {
    logger.error('No symbols loaded successfully. Check config and data files.');
    logger.close();
    return;
  }

  // ── Simulation loop — iterate over every trading date ──────────────────────
  logger.section('Executing Simulation');

  const allDates = [
    ...new Set(Object.values(symbolBars).flatMap(bars => bars.map(b => b.date))),
  ].sort();

  for (const date of allDates) {
    const currentPrices = {};

    for (const [symbol, bars] of Object.entries(symbolBars)) {
      const bar = bars.find(b => b.date === date);
      if (!bar) continue;
      currentPrices[symbol] = bar.close;
      executeBar(symbol, bar, portfolio, logger);
    }

    portfolio.recordEquity(date, currentPrices);
  }

  // ── Close any positions still open at end of simulation ────────────────────
  for (const symbol of Object.keys({ ...portfolio.positions })) {
    const bars = symbolBars[symbol];
    const last = bars[bars.length - 1];
    const trade = portfolio.sell(symbol, last.date, last.close, 'end-of-simulation');
    if (trade) {
      logger.info(`Closed open position: ${symbol} @ $${last.close.toFixed(2)} (end-of-sim)`);
    }
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  logger.section('Overall Results');

  const metrics = portfolio.metrics();
  logger.info(`Final equity     : $${metrics.finalEquity.toLocaleString()}`);
  logger.info(`Total return     : ${metrics.totalReturnPct >= 0 ? '+' : ''}${metrics.totalReturnPct}%`);
  logger.info(`Total trades     : ${metrics.totalTrades}  (completed: ${metrics.completedTrades})`);
  logger.info(`Win rate         : ${metrics.winRate}%`);
  logger.info(`Avg win          : +${metrics.avgWinPct}%`);
  logger.info(`Avg loss         :  ${metrics.avgLossPct}%`);
  logger.info(`Profit factor    : ${metrics.profitFactor ?? 'N/A'}`);
  logger.info(`Max drawdown     : ${metrics.maxDrawdownPct}%`);
  logger.info(`Sharpe ratio     : ${metrics.sharpeRatio ?? 'N/A'}`);

  // ── Per-symbol summary ───────────────────────────────────────────────────────
  logger.section('Per-Symbol Summary');

  const bySymbol = {};
  for (const t of portfolio.trades.filter(t => t.type === 'SELL')) {
    (bySymbol[t.symbol] = bySymbol[t.symbol] ?? []).push(t);
  }

  for (const [sym, trades] of Object.entries(bySymbol)) {
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const wins     = trades.filter(t => t.pnl > 0).length;
    const wr       = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : '0';
    logger.info(
      `  ${sym.padEnd(8)} | trades: ${String(trades.length).padStart(3)} | ` +
      `wins: ${String(wins).padStart(3)} (${wr}%) | ` +
      `P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`
    );
  }

  // ── Save to disk ─────────────────────────────────────────────────────────────
  const results = {
    meta: {
      runAt:          new Date().toISOString(),
      startDate:      config.simulation.startDate,
      endDate:        config.simulation.endDate,
      watchlist:      config.watchlist,
      initialCapital: config.simulation.initialCapital,
    },
    metrics,
    perSymbol: Object.fromEntries(
      Object.entries(bySymbol).map(([sym, trades]) => [sym, {
        trades:        trades.length,
        wins:          trades.filter(t => t.pnl > 0).length,
        totalPnl:      +trades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
        tradeHistory:  trades,
      }])
    ),
    equityCurve: portfolio.equityCurve,
  };

  logger.saveResults(results);
  logger.section('Simulation Complete');
  logger.close();
}

runSimulation().catch(err => {
  console.error('[FATAL]', err.message, err.stack);
  process.exit(1);
});
