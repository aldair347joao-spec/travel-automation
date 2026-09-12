const crypto = require("crypto");

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const first = Buffer.from(a);
  const second = Buffer.from(b);

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    first,
    second
  );
}

function csrfProtection(req, res, next) {
  const safeMethods = new Set([
    "GET",
    "HEAD",
    "OPTIONS"
  ]);

  if (safeMethods.has(req.method)) {
    return next();
  }

  const cookieToken =
    req.cookies?.csrf_token;

  const headerToken =
    req.get("x-csrf-token");

  if (
    !cookieToken ||
    !headerToken ||
    !safeEqual(
      cookieToken,
      headerToken
    )
  ) {
    return res.status(403).json({
      success: false,
      error: "CSRF validation failed"
    });
  }

  next();
}

module.exports = csrfProtection;
