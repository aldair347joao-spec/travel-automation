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

const PaymentResumeService =
  require("../services/payment/payment-resume-service");
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

  paymentPending:
    0,

  requiresUser:
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
async verifyOtp(
applicationId,
code
) {
  const bot =
    await this.getBot1(
      applicationId
    );

  return bot.verifyOtp(
    applicationId,
    code
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
async resumeApplication(
  applicationId
) {
  const application =
    await Application.findOne({
      _id:
        applicationId,

      status:
        "requires_user"
    });

  if (!application) {
    throw new Error(
      "Application is not waiting for user resume"
    );
  }

  const adapter =
    await this.getAdapter(
      applicationId
    );

  const service =
    new PaymentResumeService({
      adapter,

      timeoutMs:
        Number(
          process.env.BOT1_TIMEOUT_MS
        ) || 30000
    });

  try {
    /*
     * O lock impede que dois pedidos
     * de resume processem o mesmo
     * pagamento simultaneamente.
     */
    const locked =
      await Application.findOneAndUpdate(
        {
          _id:
            applicationId,

          status:
            "requires_user",

          $or: [
            {
              "lock.owner":
                null
            },

            {
              "lock.expiresAt": {
                $lt:
                  new Date()
              }
            }
          ]
        },
        {
          $set: {
            status:
              "book_appointment",

            "bot1.status":
              "resuming",

            "bot1.workerId":
              this.workerId,

            "bot1.heartbeatAt":
              new Date(),

            "bot1.lastAction":
              "resuming_payment",

            "lock.owner":
              this.workerId,

            "lock.expiresAt":
              new Date(
                Date.now() +
                  (
                    Number(
                      process.env.BOT1_LOCK_MS
                    ) || 60000
                  )
              ),

            "bot2.monitoring":
              false,

            "radar.enabled":
              false
          }
        },
        {
          new:
            true
        }
      );

    if (!locked) {
      throw new Error(
        "Application is already being resumed"
      );
    }

    const result =
      await service.resume(
        locked
      );

    if (
      result.requiresUser === true
    ) {
      await Application.updateOne(
        {
          _id:
            applicationId,

          "lock.owner":
            this.workerId
        },
        {
          $set: {
            status:
              "requires_user",

            "bot1.status":
              "requires_user",

            "bot1.lastAction":
              "payment_required",

            "lock.owner":
              null,

            "lock.expiresAt":
              null
          }
        }
      );

      const updated =
        await Application.findById(
          applicationId
        );

      return {
        success:
          true,

        requiresUser:
          true,

        completed:
          false,

        reason:
          result.reason ||
          "Payment still requires user action.",

        application:
          updated,

        payment:
          result.payment ||
          null
      };
    }

    if (
      result.completed !== true
    ) {
      await Application.updateOne(
        {
          _id:
            applicationId,

          "lock.owner":
            this.workerId
        },
        {
          $set: {
            status:
              "requires_user",

            "bot1.status":
              "requires_user",

            "bot1.lastAction":
              "confirmation_not_verified",

            "lock.owner":
              null,

            "lock.expiresAt":
              null
          }
        }
      );

      const updated =
        await Application.findById(
          applicationId
        );

      return {
        success:
          true,

        requiresUser:
          true,

        completed:
          false,

        reason:
          "Booking confirmation could not be independently verified.",

        application:
          updated,

        payment:
          result.payment ||
          null
      };
    }

    /*
     * Só aqui podemos declarar
     * COMPLETED.
     */
    const completed =
      await Application.findOneAndUpdate(
        {
          _id:
            applicationId,

          "lock.owner":
            this.workerId
        },
        {
          $set: {
            status:
              "completed",

            "bot1.status":
              "completed",

            "bot1.lastAction":
              "completed",

            "bot1.completedAt":
              new Date(),

            "bot1.heartbeatAt":
              new Date(),

            "bot2.monitoring":
              false,

            "radar.enabled":
              false,

            "lock.owner":
              null,

            "lock.expiresAt":
              null
          }
        },
        {
          new:
            true
        }
      );

    if (!completed) {
      throw new Error(
        "Application completion lock was lost"
      );
    }

    this.stats.completed++;

    try {
      await this.telegram.completed(
        completed,
        completed.client
      );
    } catch (
      telegramError
    ) {
      logger.error(
        "Telegram completion notification failed after resume",
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

    return {
      success:
        true,

      completed:
        true,

      requiresUser:
        false,

      application:
        completed,

      payment:
        result.payment ||
        null,

      confirmation:
        result.confirmation ||
        null
    };
  } catch (error) {
    await Application.updateOne(
      {
        _id:
          applicationId,

        "lock.owner":
          this.workerId
      },
      {
        $set: {
          status:
            "requires_user",

          "bot1.status":
            "requires_user",

          "bot1.lastAction":
            "resume_error",

          "lock.owner":
            null,

          "lock.expiresAt":
            null
        }
      }
    );

    logger.error(
      "ORCHESTRATOR payment resume failed",
      {
        applicationId,

        error:
          error.message
      }
    );

    throw error;
  }
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
   * Fetch the current application state
   * before allowing Bot 1 to continue.
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

  /*
   * A slot event is only valid while the
   * application is waiting for the slot
   * to be processed.
   */

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

  /*
   * Bot 1 may legitimately return without
   * completing the appointment.
   */

  if (
    !result ||
    !result.success
  ) {
    logger.info(
      "ORCHESTRATOR slot processing did not complete",
      {
        applicationId,

        status:
          result?.application?.status ||
          "unknown",

        message:
          result?.message || null
      }
    );

    return;
  }

  /*
   * Always use the application returned
   * by Bot 1 when available because it
   * contains the newest persisted state.
   */

  const updatedApplication =
    result.application ||
    await Application.findById(
      applicationId
    ).populate(
      "client"
    );

  if (!updatedApplication) {
    logger.warn(
      "ORCHESTRATOR could not reload application after slot processing",
      {
        applicationId
      }
    );

    return;
  }

  /*
   * IMPORTANT:
   *
   * success !== completed.
   *
   * Bot 1 can successfully process the
   * slot and then stop at payment.
   */

  if (
    updatedApplication.status ===
    "requires_user"
  ) {
    this.stats.requiresUser++;

    const paymentPending =
      updatedApplication.result?.paymentStatus ===
      "pending";

    if (paymentPending) {
      this.stats.paymentPending++;
    }

    logger.info(
      "ORCHESTRATOR paused application for user action",
      {
        applicationId,

        paymentPending,

        paymentStatus:
          updatedApplication.result
            ?.paymentStatus || null,

        reference:
          updatedApplication.result
            ?.reference || null,

        amount:
          updatedApplication.result
            ?.paymentAmount || null,

        currency:
          updatedApplication.result
            ?.paymentCurrency || null,

        deadline:
          updatedApplication.result
            ?.paymentDeadline || null
      }
    );

    /*
     * Do NOT mark the application completed.
     *
     * Do NOT send the completion notification.
     *
     * The payment/finalization stage must
     * still be completed later.
     */

    try {
      await this.telegram.error(
        updatedApplication,
        paymentPending
          ? "Pagamento pendente. A aplicação foi pausada e aguarda a conclusão do pagamento."
          : "A aplicação requer uma ação do utilizador antes de continuar."
      );
    } catch (
      telegramError
    ) {
      logger.error(
        "Telegram requires-user notification failed",
        {
          applicationId,

          error:
            telegramError.message
        }
      );
    }

    /*
     * The browser session is intentionally
     * closed here.
     *
     * Payment information is persisted in
     * MongoDB so the application can be
     * resumed later instead of keeping a
     * Render browser process alive indefinitely.
     */

    await this.closeAdapter(
      applicationId
    );

    return;
  }

  /*
   * Only the explicit completed state
   * counts as a completed appointment.
   */

  if (
    updatedApplication.status ===
    "completed"
  ) {
    this.stats.completed++;

    logger.info(
      "ORCHESTRATOR appointment completed",
      {
        applicationId,

        reference:
          updatedApplication.result
            ?.reference || null,

        entity:
          updatedApplication.result
            ?.entity || null,

        transactionId:
          updatedApplication.result
            ?.transactionId || null,

        paymentStatus:
          updatedApplication.result
            ?.paymentStatus || null
      }
    );

    try {
      await this.telegram.completed(
        updatedApplication,
        updatedApplication.client
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

    return;
  }

  /*
   * Unexpected successful state.
   *
   * Do not falsely mark it completed.
   */

  logger.warn(
    "ORCHESTRATOR received successful result with unexpected application status",
    {
      applicationId,

      status:
        updatedApplication.status
    }
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
