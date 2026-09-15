const requiredInProduction = [
  "MONGODB_URI",
  "JWT_SECRET",
  "DATA_ENCRYPTION_KEY"
];

function loadEnvironment() {
  const isProduction =
    process.env.NODE_ENV === "production";

  /*
   * =========================================================
   * AUTHENTICATION
   * =========================================================
   *
   * A aplicação pública atualmente não necessita
   * de login para entrar.
   *
   * Para voltar a ativar autenticação:
   *
   * AUTH_ENABLED=true
   *
   * Por defeito:
   *
   * AUTH_ENABLED=false
   */
  const authEnabled =
    String(
      process.env.AUTH_ENABLED || "false"
    ).toLowerCase() !== "false";

  /*
   * =========================================================
   * PRODUCTION VALIDATION
   * =========================================================
   */

  if (isProduction) {
    const missing =
      requiredInProduction.filter(
        key => !process.env[key]
      );

    if (missing.length) {
      throw new Error(
        `Missing production environment variables: ${missing.join(", ")}`
      );
    }

    if (
      process.env.JWT_SECRET.length < 32
    ) {
      throw new Error(
        "JWT_SECRET must contain at least 32 characters"
      );
    }

    if (
      process.env.DATA_ENCRYPTION_KEY.length < 32
    ) {
      throw new Error(
        "DATA_ENCRYPTION_KEY must contain at least 32 characters"
      );
    }
  }

  return {
    /*
     * =======================================================
     * APPLICATION
     * =======================================================
     */

    nodeEnv:
      process.env.NODE_ENV ||
      "development",

    isProduction,

    authEnabled,

    port:
      Number(process.env.PORT) ||
      10000,

    /*
     * =======================================================
     * DATABASE
     * =======================================================
     */

    mongoUri:
      process.env.MONGODB_URI,

    /*
     * =======================================================
     * AUTH / SESSION
     * =======================================================
     */

    jwtSecret:
      process.env.JWT_SECRET,

    jwtExpiresIn:
      process.env.JWT_EXPIRES_IN ||
      "15m",

    cookieName:
      process.env.COOKIE_NAME ||
      "travel_session",

    cookieSecure:
      process.env.COOKIE_SECURE !==
      "false",

    /*
     * =======================================================
     * FRONTEND
     * =======================================================
     */

    frontendUrl:
      process.env.FRONTEND_URL ||
      "",

    /*
     * =======================================================
     * APPLICATION IDENTITY
     * =======================================================
     */

    appName:
      process.env.APP_NAME ||
      "Travel Automation",

    /*
     * =======================================================
     * DEVELOPMENT / NO-LOGIN IDENTITY
     * =======================================================
     *
     * Esta identidade é utilizada quando
     * AUTH_ENABLED=false.
     */

    developmentAccountId:
      process.env.DEVELOPMENT_ACCOUNT_ID ||
      "travel-automation-public",

    developmentUserName:
      process.env.DEVELOPMENT_USER_NAME ||
      "Travel Automation",

    developmentUserEmail:
      process.env.DEVELOPMENT_USER_EMAIL ||
      "system@travel-automation.local"
  };
}

module.exports =
  loadEnvironment();
