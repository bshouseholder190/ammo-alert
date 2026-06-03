'use strict';

const fs   = require('fs');
const path = require('path');

// ── Minimal CSV parser (no dependencies) ────────────────────────────────────

function parseCSV(content) {
  const lines   = content.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1)
    .filter(l => l.trim() !== '')
    .map(line => {
      const vals = line.split(',').map(v => v.trim());
      const row  = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
}

function toPriceBar(row) {
  return {
    date:   row.date,
    open:   parseFloat(row.open),
    high:   parseFloat(row.high),
    low:    parseFloat(row.low),
    close:  parseFloat(row.close),
    volume: parseFloat(row.volume),
  };
}

function toSentimentEntry(row) {
  return {
    date:  row.date,
    score: parseFloat(row.score),
  };
}

// ── DataLoader ───────────────────────────────────────────────────────────────

class DataLoader {
  constructor(config, logger) {
    this.cfg    = config;
    this.logger = logger;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _readFile(folder, symbol, format) {
    if (!folder || folder.startsWith('[')) {
      throw new Error(`Data folder not configured: "${folder}"`);
    }
    const filePath = path.join(folder, `${symbol}.${format}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return format === 'json' ? JSON.parse(raw) : parseCSV(raw);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  loadPriceData(symbol) {
    const { priceDataFolder, priceFileFormat } = this.cfg.data;
    const rows = this._readFile(priceDataFolder, symbol, priceFileFormat);
    const bars = rows.map(toPriceBar).filter(b => !isNaN(b.close) && !isNaN(b.volume));
    bars.sort((a, b) => a.date.localeCompare(b.date));
    this.logger.debug(`${symbol}: loaded ${bars.length} price bars`);
    return bars;
  }

  loadSentimentData(symbol) {
    const { sentimentDataFolder, sentimentFileFormat } = this.cfg.data;
    if (!sentimentDataFolder || sentimentDataFolder.startsWith('[')) {
      this.logger.warn(`${symbol}: sentiment folder not set — defaulting to neutral (0)`);
      return [];
    }
    const filePath = path.join(sentimentDataFolder, `${symbol}.${sentimentFileFormat}`);
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`${symbol}: no sentiment file found — defaulting to neutral (0)`);
      return [];
    }
    const raw     = fs.readFileSync(filePath, 'utf-8');
    const rows    = sentimentFileFormat === 'json' ? JSON.parse(raw) : parseCSV(raw);
    const entries = rows.map(toSentimentEntry).filter(e => !isNaN(e.score));
    entries.sort((a, b) => a.date.localeCompare(b.date));
    this.logger.debug(`${symbol}: loaded ${entries.length} sentiment entries`);
    return entries;
  }

  filterByDateRange(data, startDate, endDate) {
    if (!startDate || startDate.startsWith('[') || !endDate || endDate.startsWith('[')) {
      return data;
    }
    return data.filter(r => r.date >= startDate && r.date <= endDate);
  }

  // Merge sentiment scores onto price bars by date (missing dates get null)
  mergeSentimentWithPrice(priceBars, sentimentEntries) {
    const sentMap = new Map(sentimentEntries.map(e => [e.date, e.score]));
    return priceBars.map(bar => ({
      ...bar,
      sentiment: sentMap.has(bar.date) ? sentMap.get(bar.date) : null,
    }));
  }
}

module.exports = DataLoader;
