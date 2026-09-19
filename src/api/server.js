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
const createAdminRouter =
  require("./admin");

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
   * ADMINISTRATION
   * =========================================================
   */

  app.use(
    "/api/admin",
    createAdminRouter()
  );
    /*
   * =========================================================
   * MEDIA PIPE FACE LANDMARKER MODEL
   * =========================================================
   *
   * O navegador não busca o modelo diretamente no Google
   * Storage.
   *
   * O servidor faz o download do modelo e entrega-o pelo
   * próprio domínio da aplicação.
   *
   * Isso evita problemas de CORS, rede, bloqueios do
   * navegador e diferenças entre dispositivos móveis.
   *
   * O modelo é mantido em memória depois do primeiro
   * carregamento para evitar downloads repetidos.
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
        /*
         * ---------------------------------------------------
         * CACHE EM MEMÓRIA
         * ---------------------------------------------------
         */

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

        /*
         * ---------------------------------------------------
         * EVITAR DOWNLOAD DUPLICADO
         * ---------------------------------------------------
         */

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

                /*
                 * O modelo Face Landmarker
                 * normalmente possui vários MB.
                 *
                 * Uma resposta extremamente pequena
                 * indica que recebemos algo inválido.
                 */

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

        return res.status(502).json({
          success: false,

          error:
            "Não foi possível carregar o modelo facial no servidor."
        });
      }
    }
  );
  /*
   * =========================================================
   * STATIC FRONTEND
   * =========================================================
   */
  /*
   * =========================================================
   * MEDIA PIPE LOCAL
   * =========================================================
   *
   * O pacote é instalado pelo npm durante o deploy.
   *
   * Expomos apenas os ficheiros públicos necessários
   * para o navegador executar o Face Landmarker.
   *
   * Não expomos a aplicação Node nem outros ficheiros
   * do node_modules.
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
        index: false,

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
