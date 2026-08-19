'use strict';

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

// Fail fast on a bad query shape rather than silently dropping fields.
mongoose.set('strictQuery', true);

async function connectDatabase() {
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { error: err.message });
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(env.MONGODB_URI, {
    // Surface an unreachable database in seconds, not after a long default.
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20,
  });

  logger.info('MongoDB connected', { db: mongoose.connection.name });
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

module.exports = { connectDatabase, disconnectDatabase, mongoose };
