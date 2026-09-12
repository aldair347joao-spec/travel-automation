const crypto =
  require("crypto");

const Application =
  require("../models/application");

const eventBus =
  require("../utils/event-bus");

const logger =
  require("../utils/logger");

class Bot2 {
  constructor({
    getAdapter,
    intervalMs = 2000
  }) {
    this.getAdapter =
      getAdapter;

    this.intervalMs =
      Math.max(
        1000,
        Number(intervalMs) || 2000
      );

    this.workerId =
      crypto.randomUUID();

    this.running = false;

    this.timer = null;

    this.inFlight =
      new Set();
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
      const adapter =
        await this.getAdapter(
          id
        );

      const now =
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
              "monitoring",
            "bot2.monitoring":
              true,
            "bot2.workerId":
              this.workerId,
            "bot2.lastCheckAt":
              now
          }
        }
      );

      const slot =
        await adapter.checkAvailability(
          application
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

      const updated =
        await Application.findOneAndUpdate(
          {
            _id:
              application._id,
            status:
              "waiting_for_slot"
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

              "metrics.slotDetectionMs":
                0
            }
          },
          {
            new: true
          }
        );

      if (!updated) {
        return;
      }

      logger.info(
        "Appointment slot detected",
        {
          applicationId: id
        }
      );

      eventBus.emit(
        "slot_found",
        {
          applicationId: id,
          slot: updated.slot,
          detectedAt
        }
      );
    } catch (error) {
      logger.error(
        "Bot2 availability check failed",
        {
          applicationId: id,
          error: error.message
        }
      );
    } finally {
      this.inFlight.delete(id);
    }
  }

  async tick() {
    if (!this.running) {
      return;
    }

    const applications =
      await Application.find({
        status:
          "waiting_for_slot",
        "bot2.monitoring": {
          $ne: false
        }
      }).limit(100);

    await Promise.all(
      applications.map(
        application =>
          this.checkApplication(
            application
          )
      )
    );
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;

    const loop = async () => {
      if (!this.running) {
        return;
      }

      try {
        await this.tick();
      } catch (error) {
        logger.error(
          "Bot2 loop error",
          {
            error:
              error.message
          }
        );
      }

      this.timer =
        setTimeout(
          loop,
          this.intervalMs
        );
    };

    loop();
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearTimeout(
        this.timer
      );

      this.timer = null;
    }
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
        this.inFlight.size
    };
  }
}

module.exports =
  Bot2;
