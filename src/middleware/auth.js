const jwt =
  require("jsonwebtoken");

const config =
  require("../config/environment");

const User =
  require("../models/user");

function createToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      accountId: user.accountId,
      role: user.role,
      sessionVersion:
        user.sessionVersion
    },
    config.jwtSecret,
    {
      expiresIn:
        config.jwtExpiresIn
    }
  );
}

async function requireAuth(
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

    const user =
      await User.findById(
        payload.sub
      );

    if (
      !user ||
      !user.active
    ) {
      return res.status(401).json({
        success: false,
        error: "Invalid session"
      });
    }

    if (
      user.sessionVersion !==
      payload.sessionVersion
    ) {
      return res.status(401).json({
        success: false,
        error: "Session expired"
      });
    }

    req.user = user;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid session"
    });
  }
}

function requireRole(...roles) {
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
