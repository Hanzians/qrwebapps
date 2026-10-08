function asyncHandler(fn) {
  return function(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function errorHandler(err, req, res, next) {
  console.error('[Error:', err.message, ']');
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return res.status(500).json({ error: 'server_error' });
}

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { asyncHandler, errorHandler, AppError };
