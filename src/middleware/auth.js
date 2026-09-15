const jwt =
  require("jsonwebtoken");

const mongoose =
  require("mongoose");

const config =
  require("../config/environment");

const User =
  require("../models/user");


/*
 * =========================================================
 * CREATE JWT
 * =========================================================
 */

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


/*
 * =========================================================
 * DEVELOPMENT / PUBLIC USER
 * =========================================================
 *
 * IMPORTANTE:
 *
 * Mesmo sem login precisamos de uma identidade
 * válida para o backend.
 *
 * O Client model exige createdBy como ObjectId.
 *
 * Por isso NÃO usamos _id: null.
 *
 * Criamos um ObjectId válido por processo.
 *
 * Não é necessário existir um User no MongoDB,
 * porque o modo público não consulta o User.
 * =========================================================
 */

const developmentUserId =
  new mongoose.Types.ObjectId();


function createDevelopmentUser() {
  return {
    _id:
      developmentUserId,

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


/*
 * =========================================================
 * REQUIRE AUTH
 * =========================================================
 */

async function requireAuth(
  req,
  res,
  next
) {
  try {

    /*
     * =====================================================
     * PUBLIC MODE
     * =====================================================
     *
     * Quando AUTH_ENABLED=false:
     *
     * não existe login;
     * não existe sessão;
     * não existe JWT obrigatório.
     *
     * A aplicação recebe uma identidade operacional.
     */

    if (!config.authEnabled) {

      req.user =
        createDevelopmentUser();

      return next();
    }


    /*
     * =====================================================
     * AUTHENTICATED MODE
     * =====================================================
     */

    const token =
      req.cookies?.[
        config.cookieName
      ];

    if (!token) {

      return res
        .status(401)
        .json({
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

      return res
        .status(401)
        .json({
          success: false,

          error:
            "Invalid session"
        });
    }


    if (
      user.sessionVersion !==
      payload.sessionVersion
    ) {

      return res
        .status(401)
        .json({
          success: false,

          error:
            "Session expired"
        });
    }


    req.user =
      user;


    return next();

  } catch (error) {

    console.error(
      "[AUTH]",
      error.message
    );

    return res
      .status(401)
      .json({
        success: false,

        error:
          "Invalid session"
      });
  }
}


/*
 * =========================================================
 * REQUIRE ROLE
 * =========================================================
 */

function requireRole(
  ...roles
) {

  return (
    req,
    res,
    next
  ) => {

    /*
     * Public mode:
     *
     * A identidade operacional possui
     * permissões de owner.
     */

    if (
      !config.authEnabled
    ) {

      return next();
    }


    if (
      !req.user ||
      !roles.includes(
        req.user.role
      )
    ) {

      return res
        .status(403)
        .json({
          success: false,

          error:
            "Forbidden"
        });
    }


    return next();
  };
}


/*
 * =========================================================
 * EXPORT
 * =========================================================
 */

module.exports = {
  createToken,

  requireAuth,

  requireRole
};
