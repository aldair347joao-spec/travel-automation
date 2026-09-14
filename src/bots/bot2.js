const crypto =
  require("crypto");

const Application =
  require("../models/application");

const eventBus =
  require("../utils/event-bus");

const logger =
  require("../utils/logger");

const MIN_INTERVAL =
  Math.max(
    3000,
    Number(
      process.env.RADAR_MIN_INTERVAL_MS
    ) || 5000
  );

const MAX_INTERVAL =
  Math.max(
    MIN_INTERVAL,
    Number(
      process.env.RADAR_MAX_INTERVAL_MS
    ) || 30000
  );

const ERROR_COOLDOWN =
  Math.max(
    10000,
    Number(
      process.env.RADAR_ERROR_COOLDOWN_MS
    ) || 30000
  );

const TIMEOUT =
  Math.max(
    3000,
    Number(
      process.env.BOT2_TIMEOUT_MS
    ) || 10000
  );

const BATCH_SIZE =
  Math.max(
    1,
    Number(
      process.env.BOT2_BATCH_SIZE
    ) || 20
  );

function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
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

function normalizeAvailability(
  availability
) {
  if (!availability) {
    return [];
  }

  if (
    Array.isArray(
      availability
    )
  ) {
    return availability;
  }

  if (
    Array.isArray(
      availability.slots
    )
  ) {
    return availability.slots;
  }

  if (
    Array.isArray(
      availability.dates
    )
  ) {
    return availability.dates;
  }

  return [];
}

function slotKey(slot) {
  return [
    slot.date || "",
    slot.time || "",
    slot.id || ""
  ].join("|");
}

function hashAvailability(
  availability
) {
  const normalized =
    normalizeAvailability(
      availability
    )
      .map(slot => ({
        date:
          String(
            slot.date || ""
          ),

        time:
          String(
            slot.time || ""
          ),

        id:
          String(
            slot.id || ""
          ),

        available:
          slot.available !== false
      }))
      .sort(
        (a, b) =>
          JSON.stringify(a)
            .localeCompare(
              JSON.stringify(b)
            )
      );

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        normalized
      )
    )
    .digest("hex");
}

