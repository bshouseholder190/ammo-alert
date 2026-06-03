'use strict';

const fs   = require('fs');
const path = require('path');

class Logger {
  constructor(config) {
    this.verbose      = config.logging.verbose;
    this.logEachTrade = config.logging.logEachTrade;
    this._resultsFile = config.logging.resultsFile;
    this._stream      = null;
    this._initStream(config.logging.logFile);
  }

  _initStream(logFile) {
    if (!logFile || logFile.startsWith('[')) return;
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._stream = fs.createWriteStream(logFile, { flags: 'a' });
  }

  _write(level, msg) {
    const ts   = new Date().toISOString();
    const line = `[${ts}] [${level.padEnd(5)}] ${msg}`;
    if (this.verbose || level === 'INFO' || level === 'WARN' || level === 'ERROR' || level === 'TRADE') {
      console.log(line);
    }
    if (this._stream) this._stream.write(line + '\n');
  }

  info(msg)  { this._write('INFO',  msg); }
  warn(msg)  { this._write('WARN',  msg); }
  error(msg) { this._write('ERROR', msg); }
  debug(msg) { if (this.verbose) this._write('DEBUG', msg); }
  trade(msg) { if (this.logEachTrade) this._write('TRADE', msg); }

  section(title) {
    const bar  = '═'.repeat(62);
    const line = `\n${bar}\n  ${title}\n${bar}`;
    this.info(line);
  }

  saveResults(results) {
    const file = this._resultsFile;
    if (!file || file.startsWith('[')) {
      this.warn('Results file path not configured — skipping JSON save.');
      return;
    }
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
    this.info(`Results saved → ${file}`);
  }

  close() {
    if (this._stream) this._stream.end();
  }
}

module.exports = Logger;
