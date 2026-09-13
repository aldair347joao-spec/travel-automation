const Application =
  require("../models/application");

const Bot1 =
  require("./bot1");

const Bot2 =
  require("./bot2");

const eventBus =
  require("../utils/event-bus");

const TelegramService =
  require("../services/telegram/telegram-service");

const logger =
  require("../utils/logger");

const crypto =
  require("crypto");

class Supervisor {
  constructor({
    siteFactory,
    intervalMs = 2000
  }) {
    this.siteFactory =
      siteFactory;

    this.telegram =
      new TelegramService();

    this.adapters =
      new Map();

    this.bot1 =
      new Map();

    this.bot2 =
      new Bot2({
        getAdapter:
          applicationId =>
            this.getAdapter(
              applicationId
            ),

        intervalMs
      });

    this.started =
      false;

    this.workerId =
      crypto.randomUUID();

    this.stats = {
      slotEvents:
        0,

      completed:
        0,

      recovered:
        0,

      errors:
        0,

      startedAt:
        null
    };

    this.onSlotFound =
      this.onSlotFound.bind(
        this
      );
  }

  async getAdapter(
    applicationId
  ) {
    if (
      this.adapters.has(
        applicationId
      )
    ) {
      return this.adapters.get(
        applicationId
      );
    }

    const adapter =
      this.siteFactory(
        applicationId
      );

    await adapter.initialize();

    this.adapters.set(
      applicationId,
      adapter
    );

    return adapter;
  }

  async getBot1(
    applicationId
  ) {
    if (
      this.bot1.has(
        applicationId
      )
    ) {
      return this.bot1.get(
        applicationId
      );
    }

    const adapter =
      await this.getAdapter(
        applicationId
      );

    const bot =
      new Bot1(
        adapter
      );

    this.bot1.set(
      applicationId,
      bot
    );

    return bot;
  }

  async prepare(
    applicationId
  ) {
    const bot =
      await this.getBot1(
        applicationId
      );

    return bot.prepare(
      applicationId
    );
  }

  async continueAfterVerification(
    applicationId
  ) {
    const bot =
      await this.getBot1(
        applicationId
      );

    return bot.continueAfterVerification(
      applicationId
    );
  }

  async onSlotFound(
    payload
  ) {
    const {
      applicationId,
      detectedAt
    } = payload;

    this.stats.slotEvents++;

    try {
      /*
       * Fetch current state before
       * allowing Bot 1 to continue.
       */

      const application =
        await Application.findById(
          applicationId
        ).populate(
          "client"
        );

      if (!application) {
        logger.warn(
          "ORCHESTRATOR received slot for missing application",
          {
            applicationId
          }
        );

        return;
      }

      if (
        application.status !==
        "slot_received"
      ) {
        logger.info(
          "ORCHESTRATOR ignored duplicate slot event",
          {
            applicationId,

            status:
              application.status
          }
        );

        return;
      }

      const bot =
        await this.getBot1(
          applicationId
        );

      const result =
        await bot.handleSlot(
          applicationId,
          detectedAt
        );

      if (
        !result.success
      ) {
        return;
      }

      this.stats.completed++;

      try {
        await this.telegram.completed(
          result.application,
          result.application.client
        );
      } catch (
        telegramError
      ) {
        logger.error(
          "Telegram completion notification failed",
          {
            applicationId,

            error:
              telegramError.message
          }
        );
      }

      await this.closeAdapter(
        applicationId
      );

    } catch (error) {
      this.stats.errors++;

      logger.error(
        "ORCHESTRATOR slot handler failed",
        {
          applicationId,

          error:
            error.message
        }
      );

      try {
        const application =
          await Application.findById(
            applicationId
          );

        if (application) {
          await this.telegram.error(
            application,
            error.message
          );
        }
      } catch {
        /*
         * Notification failure must
         * never kill the orchestrator.
         */
      }
    }
  }