function matchesPreferences(
  slot,
  application
) {
  if (
    !slot ||
    !slot.date
  ) {
    return false;
  }

  const date =
    new Date(
      `${slot.date}T00:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return false;
  }

  const {
    start,
    end
  } =
    application.preferredDates ||
    {};

  if (
    start &&
    slot.date < start
  ) {
    return false;
  }

  if (
    end &&
    slot.date > end
  ) {
    return false;
  }

  const weekdays =
    Array.isArray(
      application.preferredWeekdays
    )
      ? application.preferredWeekdays
      : [];

  if (
    weekdays.length &&
    !weekdays.includes(
      date.getDay()
    )
  ) {
    return false;
  }

  if (
    application.preferredTime &&
    slot.time
  ) {
    const preferred =
      String(
        application.preferredTime
      );

    /*
     * Aceitamos tanto igualdade
     * direta como prefixos de
     * janela configurada.
     */
    if (
      !String(
        slot.time
      ).startsWith(
        preferred
      )
    ) {
      return false;
    }
  }

  return (
    slot.available !== false
  );
}

function findCompatibleGroupSlots(
  availability,
  application
) {
  const slots =
    normalizeAvailability(
      availability
    ).filter(slot =>
      matchesPreferences(
        slot,
        application
      )
    );

  if (!slots.length) {
    return null;
  }

  const required =
    Math.max(
      1,
      Number(
        application.applicantsCount
      ) || 1
    );

  const mode =
    application.bookingMode ||
    "SINGLE";

  if (
    required === 1 ||
    mode === "SINGLE"
  ) {
    const first =
      slots[0];

    return {
      date:
        String(first.date),

      time:
        String(first.time || ""),

      applicants: [
        {
          client:
            application
              .applicants?.[0]
              ?.client ||
            application.client,

          date:
            String(first.date),

          time:
            String(
              first.time || ""
            )
        }
      ]
    };
  }

  /*
   * Para GROUP_REQUIRED,
   * precisamos encontrar quantidade
   * suficiente de vagas.
   *
   * A API do adapter pode devolver
   * capacity/remaining quando o site
   * disponibilizar essa informação.
   */
  const groups =
    new Map();

  for (
    const slot of slots
  ) {
    const key =
      `${slot.date}|${slot.time || ""}`;

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(slot);
  }

  for (
    const [key, group]
    of groups
  ) {
    const capacity =
      Number(
        group[0]?.capacity
      ) || group.length;

    if (
      capacity <
      required
    ) {
      continue;
    }

    const [
      date,
      time
    ] =
      key.split("|");

    const applicants =
      application
        .applicants
        .slice(
          0,
          required
        )
        .map(
          (applicant) => ({
            client:
              applicant.client,

            date,

            time
          })
        );

    return {
      date,
      time,
      applicants
    };
  }

  return null;
}

function calculateNextInterval(
  current,
  result
) {
  if (
    result === "slot"
  ) {
    return MIN_INTERVAL;
  }

  if (
    result === "change"
  ) {
    return Math.max(
      MIN_INTERVAL,
      Math.floor(
        current * 0.7
      )
    );
  }

  if (
    result === "empty"
  ) {
    return Math.min(
      MAX_INTERVAL,
      Math.floor(
        current * 1.2
      )
    );
  }

  if (
    result === "error"
  ) {
    return Math.min(
      MAX_INTERVAL,
      Math.max(
        ERROR_COOLDOWN,
        current * 2
      )
    );
  }

  return current;
}

class Bot2 {
  constructor({
    getAdapter
  }) {
    this.getAdapter =
      getAdapter;

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
      changes: 0,
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
              true,

            $or: [
              {
                "radar.nextCheckAt":
                  null
              },
              {
                "radar.nextCheckAt":
                  {
                    $lte:
                      new Date()
                  }
              }
            ]
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

      const availability =
        await withTimeout(
          adapter.checkAvailability(
            claimed
          ),
          TIMEOUT,
          "Availability check"
        );

      const hash =
        hashAvailability(
          availability
        );

      const previousHash =
        claimed.radar
          ?.lastAvailabilityHash ||
        null;

      const compatibleSlot =
        findCompatibleGroupSlots(
          availability,
          claimed
        );

      const now =
        new Date();

      if (
        compatibleSlot
      ) {
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
                slot:
                  compatibleSlot,

                status:
                  "slot_received",

                "bot2.status":
                  "slot_found",

                "bot2.monitoring":
                  false,

                "bot2.workerId":
                  this.workerId,

                "bot2.slotDetectedAt":
                  now,

                "radar.enabled":
                  false,

                "radar.lastAvailabilityHash":
                  hash,

                "radar.lastChangeAt":
                  now,

                "radar.lastSuccessfulCheckAt":
                  now,

                "radar.currentIntervalMs":
                  MIN_INTERVAL,

                "radar.consecutiveErrors":
                  0,

                "radar.consecutiveEmptyChecks":
                  0,

                "radar.riskLevel":
                  "normal",

                "radar.nextCheckAt":
                  null
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
          "RADAR compatible slot detected",
          {
            applicationId:
              id,

            groupId:
              updated.groupId,

            applicants:
              updated.applicantsCount,

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

            detectedAt:
              now,

            workerId:
              this.workerId
          }
        );

        return;
      }

      const changed =
        Boolean(
          previousHash &&
          previousHash !==
            hash
        );

      if (changed) {
        this.stats.changes++;
      }

      const currentInterval =
        Number(
          claimed.radar
            ?.currentIntervalMs
        ) ||
        MIN_INTERVAL;

      const nextInterval =
        calculateNextInterval(
          currentInterval,
          changed
            ? "change"
            : "empty"
        );

      await Application.updateOne(
        {
          _id:
            claimed._id,

          status:
            "waiting_for_slot"
        },
        {
          $set: {
            "radar.lastAvailabilityHash":
              hash,

            "radar.lastSuccessfulCheckAt":
              now,

            "radar.currentIntervalMs":
              nextInterval,

            "radar.nextCheckAt":
              new Date(
                Date.now() +
                nextInterval
              ),

            "radar.riskLevel":
              "normal",

            "radar.consecutiveErrors":
              0
          },

          $inc: {
            "radar.consecutiveEmptyChecks":
              changed
                ? 0
                : 1
          }
        }
      );

    } catch (error) {
      this.stats.errors++;

      this.stats.lastErrorAt =
        new Date();

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
              "cooldown",

            "bot2.workerId":
              this.workerId,

            "bot2.heartbeatAt":
              now,

            "radar.riskLevel":
              "elevated",

            "radar.nextCheckAt":
              new Date(
                Date.now() +
                ERROR_COOLDOWN
              )
          },

          $inc: {
            "bot2.errors":
              1,

            "radar.consecutiveErrors":
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
      this.inFlight.delete(id);
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
            true,

          "radar.enabled":
            true,

          $or: [
            {
              "radar.nextCheckAt":
                null
            },
            {
              "radar.nextCheckAt":
                {
                  $lte:
                    new Date()
                }
            }
          ]
        })
          .sort({
            "radar.nextCheckAt":
              1
          })
          .limit(
            BATCH_SIZE
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

        minInterval:
          MIN_INTERVAL,

        maxInterval:
          MAX_INTERVAL
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
              MIN_INTERVAL
            );
        }
      };

    loop();
  }

  stop() {
    this.running =
      false;

    if (this.timer) {
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
