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
 * Quando AUTH_ENABLED=false, o sistema continua a funcionar
 * sem login para desenvolvimento.
 *
 * O Client model exige createdBy como ObjectId, por isso
 * mantemos um ObjectId válido durante o processo.
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
 * AUTHENTICATE REQUEST
 * =========================================================
 *
 * Esta função concentra a validação da sessão.
 *
 * IMPORTANTE:
 *
 * Ela NÃO envia respostas HTTP.
 *
 * Isso permite que:
 *
 * - APIs respondam JSON 401
 * - páginas redirecionem para /login
 *
 * sem duplicar a lógica de autenticação.
 * =========================================================
 */

async function authenticateRequest(
  req
) {
  /*
   * =======================================================
   * DEVELOPMENT MODE
   * =======================================================
   */

  if (
    !config.authEnabled
  ) {
    return {
      success:
        true,

      user:
        createDevelopmentUser()
    };
  }


  /*
   * =======================================================
   * TOKEN
   * =======================================================
   */

  const token =
    req.cookies?.[
      config.cookieName
    ];


  if (!token) {
    return {
      success:
        false,

      status:
        401,

      error:
        "Authentication required"
    };
  }


  /*
   * =======================================================
   * VERIFY JWT
   * =======================================================
   */

  let payload;

  try {
    payload =
      jwt.verify(
        token,
        config.jwtSecret
      );

  } catch (error) {
    return {
      success:
        false,

      status:
        401,

      error:
        "Invalid session"
    };
  }


  /*
   * =======================================================
   * LOAD USER
   * =======================================================
   */

  let user;

  try {
    user =
      await User.findById(
        payload.sub
      );

  } catch (error) {
    console.error(
      "[AUTH] Failed to load user:",
      error.message
    );

    return {
      success:
        false,

      status:
        401,

      error:
        "Invalid session"
    };
  }


  /*
   * =======================================================
   * USER STATUS
   * =======================================================
   */

  if (
    !user ||
    !user.active
  ) {
    return {
      success:
        false,

      status:
        401,

      error:
        "Invalid session"
    };
  }


  /*
   * =======================================================
   * SESSION VERSION
   * =======================================================
   *
   * Permite invalidar sessões antigas depois de logout,
   * alteração de segurança ou rotação de sessão.
   * =======================================================
   */

  if (
    user.sessionVersion !==
    payload.sessionVersion
  ) {
    return {
      success:
        false,

      status:
        401,

      error:
        "Session expired"
    };
  }


  /*
   * =======================================================
   * SUCCESS
   * =======================================================
   */

  return {
    success:
      true,

    user
  };
}


/*
 * =========================================================
 * REQUIRE AUTH
 * =========================================================
 *
 * Middleware utilizado pelas APIs.
 *
 * APIs continuam a receber JSON 401.
 *
 * NÃO redirecionar APIs para /login.
 * =========================================================
 */

async function requireAuth(
  req,
  res,
  next
) {
  try {
    const result =
      await authenticateRequest(
        req
      );


    if (
      !result.success
    ) {
      return res
        .status(
          result.status || 401
        )
        .json({
          success:
            false,

          error:
            result.error ||
            "Authentication required"
        });
    }


    req.user =
      result.user;


    return next();

  } catch (error) {
    console.error(
      "[AUTH]",
      error.message
    );

    return res
      .status(401)
      .json({
        success:
          false,

        error:
          "Invalid session"
      });
  }
}


/*
 * =========================================================
 * REQUIRE PAGE AUTH
 * =========================================================
 *
 * Middleware utilizado por páginas HTML protegidas.
 *
 * Quando não existe sessão:
 *
 *     /       -> /login
 *     /admin  -> /login
 *
 * Quando existe uma sessão inválida ou expirada:
 *
 *     -> /login
 *
 * As APIs NÃO utilizam este middleware.
 * =========================================================
 */

async function requirePageAuth(
  req,
  res,
  next
) {
  try {
    const result =
      await authenticateRequest(
        req
      );


    if (
      !result.success
    ) {
      /*
       * Limpa o cookie inválido/expirado.
       *
       * Isto evita que o navegador continue a enviar
       * uma sessão que já não é válida.
       */

      try {
        res.clearCookie(
          config.cookieName
        );
      } catch (error) {
        /*
         * Não interromper o redirecionamento caso
         * o clearCookie não esteja disponível.
         */
      }


      return res.redirect(
        "/login"
      );
    }


    req.user =
      result.user;


    return next();

  } catch (error) {
    console.error(
      "[PAGE AUTH]",
      error.message
    );

    try {
      res.clearCookie(
        config.cookieName
      );
    } catch (clearError) {
      /*
       * Ignorar erro de limpeza do cookie.
       */
    }

    return res.redirect(
      "/login"
    );
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
     * =====================================================
     * DEVELOPMENT MODE
     * =====================================================
     *
     * A identidade operacional possui permissões de owner.
     * =====================================================
     */

    if (
      !config.authEnabled
    ) {
      return next();
    }


    /*
     * =====================================================
     * AUTHENTICATED USER
     * =====================================================
     */

    if (
      !req.user ||
      !roles.includes(
        req.user.role
      )
    ) {
      return res
        .status(403)
        .json({
          success:
            false,

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

  requirePageAuth,

  requireRole
};
