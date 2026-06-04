'use strict';

// ── DataFetcher ───────────────────────────────────────────────────────────────
//
//  Pulls real-time price data and news from Yahoo Finance via yahoo-finance2 v3.
//  Produces bars in the same shape as DataLoader so the algorithm is unchanged.
//
//  Price bar shape:  { date, open, high, low, close, volume }
//  Quote extras:     { liveData: { price, change, changePct, prevClose,
//                                  marketCap, fiftyTwoWeekHigh, fiftyTwoWeekLow } }
//
//  yahoo-finance2 is ESM-only (v3+). We load it via a lazy dynamic import() so
//  the rest of the project stays in CommonJS.

let _yf = null;

async function getYf() {
  if (_yf) return _yf;
  let YahooFinance;
  try {
    // Package export path for v3
    const mod  = await import('yahoo-finance2');
    YahooFinance = mod.default ?? mod.YahooFinance ?? mod;
  } catch (err) {
    throw new Error(
      'yahoo-finance2 is not installed or failed to load.\n' +
      `Detail: ${err.message}\n` +
      'Fix:  cd tradescope && npm install'
    );
  }
  // v3: instantiate with options; suppress the survey notice
  _yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
  return _yf;
}

class DataFetcher {
  constructor(config, logger) {
    this.cfg    = config;
    this.logger = logger;
  }

  // ── Historical OHLCV ──────────────────────────────────────────────────────
  //
  //  Fetches `lookbackDays` of daily OHLCV bars for warm-up + signal history.

  async fetchHistoricalPrices(symbol, lookbackDays) {
    const yf   = await getYf();
    const days = lookbackDays ?? this.cfg.live?.lookbackDays ?? 120;

    this.logger.debug(`  ${symbol}: fetching ${days}d historical prices`);

    const rows = await yf.historical(symbol, {
      period1:  this._daysAgo(days),
      period2:  new Date(),
      interval: '1d',
    });

    return rows
      .filter(r => r.close != null && !isNaN(r.close))
      .map(r => ({
        date:   this._toDateStr(r.date),
        open:   r.open   ?? r.close,
        high:   r.high   ?? r.close,
        low:    r.low    ?? r.close,
        close:  r.close,
        volume: r.volume ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Live Quote ────────────────────────────────────────────────────────────
  //
  //  Returns today's bar.  Call after fetchHistoricalPrices and
  //  replace/append today's entry so the algorithm sees the latest close.

  async fetchLiveQuote(symbol) {
    const yf = await getYf();
    this.logger.debug(`  ${symbol}: fetching live quote`);

    const q    = await yf.quote(symbol);
    const date = this._toDateStr(new Date());

    return {
      date,
      open:   q.regularMarketOpen         ?? q.regularMarketPrice,
      high:   q.regularMarketDayHigh      ?? q.regularMarketPrice,
      low:    q.regularMarketDayLow       ?? q.regularMarketPrice,
      close:  q.regularMarketPrice,
      volume: q.regularMarketVolume       ?? 0,
      liveData: {
        price:            q.regularMarketPrice,
        change:           q.regularMarketChange,
        changePct:        q.regularMarketChangePercent,
        prevClose:        q.regularMarketPreviousClose,
        marketCap:        q.marketCap,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
        fiftyTwoWeekLow:  q.fiftyTwoWeekLow,
        shortName:        q.shortName ?? symbol,
      },
    };
  }

  // ── News Headlines ────────────────────────────────────────────────────────
  //
  //  Fetches up to 20 recent news items from Yahoo Finance.
  //  Used by SentimentScorer to derive per-date sentiment scores.

  async fetchNews(symbol) {
    const yf = await getYf();
    this.logger.debug(`  ${symbol}: fetching news headlines`);
    try {
      const result = await yf.search(symbol, { newsCount: 20 });
      return (result.news ?? []).map(item => ({
        date: item.providerPublishTime
          ? this._toDateStr(new Date(item.providerPublishTime * 1000))
          : this._toDateStr(new Date()),
        title:     item.title ?? '',
        publisher: item.publisher ?? '',
      }));
    } catch (err) {
      this.logger.warn(`  ${symbol}: news fetch failed (${err.message}) — using neutral sentiment`);
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  _toDateStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

module.exports = DataFetcher;
