'use strict';

const env = require('./env');

// Minimal levelled logger. Structured enough to grep, small enough to read.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, message, ...(meta || {}) };
  const target = level === 'error' ? console.error : console.log;
  // JSON in production so aggregators can parse it; readable locally.
  target(env.isProduction ? JSON.stringify(line) : `[${line.ts.slice(11, 19)}] ${level.toUpperCase()}: ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
