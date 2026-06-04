'use strict';

const https = require('https');

// ── Built-in keyword sentiment ─────────────────────────────────────────────────
//
//  Default scorer: scans news headline text for bullish / bearish words.
//  score = (bullishHits - bearishHits) / totalHits  →  clamped to [−1, +1]
//  Requires no API key.

const BULLISH = [
  'surge', 'soar', 'rally', 'gain', 'rise', 'beat', 'exceed', 'record',
  'strong', 'profit', 'growth', 'upgrade', 'outperform', 'bullish', 'positive',
  'breakthrough', 'jump', 'climb', 'advance', 'buy', 'opportunity', 'robust',
  'upside', 'optimistic', 'confident', 'recovery', 'boom', 'high', 'expand',
  'revenue', 'earnings beat', 'dividend', 'partnership', 'contract', 'deal',
];

const BEARISH = [
  'fall', 'drop', 'crash', 'decline', 'loss', 'miss', 'weak', 'downgrade',
  'underperform', 'bearish', 'negative', 'concern', 'risk', 'volatile', 'debt',
  'lawsuit', 'fine', 'investigation', 'recall', 'cut', 'layoff', 'warning',
  'downside', 'pessimistic', 'sell', 'short', 'bankruptcy', 'default', 'fraud',
  'slump', 'plunge', 'tumble', 'sink', 'worsen', 'disappoint', 'lower',
];

function keywordScore(text) {
  const lower = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULLISH) if (lower.includes(w)) bull++;
  for (const w of BEARISH) if (lower.includes(w)) bear++;
  const total = bull + bear;
  return total === 0 ? 0 : (bull - bear) / total;
}

// ── HTTP helper (no extra deps) ────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse error from ${url}`)); }
      });
    }).on('error', reject);
  });
}

// ── SentimentScorer ────────────────────────────────────────────────────────────

class SentimentScorer {
  constructor(config, logger) {
    this.live   = config.live ?? {};
    this.logger = logger;
  }

  // ── Default: keyword scoring from Yahoo Finance news ──────────────────────
  //
  //  Input : array of { date, title } news items
  //  Output: { 'YYYY-MM-DD': score, ... }  — one averaged score per date

  scoreFromNews(newsItems) {
    if (!newsItems || newsItems.length === 0) return {};
    const byDate = {};
    for (const item of newsItems) {
      const s = keywordScore(item.title);
      (byDate[item.date] = byDate[item.date] ?? []).push(s);
    }
    const result = {};
    for (const [date, scores] of Object.entries(byDate)) {
      result[date] = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4);
    }
    return result;
  }

  // ── Optional: Finnhub News Sentiment ──────────────────────────────────────
  //
  //  Returns a single number (company news score) for today if a valid key
  //  is configured; otherwise returns null and falls back to keyword scoring.
  //  API docs: https://finnhub.io/docs/api/news-sentiment
  //
  async fetchFinnhubSentiment(symbol) {
    const key = this.live.finnhubApiKey;
    if (!key || key.startsWith('[')) return null;
    this.logger.debug(`  ${symbol}: fetching Finnhub sentiment`);
    try {
      const url  = `https://finnhub.io/api/v1/news-sentiment?symbol=${symbol}&token=${key}`;
      const json = await httpGet(url);
      // companyNewsScore is 0–1; normalise to –1…+1
      const raw  = json.companyNewsScore ?? 0.5;
      return +((raw - 0.5) * 2).toFixed(4);   // 0→−1, 0.5→0, 1→+1
    } catch (err) {
      this.logger.warn(`  ${symbol}: Finnhub sentiment failed (${err.message})`);
      return null;
    }
  }

  // ── Optional: Alpha Vantage News & Sentiment ───────────────────────────────
  //
  //  Returns a per-date sentiment map if a valid key is configured.
  //  API docs: https://www.alphavantage.co/documentation/#news-sentiment
  //
  async fetchAlphaVantageSentiment(symbol) {
    const key = this.live.alphaVantageApiKey;
    if (!key || key.startsWith('[')) return null;
    this.logger.debug(`  ${symbol}: fetching Alpha Vantage sentiment`);
    try {
      const url  = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&apikey=${key}`;
      const json = await httpGet(url);
      if (!json.feed) return null;
      const byDate = {};
      for (const item of json.feed) {
        const date   = item.time_published?.slice(0, 10) ?? '';
        const ticker = (item.ticker_sentiment ?? []).find(t => t.ticker === symbol);
        if (!date || !ticker) continue;
        (byDate[date] = byDate[date] ?? []).push(parseFloat(ticker.ticker_sentiment_score ?? 0));
      }
      const result = {};
      for (const [date, scores] of Object.entries(byDate)) {
        result[date] = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4);
      }
      return result;
    } catch (err) {
      this.logger.warn(`  ${symbol}: Alpha Vantage sentiment failed (${err.message})`);
      return null;
    }
  }

  // ── Optional: NewsAPI headlines → keyword scoring ──────────────────────────
  //
  //  Fetches headlines from newsapi.org and runs keyword scoring on them.
  //  Richer headline set than Yahoo Finance search.
  //  API docs: https://newsapi.org/docs/endpoints/everything
  //
  async fetchNewsApiSentiment(symbol) {
    const key = this.live.newsApiKey;
    if (!key || key.startsWith('[')) return null;
    this.logger.debug(`  ${symbol}: fetching NewsAPI headlines`);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const fromStr = from.toISOString().split('T')[0];
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(symbol)}&from=${fromStr}&sortBy=publishedAt&pageSize=30&apiKey=${key}`;
      const json = await httpGet(url);
      const items = (json.articles ?? []).map(a => ({
        date:  (a.publishedAt ?? '').slice(0, 10),
        title: `${a.title ?? ''} ${a.description ?? ''}`,
      }));
      return this.scoreFromNews(items);
    } catch (err) {
      this.logger.warn(`  ${symbol}: NewsAPI sentiment failed (${err.message})`);
      return null;
    }
  }

  // ── Unified scorer — tries API keys in priority order ─────────────────────
  //
  //  Priority: Finnhub single score → Alpha Vantage → NewsAPI → keyword fallback
  //  Whichever is configured and succeeds first wins.

  async score(symbol, newsItems) {
    // 1. Finnhub (single score → applied to today)
    const finnhub = await this.fetchFinnhubSentiment(symbol);
    if (finnhub !== null) {
      const today = new Date().toISOString().split('T')[0];
      return { [today]: finnhub };
    }

    // 2. Alpha Vantage (per-date map)
    const av = await this.fetchAlphaVantageSentiment(symbol);
    if (av !== null) return av;

    // 3. NewsAPI (per-date map via keyword scoring)
    const newsApi = await this.fetchNewsApiSentiment(symbol);
    if (newsApi !== null) return newsApi;

    // 4. Fallback: keyword score on Yahoo Finance headlines already fetched
    return this.scoreFromNews(newsItems);
  }
}

module.exports = SentimentScorer;
