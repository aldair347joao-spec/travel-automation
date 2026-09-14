const path =
  require("path");

const express =
  require("express");

const helmet =
  require("helmet");

const cors =
  require("cors");

const cookieParser =
  require("cookie-parser");

const morgan =
  require("morgan");

const {
  generalLimiter
} =
  require("../middleware/rate-limit");

const csrfProtection =
  require("../middleware/csrf");

const {
  notFound,
  errorHandler
} =
  require("../middleware/error");

const authRouter =
  require("./auth");

const clientsRouter =
  require("./clients");

const passportsRouter =
  require("./passports");

const createApplicationsRouter =
  require("./applications");

const createSystemRouter =
  require("./system");

const config =
  require("../config/environment");

function createApp({
  supervisor
}) {
  const app =
    express();

  app.disable(
    "x-powered-by"
  );

  app.set(
    "trust proxy",
    1
  );

  app.use(
    helmet({
      crossOriginEmbedderPolicy:
        false
    })
  );

  if (
    config.frontendUrl
  ) {
    app.use(
      cors({
        origin:
          config.frontendUrl,

        credentials:
          true,

        methods: [
          "GET",
          "POST",
          "PATCH",
          "DELETE",
          "OPTIONS"
        ],

        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-CSRF-Token",
          "Idempotency-Key"
        ]
      })
    );
  }

  app.use(
    express.json({
      limit:
        "1mb"
    })
  );

  app.use(
    express.urlencoded({
      extended:
        false,

      limit:
        "100kb"
    })
  );

  app.use(
    cookieParser()
  );

  app.use(
    morgan(
      config.isProduction
        ? "combined"
        : "dev"
    )
  );

  app.use(
    "/api",
    generalLimiter
  );

  /*
   * =========================================================
   * HEALTH
   * =========================================================
   */

  app.get(
    "/api/health",
    async (
      req,
      res
    ) => {
      return res.json({
        success:
          true,

        service:
          "travel-automation",

        mode:
          config.authEnabled
            ? "authenticated"
            : "development",

        authentication:
          config.authEnabled
            ? "enabled"
            : "disabled",

        timestamp:
          new Date().toISOString()
      });
    }
  );

  /*
   * =========================================================
   * AUTH
   * =========================================================
   */

  app.use(
    "/api/auth",
    authRouter
  );

  /*
   * =========================================================
   * CSRF
   * =========================================================
   */

  app.use(
    "/api",
    (
      req,
      res,
      next
    ) => {
      if (
        req.path.startsWith(
          "/auth/"
        )
      ) {
        return next();
      }

      return csrfProtection(
        req,
        res,
        next
      );
    }
  );

  /*
   * =========================================================
   * CLIENTS
   * =========================================================
   */

  app.use(
    "/api/clients",
    clientsRouter
  );

  /*
   * =========================================================
   * PASSPORTS
   * =========================================================
   */

  app.use(
    "/api/passports",
    passportsRouter
  );

  /*
   * =========================================================
   * APPLICATIONS
   * =========================================================
   */

  app.use(
    "/api/applications",
    createApplicationsRouter({
      supervisor
    })
  );

  /*
   * =========================================================
   * SYSTEM
   * =========================================================
   */

  app.use(
    "/api/system",
    createSystemRouter({
      supervisor
    })
  );

  /*
   * =========================================================
   * STATIC FRONTEND
   * =========================================================
   */

  const publicDirectory =
    path.join(
      __dirname,
      "../../public"
    );

  app.use(
    express.static(
      publicDirectory,
      {
        index:
          false,

        maxAge:
          config.isProduction
            ? "1h"
            : 0
      }
    )
  );

  app.get(
    "/",
    (
      req,
      res
    ) => {
      return res.sendFile(
        path.join(
          publicDirectory,
          "index.html"
        )
      );
    }
  );

  app.use(
    notFound
  );

  app.use(
    errorHandler
  );

  return app;
}

module.exports = {
  createApp
};
