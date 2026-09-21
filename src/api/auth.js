const express =
require("express");

const bcrypt =
require("bcrypt");

const crypto =
require("crypto");

const User =
require("../models/user");

const Client =
require("../models/client");

const AuditLog =
require("../models/audit-log");

const config =
require("../config/environment");

const {
createToken,
requireAuth,
requireRole
} =
require("../middleware/auth");

const {
authLimiter
} =
require("../middleware/rate-limit");

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

  sameSite:
    "lax",

  path:
    "/",

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

  sameSite:
    "lax",

  path:
    "/",

  maxAge:
    15 * 60 * 1000
}

);
}

function serializeUser(
user
) {
return {
id:
user._id,

name:
  user.name,

email:
  user.email,

role:
  user.role,

clientId:
  user.clientId || null

};
}

/*

* =========================================================
* BOOTSTRAP OWNER
* =========================================================
  */

router.post(
"/bootstrap",
async (
req,
res,
next
) => {
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
    return res
      .status(403)
      .json({
        success:
          false,

        error:
          "Bootstrap forbidden"
      });
  }

  const count =
    await User.countDocuments();

  if (
    count > 0
  ) {
    return res
      .status(409)
      .json({
        success:
          false,

        error:
          "Initial account already created"
      });
  }

  const {
    name,
    email,
    password
  } =
    req.body;

  if (
    !name ||
    !email ||
    !validPassword(
      password
    )
  ) {
    return res
      .status(400)
      .json({
        success:
          false,

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

      name:
        String(
          name
        )
          .trim()
          .slice(
            0,
            120
          ),

      email:
        normalizeEmail(
          email
        ),

      passwordHash,

      role:
        "owner"
    });

  await AuditLog.create({
    actorId:
      user._id,

    action:
      "account.bootstrap",

    resource:
      "user",

    resourceId:
      user._id.toString(),

    ip:
      req.ip
  });

  return res
    .status(201)
    .json({
      success:
        true,

      message:
        "Owner account created"
    });

} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* LOGIN
* =========================================================
  */

router.post(
"/login",
authLimiter,
async (
req,
res,
next
) => {
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

  if (
    !user
  ) {
    return res
      .status(401)
      .json({
        success:
          false,

        error:
          "Invalid email or password"
      });
  }

  if (
    user.lockedUntil &&
    user.lockedUntil >
      new Date()
  ) {
    return res
      .status(423)
      .json({
        success:
          false,

        error:
          "Account temporarily locked"
      });
  }

  const valid =
    await bcrypt.compare(
      password ||
        "",
      user.passwordHash
    );

  if (
    !valid
  ) {
    const attempts =
      user.failedLoginAttempts +
      1;

    user.failedLoginAttempts =
      attempts;

    if (
      attempts >=
      5
    ) {
      user.lockedUntil =
        new Date(
          Date.now() +
            15 *
              60 *
              1000
        );
    }

    await user.save();

    return res
      .status(401)
      .json({
        success:
          false,

        error:
          "Invalid email or password"
      });
  }

  if (
    !user.active
  ) {
    return res
      .status(403)
      .json({
        success:
          false,

        error:
          "Account disabled"
      });
  }

  /*
   * -----------------------------------------------------
   * CLIENT ACCOUNT INTEGRITY
   * -----------------------------------------------------
   *
   * Um utilizador com role client precisa obrigatoriamente
   * de estar associado a um perfil Client.
   *
   * Se a associação estiver quebrada, não permitimos
   * entrar na plataforma.
   */

  if (
    user.role ===
    "client"
  ) {
    if (
      !user.clientId
    ) {
      return res
        .status(403)
        .json({
          success:
            false,

          error:
            "Client account is not linked to a client profile"
        });
    }

    const client =
      await Client.findOne({
        _id:
          user.clientId,

        accountId:
          user.accountId,

        active:
          true
      });

    if (
      !client
    ) {
      return res
        .status(403)
        .json({
          success:
            false,

          error:
            "Client profile is unavailable"
        });
    }
  }

  user.failedLoginAttempts =
    0;

  user.lockedUntil =
    null;

  user.lastLoginAt =
    new Date();

  await user.save();

  const token =
    createToken(
      user
    );

  setSessionCookies(
    res,
    token
  );

  await AuditLog.create({
    actorId:
      user._id,

    action:
      "auth.login",

    ip:
      req.ip
  });

  return res.json({
    success:
      true,

    user:
      serializeUser(
        user
      )
  });

} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* LOGOUT
* =========================================================
  */

router.post(
"/logout",
requireAuth,
async (
req,
res,
next
) => {
try {
if (
config.authEnabled
) {
req.user.sessionVersion +=
1;

    await req.user.save();

    await AuditLog.create({
      actorId:
        req.user._id,

      action:
        "auth.logout",

      ip:
        req.ip
    });
  }

  res.clearCookie(
    config.cookieName,
    {
      httpOnly:
        true,

      secure:
        config.cookieSecure,

      sameSite:
        "lax",

      path:
        "/"
    }
  );

  res.clearCookie(
    "csrf_token",
    {
      secure:
        config.cookieSecure,

      sameSite:
        "lax",

      path:
        "/"
    }
  );

  return res.json({
    success:
      true
  });

} catch (
  error
) {
  next(error);
}

}
);

/*

* =========================================================
* CURRENT SESSION
* =========================================================
  */

router.get(
"/me",
requireAuth,
async (
req,
res
) => {
return res.json({
success:
true,

  user:
    serializeUser(
      req.user
    )
});

}
);

/*

* =========================================================
* CREATE USER
* =========================================================
* 
* owner:
* admin
* operator
* viewer
* client
* 
* admin:
* operator
* viewer
* client
* 
* Apenas owner/admin podem criar contas.
* =========================================================
  */

router.post(
"/users",
requireAuth,
requireRole(
"owner",
"admin"
),
async (
req,
res,
next
) => {
try {
const {
name,
email,
password,
role,
clientId
} =
req.body;

  const allowedRoles =
    req.user.role ===
    "owner"
      ? [
          "admin",
          "operator",
          "viewer",
          "client"
        ]
      : [
          "operator",
          "viewer",
          "client"
        ];

  if (
    !allowedRoles.includes(
      role
    )
  ) {
    return res
      .status(403)
      .json({
        success:
          false,

        error:
          "Role not allowed"
      });
  }

  if (
    !name ||
    !email ||
    !validPassword(
      password
    )
  ) {
    return res
      .status(400)
      .json({
        success:
          false,

        error:
          "Invalid user data"
      });
  }

  const normalizedEmail =
    normalizeEmail(
      email
    );

  /*
   * -----------------------------------------------------
   * CLIENT ACCOUNT
   * -----------------------------------------------------
   */

  let linkedClient =
    null;

  if (
    role ===
    "client"
  ) {
    if (
      !clientId
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          error:
            "clientId is required for client accounts"
        });
    }

    linkedClient =
      await Client.findOne({
        _id:
          clientId,

        accountId:
          req.user.accountId,

        active:
          true
      });

    if (
      !linkedClient
    ) {
      return res
        .status(404)
        .json({
          success:
            false,

          error:
            "Client profile not found"
        });
    }

    /*
     * Um perfil de cliente possui uma única conta
     * de acesso.
     */

    const existingClientUser =
      await User.findOne({
        accountId:
          req.user.accountId,

        clientId:
          linkedClient._id,

        role:
          "client"
      });

    if (
      existingClientUser
    ) {
      return res
        .status(409)
        .json({
          success:
            false,

          error:
            "This client already has an access account"
        });
    }

    /*
     * O e-mail da conta deve corresponder ao e-mail
     * registado no perfil do cliente.
     *
     * Isto evita criar uma conta para uma pessoa e
     * associá-la silenciosamente ao perfil de outra.
     */

    if (
      normalizeEmail(
        linkedClient.email
      ) !==
      normalizedEmail
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          error:
            "The login email must match the client profile email"
        });
    }
  }

  /*
   * -----------------------------------------------------
   * DUPLICATE EMAIL
   * -----------------------------------------------------
   */

  const existingUser =
    await User.findOne({
      email:
        normalizedEmail
    });

  if (
    existingUser
  ) {
    return res
      .status(409)
      .json({
        success:
          false,

        error:
          "An account with this email already exists"
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

      clientId:
        role ===
        "client"
          ? linkedClient._id
          : null,

      name:
        String(
          name
        )
          .trim()
          .slice(
            0,
            120
          ),

      email:
        normalizedEmail,

      passwordHash,

      role
    });

  await AuditLog.create({
    actorId:
      req.user._id,

    action:
      "user.create",

    resource:
      "user",

    resourceId:
      user._id.toString(),

    ip:
      req.ip,

    metadata: {
      role:
        user.role,

      clientId:
        user.clientId
          ? user.clientId.toString()
          : null
    }
  });

  return res
    .status(201)
    .json({
      success:
        true,

      user:
        serializeUser(
          user
        )
    });

} catch (
  error
) {
  next(error);
}

}
);

module.exports =
router;
