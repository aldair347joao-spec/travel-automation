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
requireRole
} =
require("../middleware/auth");

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
* O login, logout, bootstrap e /me ficam fora da proteção
* CSRF abaixo porque o próprio módulo de autenticação trata
* estes fluxos.
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

app.use(
"/api/admin",
createAdminRouter()
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

    return res.status(502).json({
      success:
        false,

      error:
        "Não foi possível carregar o modelo facial no servidor."
    });
  }
}

);

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
* 
* A página de login é pública.
* 
* O próprio login.js verifica se já existe uma sessão e
* encaminha o utilizador para o espaço correspondente.
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
* 
* A página administrativa continua protegida no servidor.
* 
* Nenhum client consegue entrar no painel apenas por
* conhecer a URL /admin.
* =========================================================
  */

app.get(
"/admin",
requireAuth,
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
requireAuth,
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
* 
* Mantemos os ficheiros estáticos públicos para permitir
* que /login carregue login.js e style.css.
* 
* A entrada "/" abaixo continua protegida separadamente.
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
* A aplicação principal agora exige autenticação.
* 
* CLIENT
* -> entra no processo de viagem
* 
* OWNER / ADMIN / OPERATOR / VIEWER
* -> são encaminhados para o painel administrativo
* 
* Desta forma, a autenticação não fica apenas no backend
* das APIs: a própria entrada da aplicação também respeita
* a sessão do utilizador.
* =========================================================
  */

app.get(
"/",
requireAuth,
(
req,
res
) => {
const role =
req.user?.role;

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

  return res.status(403).send(
    "Perfil de acesso inválido."
  );
}

);

/*

* =========================================================
* 404 / ERROR HANDLING
* =========================================================
  */

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
