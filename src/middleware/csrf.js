const crypto =
  require("crypto");

const config =
  require("../config/environment");

function safeEqual(
  a,
  b
) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const first =
    Buffer.from(a);

  const second =
    Buffer.from(b);

  if (
    first.length !==
    second.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    first,
    second
  );
}

function csrfProtection(
  req,
  res,
  next
) {
  /*
   * During temporary development mode,
   * authentication is disabled and therefore
   * there is no authenticated browser session
   * requiring CSRF protection.
   */

  if (!config.authEnabled) {
    return next();
  }

  const safeMethods =
    new Set([
      "GET",
      "HEAD",
      "OPTIONS"
    ]);

  if (
    safeMethods.has(
      req.method
    )
  ) {
    return next();
  }

  const cookieToken =
    req.cookies?.csrf_token;

  const headerToken =
    req.get(
      "x-csrf-token"
    );

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
      error:
        "CSRF validation failed"
    });
  }

  return next();
}

module.exports =
  csrfProtection;
