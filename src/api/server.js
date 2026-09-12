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
} = require("../middleware/rate-limit");

const csrfProtection =
  require("../middleware/csrf");

const {
  notFound,
  errorHandler
} = require("../middleware/error");

const authRouter =
  require("./auth");

const clientsRouter =
  require("./clients");

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

  if (config.frontendUrl) {
    app.use(
      cors({
        origin:
          config.frontendUrl,
        credentials: true,
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
      limit: "1mb"
    })
  );

  app.use(
    express.urlencoded({
      extended: false,
      limit: "100kb"
    })
  );

  app.use(
    cookieParser()
  );

  app.use(
    morgan(
      process.env.NODE_ENV ===
        "production"
        ? "combined"
        : "dev"
    )
  );

  app.use(
    "/api",
    generalLimiter
  );

  app.get(
    "/api/health",
    async (req, res) => {
      return res.json({
        success: true,
        service:
          "travel-automation",
        timestamp:
          new Date().toISOString()
      });
    }
  );

  app.use(
    "/api/auth",
    authRouter
  );

  /*
   * Authentication endpoints such as login/bootstrap
   * do not need CSRF because they do not rely on an
   * existing authenticated browser session.
   *
   * All application/client/system mutations below
   * require the CSRF token.
   */
  app.use(
    "/api",
    (req, res, next) => {
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

  app.use(
    "/api/clients",
    clientsRouter
  );

  app.use(
    "/api/applications",
    createApplicationsRouter({
      supervisor
    })
  );

  app.use(
    "/api/system",
    createSystemRouter({
      supervisor
    })
  );

  const publicDirectory =
    path.join(
      __dirname,
      "../../public"
    );

  app.use(
    express.static(
      publicDirectory,
      {
        index: false,
        maxAge:
          process.env.NODE_ENV ===
          "production"
            ? "1h"
            : 0
      }
    )
  );

  app.get(
    "/",
    (req, res) => {
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
