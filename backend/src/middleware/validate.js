'use strict';

const { ApiError } = require('../utils/ApiError');

/**
 * Validates and REPLACES req.body/query/params with the parsed, coerced values,
 * so controllers can trust their inputs and stay thin.
 */
module.exports = function validate(schemas) {
  return (req, _res, next) => {
    const details = [];

    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        // req.query has only a getter on some Express versions.
        Object.defineProperty(req, key, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        for (const issue of result.error.issues) {
          details.push({
            field: issue.path.length ? `${key}.${issue.path.join('.')}` : key,
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) {
      return next(ApiError.validation('Request validation failed', details));
    }
    return next();
  };
};
