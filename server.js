require("dotenv").config();

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