  async recoverSlots() {
    const applications =
      await Application.find({
        status:
          "slot_received"
      })
        .sort({
          updatedAt:
            1
        })
        .limit(100);

    for (
      const application
      of applications
    ) {
      this.stats.recovered++;

      logger.info(
        "ORCHESTRATOR recovering slot",
        {
          applicationId:
            application._id.toString(),

          slot:
            application.slot
        }
      );

      eventBus.emit(
        "slot_found",
        {
          applicationId:
            application._id.toString(),

          slot:
            application.slot,

          detectedAt:
            application.bot2
              ?.slotDetectedAt ||
            new Date()
        }
      );
    }
  }

  async recoverStaleLocks() {
    const staleBefore =
      new Date();

    const result =
      await Application.updateMany(
        {
          "lock.owner":
            {
              $ne: null
            },

          "lock.expiresAt":
            {
              $lt: staleBefore
            },

          status: {
            $nin: [
              "completed",
              "cancelled"
            ]
          }
        },
        {
          $set: {
            "lock.owner":
              null,

            "lock.expiresAt":
              null
          }
        }
      );

    if (
      result.modifiedCount
    ) {
      logger.warn(
        "ORCHESTRATOR released stale locks",
        {
          count:
            result.modifiedCount
        }
      );
    }
  }

  async recoverWaitingApplications() {
    /*
     * After a Render restart, an application
     * can remain in waiting_for_slot while
     * Bot 2 is no longer marked as monitoring.
     *
     * We reactivate monitoring.
     */

    const result =
      await Application.updateMany(
        {
          status:
            "waiting_for_slot",

          "bot2.monitoring":
            {
              $ne: true
            }
        },
        {
          $set: {
            "bot2.monitoring":
              true,

            "bot2.status":
              "monitoring",

            "bot2.workerId":
              null
          }
        }
      );

    if (
      result.modifiedCount
    ) {
      logger.info(
        "ORCHESTRATOR restored waiting applications",
        {
          count:
            result.modifiedCount
        }
      );
    }
  }

  async recover() {
    await this.recoverStaleLocks();

    await this.recoverWaitingApplications();

    await this.recoverSlots();
  }

  async closeAdapter(
    applicationId
  ) {
    const adapter =
      this.adapters.get(
        applicationId
      );

    if (!adapter) {
      return;
    }

    try {
      await adapter.close();
    } catch (
      error
    ) {
      logger.warn(
        "Site adapter close failed",
        {
          applicationId,

          error:
            error.message
        }
      );
    }

    this.adapters.delete(
      applicationId
    );

    this.bot1.delete(
      applicationId
    );
  }

  start() {
    if (
      this.started
    ) {
      return;
    }

    this.started =
      true;

    this.stats.startedAt =
      new Date();

    eventBus.on(
      "slot_found",
      this.onSlotFound
    );

    this.bot2.start();

    /*
     * Recovery happens immediately
     * after startup.
     */

    this.recover()
      .catch(error => {
        this.stats.errors++;

        logger.error(
          "ORCHESTRATOR recovery failed",
          {
            error:
              error.message
          }
        );
      });

    logger.info(
      "ORCHESTRATOR started",
      {
        workerId:
          this.workerId
      }
    );
  }

  stop() {
    this.started =
      false;

    eventBus.off(
      "slot_found",
      this.onSlotFound
    );

    this.bot2.stop();

    for (
      const applicationId
      of this.adapters.keys()
    ) {
      this.closeAdapter(
        applicationId
      );
    }

    logger.info(
      "ORCHESTRATOR stopped",
      {
        workerId:
          this.workerId
      }
    );
  }

  status() {
    return {
      started:
        this.started,

      workerId:
        this.workerId,

      activeAdapters:
        this.adapters.size,

      activeBot1:
        this.bot1.size,

      bot2:
        this.bot2.status(),

      stats:
        this.stats
    };
  }
}

module.exports =
  Supervisor;
