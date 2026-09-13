const jwt =
  require("jsonwebtoken");

const config =
  require("../config/environment");

const User =
  require("../models/user");

function createToken(user) {
  return jwt.sign(
    {
      sub:
        user._id.toString(),

      accountId:
        user.accountId,

      role:
        user.role,

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

function createDevelopmentUser() {
  return {
    _id: null,

    accountId:
      config.developmentAccountId,

    name:
      config.developmentUserName,

    email:
      config.developmentUserEmail,

    role:
      "owner",

    active:
      true,

    sessionVersion:
      0
  };
}

async function requireAuth(
  req,
  res,
  next
) {
  try {
    /*
     * TEMPORARY DEVELOPMENT MODE
     *
     * When AUTH_ENABLED=false, the application
     * operates without login.
     *
     * The real authentication system remains
     * available and can be reactivated simply
     * by setting:
     *
     * AUTH_ENABLED=true
     */

    if (!config.authEnabled) {
      req.user =
        createDevelopmentUser();

      return next();
    }

    const token =
      req.cookies?.[
        config.cookieName
      ];

    if (!token) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication required"
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
        error:
          "Invalid session"
      });
    }

    if (
      user.sessionVersion !==
      payload.sessionVersion
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Session expired"
      });
    }

    req.user =
      user;

    return next();

  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Invalid session"
    });
  }
}

function requireRole(...roles) {
  return (
    req,
    res,
    next
  ) => {

    /*
     * Development mode has an internal
     * owner-level operational identity.
     */

    if (!config.authEnabled) {
      return next();
    }

    if (
      !req.user ||
      !roles.includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        success: false,
        error:
          "Forbidden"
      });
    }

    return next();
  };
}

module.exports = {
  createToken,
  requireAuth,
  requireRole
};
