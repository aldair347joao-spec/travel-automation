const jwt =
  require("jsonwebtoken");

const config =
  require("../config/environment");

function createToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role
    },
    config.jwtSecret,
    {
      expiresIn:
        config.jwtExpiresIn
    }
  );
}

function requireAuth(
  req,
  res,
  next
) {
  try {
    const token =
      req.cookies?.[config.cookieName];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    const payload =
      jwt.verify(
        token,
        config.jwtSecret
      );

    req.user = payload;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid session"
    });
  }
}

function requireRole(
  ...roles
) {
  return (
    req,
    res,
    next
  ) => {
    if (
      !req.user ||
      !roles.includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        success: false,
        error: "Forbidden"
      });
    }

    next();
  };
}

module.exports = {
  createToken,
  requireAuth,
  requireRole
};
