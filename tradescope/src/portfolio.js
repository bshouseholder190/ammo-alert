'use strict';

// ── Portfolio ─────────────────────────────────────────────────────────────────
//
//  Tracks cash, open positions, completed trades, and equity curve.
//  Position sizing: (portfolio equity × positionSizePct) × (confidence / 60)
//  — confidence below 60 shrinks the position; above 60 keeps it at full size.
//
class Portfolio {
  constructor(config) {
    const sim             = config.simulation;
    this.initialCapital   = sim.initialCapital;
    this.cash             = sim.initialCapital;
    this.positionSizePct  = sim.positionSizePct;
    this.maxPositions     = sim.maxPositions;
    this.commissionRate   = sim.commissionRate;
    this.slippagePct      = sim.slippagePct;

    // symbol → { shares, entryPrice, entryDate }
    this.positions   = {};
    // All trade records (BUY + SELL)
    this.trades      = [];
    // Daily equity snapshots
    this.equityCurve = [{ date: null, equity: this.initialCapital }];
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  get openPositionCount() {
    return Object.keys(this.positions).length;
  }

  totalEquity(currentPrices) {
    let equity = this.cash;
    for (const [sym, pos] of Object.entries(this.positions)) {
      equity += pos.shares * (currentPrices[sym] ?? pos.entryPrice);
    }
    return equity;
  }

  canBuy(symbol) {
    return !this.positions[symbol] && this.openPositionCount < this.maxPositions;
  }

  // ── Execution ────────────────────────────────────────────────────────────────

  buy(symbol, date, price, confidence) {
    if (!this.canBuy(symbol)) return null;

    const adjPrice  = price * (1 + this.slippagePct);
    const posValue  = this.cash * this.positionSizePct * Math.min(1, confidence / 60);
    const shares    = Math.floor(posValue / adjPrice);
    if (shares <= 0) return null;

    const cost       = shares * adjPrice;
    const commission = cost * this.commissionRate;
    const totalCost  = cost + commission;
    if (totalCost > this.cash) return null;

    this.cash -= totalCost;
    this.positions[symbol] = { shares, entryPrice: adjPrice, entryDate: date };

    const trade = {
      type: 'BUY', symbol, date,
      price: +adjPrice.toFixed(4),
      shares, cost: +cost.toFixed(2),
      commission: +commission.toFixed(2),
      confidence,
    };
    this.trades.push(trade);
    return trade;
  }

  sell(symbol, date, price, reason) {
    const pos = this.positions[symbol];
    if (!pos) return null;

    const adjPrice   = price * (1 - this.slippagePct);
    const proceeds   = pos.shares * adjPrice;
    const commission = proceeds * this.commissionRate;
    const net        = proceeds - commission;

    this.cash += net;
    delete this.positions[symbol];

    const entryCost = pos.shares * pos.entryPrice * (1 + this.commissionRate);
    const pnl       = net - entryCost;
    const pnlPct    = (pnl / entryCost) * 100;

    const trade = {
      type: 'SELL', symbol, date,
      price:      +adjPrice.toFixed(4),
      shares:     pos.shares,
      proceeds:   +proceeds.toFixed(2),
      commission: +commission.toFixed(2),
      entryPrice: +pos.entryPrice.toFixed(4),
      entryDate:  pos.entryDate,
      pnl:        +pnl.toFixed(2),
      pnlPct:     +pnlPct.toFixed(2),
      reason,
    };
    this.trades.push(trade);
    return trade;
  }

  recordEquity(date, currentPrices) {
    this.equityCurve.push({ date, equity: +this.totalEquity(currentPrices).toFixed(2) });
  }

  // ── Summary Metrics ───────────────────────────────────────────────────────────

  metrics() {
    // Close any still-open positions at entry price for final tally
    const openValue = Object.values(this.positions)
      .reduce((s, p) => s + p.shares * p.entryPrice, 0);
    const finalEquity  = +(this.cash + openValue).toFixed(2);
    const totalReturn  = +((finalEquity - this.initialCapital) / this.initialCapital * 100).toFixed(2);

    const sells    = this.trades.filter(t => t.type === 'SELL');
    const wins     = sells.filter(t => t.pnl > 0);
    const losses   = sells.filter(t => t.pnl <= 0);
    const winRate  = sells.length > 0 ? +(wins.length / sells.length * 100).toFixed(1) : 0;
    const avgWin   = wins.length   > 0 ? +(wins.reduce((s, t)   => s + t.pnlPct, 0) / wins.length).toFixed(2) : 0;
    const avgLoss  = losses.length > 0 ? +(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length).toFixed(2) : 0;
    const profitFactor = losses.length > 0 && wins.length > 0
      ? +(wins.reduce((s, t) => s + t.pnl, 0) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))).toFixed(3)
      : null;

    // Max drawdown
    let peak = -Infinity, maxDrawdown = 0;
    for (const { equity } of this.equityCurve) {
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Annualised Sharpe (assumes daily bars, 252 trading days/year)
    const dailyReturns = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].equity;
      if (prev > 0) dailyReturns.push((this.equityCurve[i].equity - prev) / prev);
    }
    let sharpe = null;
    if (dailyReturns.length > 1) {
      const mean     = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
      const std      = Math.sqrt(variance);
      sharpe = std > 0 ? +((mean / std) * Math.sqrt(252)).toFixed(3) : null;
    }

    return {
      initialCapital:   this.initialCapital,
      finalEquity,
      totalReturnPct:   totalReturn,
      totalTrades:      this.trades.length,
      completedTrades:  sells.length,
      winRate,
      avgWinPct:        avgWin,
      avgLossPct:       avgLoss,
      profitFactor,
      maxDrawdownPct:   +(maxDrawdown * 100).toFixed(2),
      sharpeRatio:      sharpe,
      openPositions:    Object.keys(this.positions).length,
    };
  }
}

module.exports = Portfolio;
