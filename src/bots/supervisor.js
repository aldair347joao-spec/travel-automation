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

    this.started = false;

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
      new Bot1(adapter);

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

    try {
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
        result.success &&
        result.application
      ) {
        await this.telegram.completed(
          result.application,
          result.application.client
        );

        await this.closeAdapter(
          applicationId
        );
      }
    } catch (error) {
      logger.error(
        "Supervisor slot handler failed",
        {
          applicationId,
          error:
            error.message
        }
      );

      try {
        await this.telegram.error(
          await Application.findById(
            applicationId
          ),
          error.message
        );
      } catch {
        // Do not allow Telegram failure
        // to break the worker.
      }
    }
  }

  async recoverSlots() {
    const applications =
      await Application.find({
        status:
          "slot_received"
      }).limit(50);

    for (
      const application
      of applications
    ) {
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
    } catch {
      // Ignore adapter shutdown errors.
    }

    this.adapters.delete(
      applicationId
    );

    this.bot1.delete(
      applicationId
    );
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;

    eventBus.on(
      "slot_found",
      this.onSlotFound
    );

    this.bot2.start();

    this.recoverSlots();

    logger.info(
      "Automation supervisor started"
    );
  }

  stop() {
    this.started = false;

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
      "Automation supervisor stopped"
    );
  }

  status() {
    return {
      started:
        this.started,
      activeAdapters:
        this.adapters.size,
      activeBot1:
        this.bot1.size,
      bot2:
        this.bot2.status()
    };
  }
}

module.exports =
  Supervisor;
