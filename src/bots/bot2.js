const crypto =
  require("crypto");

const Application =
  require("../models/application");

const eventBus =
  require("../utils/event-bus");

const logger =
  require("../utils/logger");

const settings = {
  intervalMs:
    Math.max(
      1000,
      Number(
        process.env.AVAILABILITY_INTERVAL_MS
      ) || 2000
    ),

  timeoutMs:
    Number(
      process.env.BOT2_TIMEOUT_MS
    ) || 10000,

  batchSize:
    Number(
      process.env.BOT2_BATCH_SIZE
    ) || 50
};

function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new Error(
                `${operation} timed out after ${timeoutMs}ms`
              )
            );
          },
          timeoutMs
        );
      }
    );

  return Promise.race([
    promise,
    timeout
  ]).finally(() => {
    clearTimeout(timer);
  });
}

class Bot2 {
  constructor({
    getAdapter,
    intervalMs =
      settings.intervalMs
  }) {
    this.getAdapter =
      getAdapter;

    this.intervalMs =
      Math.max(
        1000,
        Number(intervalMs) ||
          settings.intervalMs
      );

    this.workerId =
      crypto.randomUUID();

    this.running =
      false;

    this.timer =
      null;

    this.tickInProgress =
      false;

    this.inFlight =
      new Set();

    this.stats = {
      checks: 0,
      slotsFound: 0,
      errors: 0,
      lastTickAt: null,
      lastErrorAt: null
    };
  }

  async checkApplication(
    application
  ) {
    const id =
      application._id.toString();

    if (
      this.inFlight.has(id)
    ) {
      return;
    }

    this.inFlight.add(id);

    try {
      const claimed =
        await Application.findOneAndUpdate(
          {
            _id:
              application._id,

            status:
              "waiting_for_slot",

            "bot2.monitoring":
              true
          },
          {
            $set: {
              "bot2.status":
                "monitoring",

              "bot2.workerId":
                this.workerId,

              "bot2.lastCheckAt":
                new Date(),

              "bot2.heartbeatAt":
                new Date()
            },

            $inc: {
              "bot2.checks":
                1
            }
          },
          {
            new: true
          }
        );

      if (!claimed) {
        return;
      }

      const adapter =
        await this.getAdapter(
          id
        );

      this.stats.checks++;

      const slot =
        await withTimeout(
          adapter.checkAvailability(
            claimed
          ),
          settings.timeoutMs,
          "Availability check"
        );

      if (
        !slot ||
        !slot.date ||
        !slot.time
      ) {
        return;
      }

      const detectedAt =
        new Date();

      /*
       * Atomic transition.
       *
       * Only one worker can change
       * waiting_for_slot -> slot_received.
       */

      const updated =
        await Application.findOneAndUpdate(
          {
            _id:
              claimed._id,

            status:
              "waiting_for_slot",

            "bot2.monitoring":
              true
          },
          {
            $set: {
              slot: {
                date:
                  String(
                    slot.date
                  ),

                time:
                  String(
                    slot.time
                  )
              },

              status:
                "slot_received",

              "bot2.status":
                "slot_found",

              "bot2.monitoring":
                false,

              "bot2.workerId":
                this.workerId,

              "bot2.slotDetectedAt":
                detectedAt,

              "bot2.heartbeatAt":
                detectedAt,

              "metrics.slotDetectionMs":
                0
            },

            $unset: {
              "bot2.lastCheckAt":
                ""
            }
          },
          {
            new: true
          }
        );

      if (!updated) {
        return;
      }

      this.stats.slotsFound++;

      logger.info(
        "RADAR slot detected",
        {
          applicationId:
            id,

          workerId:
            this.workerId,

          date:
            updated.slot.date,

          time:
            updated.slot.time
        }
      );

      eventBus.emit(
        "slot_found",
        {
          applicationId:
            id,

          slot:
            updated.slot,

          detectedAt,

          workerId:
            this.workerId
        }
      );

    } catch (error) {
      this.stats.errors++;

      this.stats.lastErrorAt =
        new Date();

      await Application.updateOne(
        {
          _id:
            application._id,

          status:
            "waiting_for_slot"
        },
        {
          $set: {
            "bot2.status":
              "error",

            "bot2.workerId":
              this.workerId,

            "bot2.heartbeatAt":
              new Date()
          },

          $inc: {
            "bot2.errors":
              1
          }
        }
      );

      logger.error(
        "RADAR availability check failed",
        {
          applicationId:
            id,

          workerId:
            this.workerId,

          error:
            error.message
        }
      );

    } finally {
      this.inFlight.delete(
        id
      );
    }
  }

  async tick() {
    if (
      !this.running ||
      this.tickInProgress
    ) {
      return;
    }

    this.tickInProgress =
      true;

    this.stats.lastTickAt =
      new Date();

    try {
      const applications =
        await Application.find({
          status:
            "waiting_for_slot",

          "bot2.monitoring":
            true
        })
          .sort({
            "bot2.lastCheckAt":
              1
          })
          .limit(
            settings.batchSize
          );

      await Promise.all(
        applications.map(
          application =>
            this.checkApplication(
              application
            )
        )
      );

    } catch (error) {
      this.stats.errors++;

      logger.error(
        "RADAR tick failed",
        {
          workerId:
            this.workerId,

          error:
            error.message
        }
      );

    } finally {
      this.tickInProgress =
        false;
    }
  }

  start() {
    if (
      this.running
    ) {
      return;
    }

    this.running =
      true;

    logger.info(
      "RADAR started",
      {
        workerId:
          this.workerId,

        intervalMs:
          this.intervalMs
      }
    );

    const loop =
      async () => {
        if (
          !this.running
        ) {
          return;
        }

        try {
          await this.tick();
        } catch (error) {
          logger.error(
            "RADAR loop error",
            {
              workerId:
                this.workerId,

              error:
                error.message
            }
          );
        }

        if (
          this.running
        ) {
          this.timer =
            setTimeout(
              loop,
              this.intervalMs
            );
        }
      };

    loop();
  }

  stop() {
    this.running =
      false;

    if (
      this.timer
    ) {
      clearTimeout(
        this.timer
      );

      this.timer =
        null;
    }

    logger.info(
      "RADAR stopped",
      {
        workerId:
          this.workerId
      }
    );
  }

  status() {
    return {
      running:
        this.running,

      workerId:
        this.workerId,

      intervalMs:
        this.intervalMs,

      inFlight:
        this.inFlight.size,

      tickInProgress:
        this.tickInProgress,

      stats:
        this.stats
    };
  }
}

module.exports =
  Bot2;
