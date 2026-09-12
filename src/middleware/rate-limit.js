const rateLimit =
  require("express-rate-limit");

const generalLimiter =
  rateLimit({
    windowMs: 60 * 1000,

    limit: 120,

    standardHeaders: true,

    legacyHeaders: false,

    message: {
      success: false,
      error: "Too many requests"
    }
  });

const authLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,

    limit: 10,

    standardHeaders: true,

    legacyHeaders: false,

    message: {
      success: false,
      error:
        "Too many authentication attempts"
    }
  });

module.exports = {
  generalLimiter,
  authLimiter
};
