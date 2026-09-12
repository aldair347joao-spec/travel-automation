const logger =
  require("../utils/logger");

function notFound(req, res) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      error: "Route not found"
    });
  }

  return res.status(404).send(
    "Page not found"
  );
}

function errorHandler(
  error,
  req,
  res,
  next
) {
  logger.error(
    "Unhandled application error",
    {
      method: req.method,
      path: req.path,
      error: error.message
    }
  );

  if (res.headersSent) {
    return next(error);
  }

  const status =
    Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : error.message;

  return res.status(status).json({
    success: false,
    error: message
  });
}

module.exports = {
  notFound,
  errorHandler
};
