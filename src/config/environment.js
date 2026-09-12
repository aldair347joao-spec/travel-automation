const requiredInProduction = [
  "MONGODB_URI",
  "JWT_SECRET",
  "DATA_ENCRYPTION_KEY"
];

function loadEnvironment() {
  const isProduction =
    process.env.NODE_ENV ===
    "production";

  if (isProduction) {
    const missing =
      requiredInProduction.filter(
        key =>
          !process.env[key]
      );

    if (missing.length) {
      throw new Error(
        `Missing production environment variables: ${missing.join(", ")}`
      );
    }

    if (
      process.env.JWT_SECRET.length <
      32
    ) {
      throw new Error(
        "JWT_SECRET must contain at least 32 characters"
      );
    }

    if (
      process.env.DATA_ENCRYPTION_KEY.length <
      32
    ) {
      throw new Error(
        "DATA_ENCRYPTION_KEY must contain at least 32 characters"
      );
    }
  }

  return {
    nodeEnv:
      process.env.NODE_ENV ||
      "development",

    port:
      Number(
        process.env.PORT
      ) || 10000,

    mongoUri:
      process.env.MONGODB_URI,

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

    frontendUrl:
      process.env.FRONTEND_URL ||
      "",

    appName:
      process.env.APP_NAME ||
      "Travel Automation"
  };
}

module.exports = loadEnvironment();
