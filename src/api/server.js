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

const {
  requireAuth,
  requirePageAuth,
  requireRole
} =
  require("../middleware/auth");

const authRouter =
  require("./auth");

const accessRequestsRouter =
  require("./access-requests");

const adminAccessRequestsRouter =
  require("./admin-access-requests");

const clientsRouter =
  require("./clients");

const passportsRouter =
  require("./passports");

const createApplicationsRouter =
  require("./applications");

const createAdminRouter =
  require("./admin");

const createSystemRouter =
  require("./system");

const config =
  require("../config/environment");

const logger =
  require("../utils/logger");


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


  /*
   * =========================================================
   * SECURITY HEADERS
   * =========================================================
   */

  app.use(
    helmet({
      crossOriginEmbedderPolicy:
        false
    })
  );


  /*
   * =========================================================
   * CORS
   * =========================================================
   */

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


  /*
   * =========================================================
   * BODY PARSERS
   * =========================================================
   */

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


  /*
   * =========================================================
   * COOKIES
   * =========================================================
   */

  app.use(
    cookieParser()
  );


  /*
   * =========================================================
   * LOGGING
   * =========================================================
   */

  app.use(
    morgan(
      config.isProduction
        ? "combined"
        : "dev"
    )
  );


  /*
   * =========================================================
   * API RATE LIMIT
   * =========================================================
   */

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
   * AUTHENTICATION API
   * =========================================================
   *
   * Login, logout, bootstrap e /me ficam fora da proteção
   * CSRF abaixo porque o módulo de autenticação trata estes
   * fluxos.
   * =========================================================
   */

  app.use(
    "/api/auth",
    authRouter
  );


  /*
   * =========================================================
   * PUBLIC ACCESS REQUEST API
   * =========================================================
   *
   * Um colaborador que ainda não possui conta pode solicitar
   * acesso através da página de login.
   *
   * Este pedido não cria automaticamente um User.
   *
   * A criação da conta acontece somente depois da aprovação
   * no painel administrativo.
   * =========================================================
   */

  app.use(
    "/api/access-requests",
    accessRequestsRouter
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
      /*
       * Authentication API
       */

      if (
        req.path.startsWith(
          "/auth/"
        )
      ) {
        return next();
      }


      /*
       * Public access request.
       *
       * Este endpoint é utilizado antes de existir
       * uma sessão autenticada.
       */

      if (
        req.path.startsWith(
          "/access-requests"
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
   * APPLICATION APIs
   * =========================================================
   */

  app.use(
    "/api/clients",
    clientsRouter
  );


  app.use(
    "/api/passports",
    passportsRouter
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


  /*
   * =========================================================
   * ADMIN APPLICATION API
   * =========================================================
   */

  app.use(
    "/api/admin",
    createAdminRouter()
  );


  /*
   * =========================================================
   * ADMIN ACCESS REQUEST API
   * =========================================================
   *
   * Endpoints:
   *
   * GET
   * /api/admin/access-requests
   *
   * GET
   * /api/admin/access-requests/stats
   *
   * GET
   * /api/admin/access-requests/:id
   *
   * POST
   * /api/admin/access-requests/:id/approve
   *
   * POST
   * /api/admin/access-requests/:id/reject
   *
   * A autenticação e autorização são feitas dentro do
   * próprio router.
   *
   * O accountId utilizado pelo router vem sempre da sessão
   * autenticada. Nunca vem do frontend.
   * =========================================================
   */

  app.use(
    "/api/admin/access-requests",
    adminAccessRequestsRouter
  );


  /*
   * =========================================================
   * MEDIAPIPE FACE LANDMARKER
   * =========================================================
   */

  const FACE_LANDMARKER_MODEL_URL =
    "https://storage.googleapis.com/" +
    "mediapipe-models/" +
    "face_landmarker/" +
    "face_landmarker/" +
    "float16/" +
    "1/" +
    "face_landmarker.task";


  let faceLandmarkerModelCache =
    null;


  let faceLandmarkerModelPromise =
    null;


  app.get(
    "/mediapipe-model/face_landmarker.task",
    async (
      req,
      res
    ) => {
      try {

        if (
          faceLandmarkerModelCache
        ) {
          res.setHeader(
            "Content-Type",
            "application/octet-stream"
          );


          res.setHeader(
            "Content-Length",
            String(
              faceLandmarkerModelCache.length
            )
          );


          res.setHeader(
            "Cache-Control",
            "public, max-age=86400"
          );


          return res.end(
            faceLandmarkerModelCache
          );
        }


        if (
          !faceLandmarkerModelPromise
        ) {
          faceLandmarkerModelPromise =
            (async () => {

              const controller =
                new AbortController();


              const timeout =
                setTimeout(
                  () =>
                    controller.abort(),
                  60000
                );


              try {

                logger.info(
                  "Downloading MediaPipe Face Landmarker model"
                );


                const response =
                  await fetch(
                    FACE_LANDMARKER_MODEL_URL,
                    {
                      method:
                        "GET",

                      signal:
                        controller.signal
                    }
                  );


                if (
                  !response.ok
                ) {
                  throw new Error(
                    `MediaPipe model HTTP ${response.status}`
                  );
                }


                const arrayBuffer =
                  await response.arrayBuffer();


                const buffer =
                  Buffer.from(
                    arrayBuffer
                  );


                if (
                  !buffer.length
                ) {
                  throw new Error(
                    "MediaPipe model is empty"
                  );
                }


                if (
                  buffer.length <
                  100000
                ) {
                  throw new Error(
                    `MediaPipe model is unexpectedly small: ${buffer.length} bytes`
                  );
                }


                faceLandmarkerModelCache =
                  buffer;


                logger.info(
                  "MediaPipe Face Landmarker model loaded",
                  {
                    bytes:
                      buffer.length
                  }
                );


                return buffer;

              } finally {
                clearTimeout(
                  timeout
                );
              }

            })().catch(
              error => {
                faceLandmarkerModelPromise =
                  null;

                throw error;
              }
            );
        }


        const model =
          await faceLandmarkerModelPromise;


        res.setHeader(
          "Content-Type",
          "application/octet-stream"
        );


        res.setHeader(
          "Content-Length",
          String(
            model.length
          )
        );


        res.setHeader(
          "Cache-Control",
          "public, max-age=86400"
        );


        return res.end(
          model
        );

      } catch (error) {

        logger.error(
          "Failed to serve MediaPipe Face Landmarker model",
          {
            error:
              error?.message ||
              String(error)
          }
        );


        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "Não foi possível carregar o modelo facial no servidor."
          });
      }
    }
  );


  /*
   * =========================================================
   * MEDIAPIPE STATIC FILES
   * =========================================================
   */

  const mediaPipeDirectory =
    path.join(
      __dirname,
      "../../node_modules/@mediapipe/tasks-vision"
    );


  app.use(
    "/mediapipe",
    express.static(
      mediaPipeDirectory,
      {
        index:
          false,

        maxAge:
          config.isProduction
            ? "1d"
            : 0,

        setHeaders:
          (
            res,
            filePath
          ) => {

            if (
              filePath.endsWith(
                ".wasm"
              )
            ) {
              res.setHeader(
                "Content-Type",
                "application/wasm"
              );
            }


            if (
              filePath.endsWith(
                ".mjs"
              )
            ) {
              res.setHeader(
                "Content-Type",
                "text/javascript; charset=UTF-8"
              );
            }
          }
      }
    )
  );


  /*
   * =========================================================
   * PUBLIC FRONTEND DIRECTORY
   * =========================================================
   */

  const publicDirectory =
    path.join(
      __dirname,
      "../../public"
    );


  /*
   * =========================================================
   * LOGIN PAGE
   * =========================================================
   */

  app.get(
    "/login",
    (
      req,
      res
    ) => {
      return res.sendFile(
        path.join(
          publicDirectory,
          "login.html"
        )
      );
    }
  );


  app.get(
    "/login.html",
    (
      req,
      res
    ) => {
      return res.sendFile(
        path.join(
          publicDirectory,
          "login.html"
        )
      );
    }
  );


  /*
   * =========================================================
   * ADMINISTRATION PAGE
   * =========================================================
   */

  app.get(
    "/admin",
    requirePageAuth,
    requireRole(
      "owner",
      "admin",
      "operator",
      "viewer"
    ),
    (
      req,
      res
    ) => {
      return res.sendFile(
        path.join(
          publicDirectory,
          "admin.html"
        )
      );
    }
  );


  app.get(
    "/admin.html",
    requirePageAuth,
    requireRole(
      "owner",
      "admin",
      "operator",
      "viewer"
    ),
    (
      req,
      res
    ) => {
      return res.sendFile(
        path.join(
          publicDirectory,
          "admin.html"
        )
      );
    }
  );


  /*
   * =========================================================
   * STATIC FRONTEND
   * =========================================================
   */

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


  /*
   * =========================================================
   * MAIN APPLICATION
   * =========================================================
   *
   * SEM SESSÃO:
   *
   *     / -> /login
   *
   * CLIENT:
   *
   *     / -> index.html
   *
   * OWNER / ADMIN / OPERATOR / VIEWER:
   *
   *     / -> /admin
   * =========================================================
   */

  app.get(
    "/",
    requirePageAuth,
    (
      req,
      res
    ) => {

      const role =
        req.user?.role;


      /*
       * =====================================================
       * ADMINISTRATIVE ROLES
       * =====================================================
       */

      if (
        role === "owner" ||
        role === "admin" ||
        role === "operator" ||
        role === "viewer"
      ) {
        return res.redirect(
          "/admin"
        );
      }


      /*
       * =====================================================
       * CLIENT COLLABORATOR
       * =====================================================
       *
       * "client" representa o colaborador da plataforma,
       * não o viajante.
       *
       * Um colaborador pode criar vários Client/traveler
       * profiles dentro da sua account.
       *
       * Não existe aqui limitação por clientId.
       * =====================================================
       */

      if (
        role === "client"
      ) {
        return res.sendFile(
          path.join(
            publicDirectory,
            "index.html"
          )
        );
      }


      /*
       * =====================================================
       * INVALID ROLE
       * =====================================================
       */

      return res
        .status(403)
        .send(
          "Perfil de acesso inválido."
        );
    }
  );


  /*
   * =========================================================
   * 404
   * =========================================================
   */

  app.use(
    notFound
  );


  /*
   * =========================================================
   * ERROR HANDLER
   * =========================================================
   */

  app.use(
    errorHandler
  );


  return app;
}


module.exports = {
  createApp
};
