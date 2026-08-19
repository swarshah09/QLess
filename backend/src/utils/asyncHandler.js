'use strict';

/**
 * Wraps an async route handler so rejected promises reach Express's error
 * middleware. Express 4 does not forward async errors on its own.
 */
module.exports = function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
