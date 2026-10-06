require("dotenv").config();

const {
  spawn
} = require("child_process");
const prepareFaceModels =
  require("./scripts/prepare-face-models");

try {
  prepareFaceModels();
} catch (error) {
  console.error(
    "[FACE API] Falha ao preparar o motor facial local:"
  );

  console.error(
    error?.message ||
    String(error)
  );

  process.exit(1);
}

const {
  connectDatabase
} = require("./src/config/database");

const config =
  require("./src/config/environment");

const {
  createApp
} = require("./src/api/server");

const Supervisor =
  require("./src/bots/supervisor");

const {
  createSiteAdapter
} = require("./src/services/site/site-factory");

const logger =
  require("./src/utils/logger");

async function main() {
  await connectDatabase();

  const supervisor =
    new Supervisor({
      siteFactory:
        createSiteAdapter,

      intervalMs:
        Number(
          process.env.AVAILABILITY_INTERVAL_MS
        ) || 2000
    });

  const app =
    createApp({
      supervisor
    });
     /*
   * =========================================================
   * TEMPORARY SCRAPELESS VFS LOGIN TEST
   * =========================================================
   *
   * Uso temporário:
   *
   * GET /api/debug/scrapeless-vfs-login?token=...
   *
   * O teste roda em processo separado para não bloquear
   * a requisição HTTP.
   *
   * REMOVER DEPOIS DO TESTE.
   * =========================================================
   */

  let scrapelessVfsTestProcess =
    null;

  app.get(
    "/api/debug/scrapeless-vfs-login",
    (
      req,
      res
    ) => {
      const expectedToken =
        String(
          process.env.SCRAPELESS_TEST_TOKEN ||
          ""
        ).trim();

      const receivedToken =
        String(
          req.query?.token ||
          ""
        ).trim();

      if (
        !expectedToken ||
        !receivedToken ||
        receivedToken !== expectedToken
      ) {
        return res
          .status(404)
          .json({
            success:
              false
          });
      }

      if (
        scrapelessVfsTestProcess &&
        !scrapelessVfsTestProcess.killed
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "O teste Scrapeless já está em execução.",

            pid:
              scrapelessVfsTestProcess.pid
          });
      }

      logger.info(
        "SCRAPELESS VFS LOGIN TEST STARTING FROM HTTP"
      );

      scrapelessVfsTestProcess =
        spawn(
          process.execPath,
          [
            "scripts/test-scrapeless-vfs-login.js"
          ],
          {
            env:
              process.env,

            stdio:
              "inherit",

            detached:
              false
          }
        );

      scrapelessVfsTestProcess.on(
        "exit",
        (
          code,
          signal
        ) => {
          logger.info(
            "SCRAPELESS VFS LOGIN TEST FINISHED",
            {
              code,
              signal
            }
          );

          scrapelessVfsTestProcess =
            null;
        }
      );

      scrapelessVfsTestProcess.on(
        "error",
        error => {
          logger.error(
            "SCRAPELESS VFS LOGIN TEST PROCESS ERROR",
            {
              error:
                error?.message ||
                String(error)
            }
          );

          scrapelessVfsTestProcess =
            null;
        }
      );

      return res
        .status(202)
        .json({
          success:
            true,

          status:
            "STARTED",

          pid:
            scrapelessVfsTestProcess.pid,

          message:
            "Teste de login VFS iniciado. Veja os logs do Render."
        });
    }
  );

  app.get(
    "/api/debug/scrapeless-vfs-login/status",
    (
      req,
      res
    ) => {
      const expectedToken =
        String(
          process.env.SCRAPELESS_TEST_TOKEN ||
          ""
        ).trim();

      const receivedToken =
        String(
          req.query?.token ||
          ""
        ).trim();

      if (
        !expectedToken ||
        !receivedToken ||
        receivedToken !== expectedToken
      ) {
        return res
          .status(404)
          .json({
            success:
              false
          });
      }

      const running =
        Boolean(
          scrapelessVfsTestProcess &&
          !scrapelessVfsTestProcess.killed
        );

      return res.json({
        success:
          true,

        running,

        pid:
          running
            ? scrapelessVfsTestProcess.pid
            : null
      });
    }
  );
  const server =
    app.listen(
      config.port,
      "0.0.0.0",
      () => {
        logger.info(
          "Travel Automation server started",
          {
            port:
              config.port,
            environment:
              config.nodeEnv
          }
        );
      }
    );
  if (
    process.env.SCRAPELESS_VFS_TEST ===
    "true"
  ) {
    logger.info(
      "SCRAPELESS VFS TEST STARTING"
    );

    const testProcess =
      spawn(
        process.execPath,
        [
          "scripts/test-scrapeless-vfs.js"
        ],
        {
          env:
            process.env,
          stdio:
            "inherit"
        }
      );

    testProcess.on(
      "exit",
      code => {
        logger.info(
          "SCRAPELESS VFS TEST FINISHED",
          {
            code
          }
        );
      }
    );

    testProcess.on(
      "error",
      error => {
        logger.error(
          "SCRAPELESS VFS TEST PROCESS ERROR",
          {
            error:
              error?.message ||
              String(error)
          }
        );
      }
    );
  }
  const role =
    (
      process.env.PROCESS_ROLE ||
      "all"
    ).toLowerCase();

  if (
    role === "all" ||
    role === "worker"
  ) {
    supervisor.start();
  }

  async function shutdown(
    signal
  ) {
    logger.info(
      "Shutdown requested",
      {
        signal
      }
    );

    supervisor.stop();

    await new Promise(
      resolve =>
        server.close(resolve)
    );

    process.exit(0);
  }

  process.once(
    "SIGTERM",
    () =>
      shutdown("SIGTERM")
  );

  process.once(
    "SIGINT",
    () =>
      shutdown("SIGINT")
  );
}

main().catch(error => {
  logger.error(
    "Fatal startup error",
    {
      error:
        error.message
    }
  );

  process.exit(1);
});
