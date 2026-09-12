const express =
  require("express");

const bcrypt =
  require("bcrypt");

const crypto =
  require("crypto");

const User =
  require("../models/user");

const AuditLog =
  require("../models/audit-log");

const config =
  require("../config/environment");

const {
  createToken,
  requireAuth,
  requireRole
} = require("../middleware/auth");

const {
  authLimiter
} = require("../middleware/rate-limit");

const router =
  express.Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function setSessionCookies(
  res,
  token
) {
  const csrfToken =
    crypto.randomBytes(32)
      .toString("hex");

  res.cookie(
    config.cookieName,
    token,
    {
      httpOnly: true,
      secure:
        config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge:
        15 * 60 * 1000
    }
  );

  res.cookie(
    "csrf_token",
    csrfToken,
    {
      httpOnly: false,
      secure:
        config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge:
        15 * 60 * 1000
    }
  );
}

router.post(
  "/bootstrap",
  async (req, res, next) => {
    try {
      const bootstrapToken =
        req.get(
          "x-bootstrap-token"
        );

      const configuredToken =
        process.env.BOOTSTRAP_TOKEN;

      if (
        !configuredToken ||
        !bootstrapToken ||
        bootstrapToken !==
          configuredToken
      ) {
        return res.status(403).json({
          success: false,
          error: "Bootstrap forbidden"
        });
      }

      const count =
        await User.countDocuments();

      if (count > 0) {
        return res.status(409).json({
          success: false,
          error:
            "Initial account already created"
        });
      }

      const {
        name,
        email,
        password
      } = req.body;

      if (
        !name ||
        !email ||
        !validPassword(password)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Name, email and strong password are required"
        });
      }

      const accountId =
        crypto.randomUUID();

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const user =
        await User.create({
          accountId,
          name: String(name)
            .trim()
            .slice(0, 120),
          email:
            normalizeEmail(email),
          passwordHash,
          role: "owner"
        });

      await AuditLog.create({
        actorId: user._id,
        action:
          "account.bootstrap",
        resource: "user",
        resourceId:
          user._id.toString(),
        ip: req.ip
      });

      return res.status(201).json({
        success: true,
        message:
          "Owner account created"
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/login",
  authLimiter,
  async (req, res, next) => {
    try {
      const email =
        normalizeEmail(
          req.body.email
        );

      const password =
        req.body.password;

      const user =
        await User.findOne({
          email
        }).select(
          "+passwordHash"
        );

      if (!user) {
        return res.status(401).json({
          success: false,
          error:
            "Invalid email or password"
        });
      }

      if (
        user.lockedUntil &&
        user.lockedUntil >
          new Date()
      ) {
        return res.status(423).json({
          success: false,
          error:
            "Account temporarily locked"
        });
      }

      const valid =
        await bcrypt.compare(
          password || "",
          user.passwordHash
        );

      if (!valid) {
        const attempts =
          user.failedLoginAttempts + 1;

        user.failedLoginAttempts =
          attempts;

        if (attempts >= 5) {
          user.lockedUntil =
            new Date(
              Date.now() +
                15 * 60 * 1000
            );
        }

        await user.save();

        return res.status(401).json({
          success: false,
          error:
            "Invalid email or password"
        });
      }

      if (!user.active) {
        return res.status(403).json({
          success: false,
          error: "Account disabled"
        });
      }

      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt =
        new Date();

      await user.save();

      const token =
        createToken(user);

      setSessionCookies(
        res,
        token
      );

      await AuditLog.create({
        actorId: user._id,
        action: "auth.login",
        ip: req.ip
      });

      return res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/logout",
  requireAuth,
  async (req, res, next) => {
    try {
      req.user.sessionVersion += 1;

      await req.user.save();

      res.clearCookie(
        config.cookieName,
        {
          httpOnly: true,
          secure:
            config.cookieSecure,
          sameSite: "lax",
          path: "/"
        }
      );

      res.clearCookie(
        "csrf_token",
        {
          secure:
            config.cookieSecure,
          sameSite: "lax",
          path: "/"
        }
      );

      await AuditLog.create({
        actorId: req.user._id,
        action: "auth.logout",
        ip: req.ip
      });

      return res.json({
        success: true
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/me",
  requireAuth,
  async (req, res) => {
    return res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role
      }
    });
  }
);

router.post(
  "/users",
  requireAuth,
  requireRole(
    "owner",
    "admin"
  ),
  async (req, res, next) => {
    try {
      const {
        name,
        email,
        password,
        role
      } = req.body;

      const allowedRoles =
        req.user.role === "owner"
          ? [
              "admin",
              "operator",
              "viewer"
            ]
          : [
              "operator",
              "viewer"
            ];

      if (
        !allowedRoles.includes(
          role
        )
      ) {
        return res.status(403).json({
          success: false,
          error:
            "Role not allowed"
        });
      }

      if (
        !name ||
        !email ||
        !validPassword(password)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid user data"
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const user =
        await User.create({
          accountId:
            req.user.accountId,
          name: String(name)
            .trim()
            .slice(0, 120),
          email:
            normalizeEmail(email),
          passwordHash,
          role
        });

      await AuditLog.create({
        actorId: req.user._id,
        action:
          "user.create",
        resource: "user",
        resourceId:
          user._id.toString(),
        ip: req.ip
      });

      return res.status(201).json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
