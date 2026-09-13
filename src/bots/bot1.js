const crypto =
  require("crypto");

const Application =
  require("../models/application");

const OtpService =
  require("../services/otp/otp-service");

const FacialService =
  require("../services/facial/facial-service");

const {
  decryptJson
} = require("../utils/crypto");

const logger =
  require("../utils/logger");

const config = {
  lockMs:
    Number(
      process.env.BOT1_LOCK_MS
    ) || 60000,

  maxAttempts:
    Number(
      process.env.BOT1_MAX_ATTEMPTS
    ) || 3,

  timeoutMs:
    Number(
      process.env.BOT1_TIMEOUT_MS
    ) || 30000
};

async function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(() => {
            reject(
              new Error(
                `${operation} timed out after ${timeoutMs}ms`
              )
            );
          }, timeoutMs);
      }
    );

  try {
    return await Promise.race([
      promise,
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class Bot1 {
  constructor(site) {
    this.site = site;

    this.workerId =
      crypto.randomUUID();

    this.otp =
      new OtpService();

    this.facial =
      new FacialService();
  }

  async heartbeat(
    applicationId,
    action
  ) {
    await Application.updateOne(
      {
        _id:
          applicationId,

        "bot1.workerId":
          this.workerId
      },
      {
        $set: {
          "bot1.heartbeatAt":
            new Date(),

          "bot1.lastAction":
            action
        }
      }
    );
  }

  async claimApplication(
    applicationId,
    allowedStatuses
  ) {
    const now =
      new Date();

    const lockExpires =
      new Date(
        Date.now() +
          config.lockMs
      );

    return Application
      .findOneAndUpdate(
        {
          _id:
            applicationId,

          status: {
            $in:
              allowedStatuses
          },

          $or: [
            {
              "lock.owner":
                null
            },
            {
              "lock.expiresAt": {
                $lt: now
              }
            }
          ]
        },
        {
          $set: {
            "lock.owner":
              this.workerId,

            "lock.expiresAt":
              lockExpires,

            "bot1.workerId":
              this.workerId,

            "bot1.heartbeatAt":
              now,

            "bot1.lastAttemptAt":
              now
          },

          $inc: {
            "bot1.attempts":
              1
          }
        },
        {
          new: true
        }
      )
      .populate("client")
      .select(
        "+preparedDataEncrypted"
      );
  }

  async refreshLock(
    applicationId
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
          "lock.expiresAt":
            new Date(
              Date.now() +
                config.lockMs
            ),

          "bot1.heartbeatAt":
            new Date()
        }
      }
    );
  }

  async releaseLock(
    applicationId
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
          "lock.owner":
            null,

          "lock.expiresAt":
            null
        }
      }
    );
  }

  attemptsExceeded(
    application
  ) {
    return (
      Number(
        application.bot1
          ?.attempts
      ) >
      config.maxAttempts
    );
  }

  async prepare(
    applicationId
  ) {
    const startedAt =
      Date.now();

    const application =
      await this.claimApplication(
        applicationId,
        [
          "created",
          "error"
        ]
      );

    if (!application) {
      const existing =
        await Application.findById(
          applicationId
        );

      if (!existing) {
        throw new Error(
          "Application not found"
        );
      }

      return existing;
    }

    if (
      this.attemptsExceeded(
        application
      )
    ) {
      await this.markError(
        application,
        "BOT1_MAX_ATTEMPTS",
        new Error(
          "Maximum Bot 1 attempts exceeded"
        )
      );

      throw new Error(
        "Maximum Bot 1 attempts exceeded"
      );
    }

    application.status =
      "preparing";

    application.bot1.status =
      "running";

    application.bot1.startedAt =
      new Date();

    application.bot1.lastAction =
      "initializing";

    application.error = {
      code: null,
      message: null,
      at: null,
      attempts: 0
    };

    await application.save();

    try {
      await this.heartbeat(
        applicationId,
        "initializing_site"
      );

      await withTimeout(
        this.site.initialize(),
        config.timeoutMs,
        "Site initialization"
      );

      await this.heartbeat(
        applicationId,
        "logging_in"
      );

      await withTimeout(
        this.site.login(),
        config.timeoutMs,
        "Site login"
      );

      const preparedData =
        application
          .preparedDataEncrypted
          ? decryptJson(
              application
                .preparedDataEncrypted
            )
          : null;

      await this.heartbeat(
        applicationId,
        "filling_application"
      );

      await withTimeout(
        this.site.fillApplication(
          application,
          application.client,
          preparedData
        ),
        config.timeoutMs,
        "Application preparation"
      );

      const otp =
        this.otp.createRequest(
          applicationId
        );

      application.otp.requestId =
        otp.requestId;

      application.otp.status =
        "waiting";

      application.otp.expiresAt =
        otp.expiresAt;

      application.otp.attempts =
        0;

      await this.otp.requestCode(
        otp,
        application.client
          ?.phone ||
          application.client
            ?.email ||
          null
      );

      application.status =
        "otp_required";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "waiting_for_otp";

      application.preparedAt =
        new Date();

      application.metrics.preparationMs =
        Date.now() -
        startedAt;

      await application.save();

      await this.releaseLock(
        applicationId
      );

      return application;
    } catch (error) {
      await this.markError(
        application,
        "BOT1_PREPARATION_ERROR",
        error
      );

      throw error;
    }
  }

  async verifyOtp(
    applicationId,
    code
  ) {
    const application =
      await Application.findOne({
        _id:
          applicationId
      }).select(
        "+preparedDataEncrypted"
      );

    if (!application) {
      throw new Error(
        "Application not found"
      );
    }

    if (
      application.status !==
      "otp_required"
    ) {
      throw new Error(
        `OTP cannot be verified from status ${application.status}`
      );
    }

    if (
      application.otp.status !==
      "waiting"
    ) {
      throw new Error(
        `OTP is not waiting: ${application.otp.status}`
      );
    }

    const request = {
      requestId:
        application.otp
          .requestId,

      applicationId:
        application._id
          .toString(),

      expiresAt:
        application.otp
          .expiresAt
    };

    const attempts =
      Number(
        application.otp
          .attempts
      ) || 0;

    const result =
      await this.otp.verifyCode({
        request,
        code,
        attempts
      });

    application.otp.attempts =
      attempts + 1;

    if (
      result.status ===
      "expired"
    ) {
      application.otp.status =
        "expired";

      application.status =
        "error";

      application.error = {
        code:
          "OTP_EXPIRED",

        message:
          "OTP expired",

        at:
          new Date(),

        attempts:
          application.otp.attempts
      };

      application.bot1.status =
        "error";

      await application.save();

      return application;
    }

    if (!result.verified) {
      if (
        application.otp.attempts >=
        this.otp.maxAttempts
      ) {
        application.otp.status =
          "failed";

        application.status =
          "error";

        application.error = {
          code:
            "OTP_MAX_ATTEMPTS",

          message:
            "Maximum OTP attempts exceeded",

          at:
            new Date(),

          attempts:
            application.otp.attempts
        };

        application.bot1.status =
          "error";
      }

      await application.save();

      return application;
    }

    application.otp.status =
      "verified";

    application.otp.verifiedAt =
      new Date();

    application.status =
      "otp_verified";

    application.bot1.status =
      "waiting";

    application.bot1.lastAction =
      "otp_verified";

    await application.save();

    return application;
  }

  async continueAfterVerification(
    applicationId
  ) {
    const application =
      await this.claimApplication(
        applicationId,
        [
          "otp_verified"
        ]
      );

    if (!application) {
      const existing =
        await Application.findById(
          applicationId
        ).populate("client");

      if (!existing) {
        throw new Error(
          "Application not found"
        );
      }

      if (
        existing.status ===
        "otp_required"
      ) {
        throw new Error(
          "OTP must be verified before continuing"
        );
      }

      return existing;
    }

    try {
      if (
        application.otp.status !==
        "verified"
      ) {
        throw new Error(
          "OTP is not verified"
        );
      }

      application.status =
        "identity_verification";

      application.bot1.status =
        "running";

      application.bot1.lastAction =
        "identity_verification";

      await application.save();

      await this.heartbeat(
        applicationId,
        "identity_verification"
      );

      if (
        application.client
          ?.facialProfile
          ?.verificationStatus ===
        "pending"
      ) {
        const result =
          await withTimeout(
            this.facial.verify({
              clientId:
                application.client._id.toString(),

              templateReference:
                application.client
                  .facialProfile
                  .templateReference
            }),
            config.timeoutMs,
            "Identity verification"
          );

        if (
          !result ||
          result.verified !== true
        ) {
          throw new Error(
            "Identity verification was not successful"
          );
        }
      }

      application.status =
        "calendar";

      application.bot1.lastAction =
        "opening_calendar";

      await application.save();

      await this.heartbeat(
        applicationId,
        "opening_calendar"
      );

      await withTimeout(
        this.site.openCalendar(),
        config.timeoutMs,
        "Calendar opening"
      );

      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "waiting_for_slot";

      application.bot2.status =
        "monitoring";

      application.bot2.monitoring =
        true;

      application.bot2.workerId =
        null;

      await application.save();

      await this.releaseLock(
        applicationId
      );

      return application;
    } catch (error) {
      await this.markError(
        application,
        "BOT1_CALENDAR_ERROR",
        error
      );

      throw error;
    }
  }

  async handleSlot(
    applicationId,
    slotReceivedAt = null
  ) {
    const startedAt =
      Date.now();

    const application =
      await Application.findOneAndUpdate(
        {
          _id:
            applicationId,

          status:
            "slot_received",

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
              "continuing",

            "lock.owner":
              this.workerId,

            "lock.expiresAt":
              new Date(
                Date.now() +
                  config.lockMs
              ),

            "bot1.status":
              "continuing",

            "bot1.workerId":
              this.workerId,

            "bot1.startedAt":
              new Date(),

            "bot1.heartbeatAt":
              new Date(),

            "bot1.lastAction":
              "claiming_slot"
          },

          $inc: {
            "bot1.attempts":
              1
          }
        },
        {
          new: true
        }
      ).populate("client");

    if (!application) {
      return {
        success: false,
        reason:
          "Slot already claimed or application unavailable"
      };
    }

    if (
      this.attemptsExceeded(
        application
      )
    ) {
      await this.markError(
        application,
        "BOT1_MAX_ATTEMPTS",
        new Error(
          "Maximum Bot 1 attempts exceeded"
        )
      );

      throw new Error(
        "Maximum Bot 1 attempts exceeded"
      );
    }

    try {
      if (slotReceivedAt) {
        application.metrics.resumeMs =
          Math.max(
            0,
            Date.now() -
              new Date(
                slotReceivedAt
              ).getTime()
          );
      }

      await this.heartbeat(
        applicationId,
        "selecting_slot"
      );

      await withTimeout(
        this.site.selectSlot(
          application.slot
        ),
        config.timeoutMs,
        "Slot selection"
      );

      await this.refreshLock(
        applicationId
      );

      await this.heartbeat(
        applicationId,
        "continuing_application"
      );

      await withTimeout(
        this.site.continueApplication(
          application,
          application.client
        ),
        config.timeoutMs,
        "Application continuation"
      );

      await this.refreshLock(
        applicationId
      );

      await this.heartbeat(
        applicationId,
        "obtaining_reference"
      );

      const reference =
        await withTimeout(
          this.site.getReference(),
          config.timeoutMs,
          "Reference retrieval"
        );

      const entity =
        await withTimeout(
          this.site.getEntity(),
          config.timeoutMs,
          "Entity retrieval"
        );

      const completionMs =
        Date.now() -
        startedAt;

      application.result = {
        reference:
          reference || null,

        entity:
          entity || null
      };

      application.status =
        "completed";

      application.bot1.status =
        "completed";

      application.bot1.lastAction =
        "completed";

      application.bot1.completedAt =
        new Date();

      application.bot1.heartbeatAt =
        new Date();

      application.bot2.monitoring =
        false;

      application.metrics.completionMs =
        completionMs;

      application.lock = {
        owner: null,
        expiresAt: null
      };

      await application.save();

      return {
        success: true,
        application,
        elapsedMs:
          completionMs
      };
    } catch (error) {
      await this.markError(
        application,
        "BOT1_COMPLETION_ERROR",
        error
      );

      await this.releaseLock(
        applicationId
      );

      throw error;
    }
  }

  async markError(
    application,
    code,
    error
  ) {
    const attempts =
      Number(
        application.error
          ?.attempts
      ) || 0;

    application.status =
      "error";

    application.bot1.status =
      "error";

    application.bot1.lastAction =
      code;

    application.error = {
      code,

      message:
        error?.message ||
        "Unknown Bot 1 error",

      at:
        new Date(),

      attempts:
        attempts + 1
    };

    application.lock = {
      owner: null,
      expiresAt: null
    };

    await application.save();

    logger.error(
      "Bot1 failed",
      {
        applicationId:
          application._id.toString(),

        workerId:
          this.workerId,

        code,

        attempt:
          attempts + 1,

        error:
          error?.message
      }
    );
  }
}

module.exports =
  Bot1;
