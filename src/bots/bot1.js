const crypto = require("crypto");

const Application = require("../models/application");
const OtpService = require("../services/otp/otp-service");
const FacialService = require("../services/facial/facial-service");

const { decryptJson } = require("../utils/crypto");
const logger = require("../utils/logger");

const config = {
  lockMs:
    Number(process.env.BOT1_LOCK_MS) || 60000,

  maxAttempts:
    Number(process.env.BOT1_MAX_ATTEMPTS) || 3,

  timeoutMs:
    Number(process.env.BOT1_TIMEOUT_MS) || 30000
};

async function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${operation} timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      promise,
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizePaymentDetails(details = {}) {
  return {
    reference:
      details.reference ??
      details.requestReference ??
      details.RequestRefNo ??
      null,

    entity:
      details.entity ??
      details.transactionId ??
      details.TransactionId ??
      null,

    transactionId:
      details.transactionId ??
      details.TransactionId ??
      null,

    paymentStatus:
      details.paymentStatus ??
      details.PaymentStatus ??
      null,

    amount:
      details.amount ??
      details.paymentAmount ??
      null,

    currency:
      details.currency ??
      details.paymentCurrency ??
      null,

    deadline:
      details.deadline ??
      details.paymentDeadline ??
      null,

    confirmationUrl:
      details.confirmationUrl ??
      null,

    requiresUser:
      details.requiresUser === true
  };
}

function isPaidStatus(status) {
  if (status === null || status === undefined) {
    return false;
  }

  const normalized =
    String(status)
      .trim()
      .toLowerCase();

  return [
    "true",
    "paid",
    "success",
    "successful",
    "completed",
    "confirmed",
    "approved"
  ].includes(normalized);
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
        _id: applicationId,
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
          _id: applicationId,

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
        _id: applicationId,

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
        _id: applicationId,

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

      const loginResult =
        await withTimeout(
          this.site.login(),
          config.timeoutMs,
          "Site login"
        );

      if (
        loginResult?.success === false &&
        loginResult?.requiresUser !== true
      ) {
        throw new Error(
          loginResult.reason ||
          "VFS login failed"
        );
      }

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
        application.client?.phone ||
        application.client?.email ||
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

      application.radar.enabled =
        true;

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
              "claiming_slot",

            "bot2.monitoring":
              false,

            "bot2.status":
              "slot_found"
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

      const selected =
        await withTimeout(
          this.site.selectSlot(
            application.slot,
            application
          ),
          config.timeoutMs,
          "Slot selection"
        );

      if (
        selected?.success === false &&
        selected?.requiresUser !== true
      ) {
        throw new Error(
          selected.reason ||
          "Slot selection failed"
        );
      }

      await this.refreshLock(
        applicationId
      );

      await this.heartbeat(
        applicationId,
        "continuing_application"
      );

      const continued =
        await withTimeout(
          this.site.continueApplication(
            application,
            application.client
          ),
          config.timeoutMs,
          "Application continuation"
        );

      if (
        continued?.success === false &&
        continued?.requiresUser !== true
      ) {
        throw new Error(
          continued.reason ||
          "Application continuation failed"
        );
      }

      await this.refreshLock(
        applicationId
      );

      /*
       * IMPORTANT:
       * A candidatura ainda NÃO está concluída.
       *
       * Primeiro entramos em REVIEW & PAY.
       */
      application.status =
        "review_pay";

      application.bot1.status =
        "continuing";

      application.bot1.lastAction =
        "review_pay";

      await application.save();

      await this.heartbeat(
        applicationId,
        "extracting_payment_details"
      );

      const rawPaymentDetails =
        await withTimeout(
          this.site.getPaymentDetails(
            application,
            application.client
          ),
          config.timeoutMs,
          "Payment details retrieval"
        );

      const payment =
        normalizePaymentDetails(
          rawPaymentDetails
        );

      /*
       * Compatibilidade com adapters
       * antigos: se o adapter ainda não
       * devolver referência/entidade,
       * tentamos os métodos legados.
       */
      if (!payment.reference) {
        payment.reference =
          await withTimeout(
            this.site.getReference(
              application
            ),
            config.timeoutMs,
            "Reference retrieval"
          ).catch(() => null);
      }

      if (!payment.entity) {
        payment.entity =
          await withTimeout(
            this.site.getEntity(
              application
            ),
            config.timeoutMs,
            "Entity retrieval"
          ).catch(() => null);
      }

      application.result.reference =
        payment.reference;

      application.result.entity =
        payment.entity;

      application.result.transactionId =
        payment.transactionId;

      application.result.paymentStatus =
        payment.paymentStatus;

      application.result.paymentAmount =
        payment.amount;

      application.result.paymentCurrency =
        payment.currency;

      application.result.paymentDeadline =
        payment.deadline;

      application.result.confirmationUrl =
        payment.confirmationUrl;

      await application.save();

      await this.refreshLock(
        applicationId
      );

      /*
       * Se o VFS indicar que o pagamento
       * ainda precisa ser realizado,
       * NÃO tentamos fingir que foi pago.
       */
      if (
        payment.requiresUser === true ||
        (
          payment.paymentStatus !== null &&
          !isPaidStatus(
            payment.paymentStatus
          )
        )
      ) {
        application.status =
          "requires_user";

        application.bot1.status =
          "requires_user";

        application.bot1.lastAction =
          "payment_required";

        application.bot2.monitoring =
          false;

        application.radar.enabled =
          false;

        application.lock = {
          owner: null,
          expiresAt: null
        };

        await application.save();

        return {
          success: true,

          requiresUser: true,

          reason:
            "Payment is required before final booking.",

          application
        };
      }

      /*
       * Só avançamos para BOOK_APPOINTMENT
       * quando o adapter confirma que a etapa
       * pode prosseguir.
       */
      application.status =
        "book_appointment";

      application.bot1.lastAction =
        "book_appointment";

      await application.save();

      await this.refreshLock(
        applicationId
      );

      await this.heartbeat(
        applicationId,
        "finalizing_booking"
      );

      const finalization =
        await withTimeout(
          this.site.finalizeBooking(
            application,
            payment
          ),
          config.timeoutMs,
          "Booking finalization"
        );

      if (
        finalization?.success === false
      ) {
        if (
          finalization.requiresUser === true
        ) {
          application.status =
            "requires_user";

          application.bot1.status =
            "requires_user";

          application.bot1.lastAction =
            "finalization_requires_user";

          application.lock = {
            owner: null,
            expiresAt: null
          };

          await application.save();

          return {
            success: true,
            requiresUser: true,
            application
          };
        }

        throw new Error(
          finalization.reason ||
          "Booking finalization failed"
        );
      }

      await this.refreshLock(
        applicationId
      );

      await this.heartbeat(
        applicationId,
        "checking_confirmation"
      );

      const confirmation =
        await withTimeout(
          this.site.getConfirmation(
            application,
            payment,
            finalization
          ),
          config.timeoutMs,
          "Confirmation verification"
        );

      const normalizedConfirmation =
        normalizePaymentDetails(
          confirmation || {}
        );

      if (
        normalizedConfirmation.reference
      ) {
        application.result.reference =
          normalizedConfirmation.reference;
      }

      if (
        normalizedConfirmation.entity
      ) {
        application.result.entity =
          normalizedConfirmation.entity;
      }

      if (
        normalizedConfirmation.transactionId
      ) {
        application.result.transactionId =
          normalizedConfirmation.transactionId;
      }

      if (
        normalizedConfirmation.paymentStatus
      ) {
        application.result.paymentStatus =
          normalizedConfirmation.paymentStatus;
      }

      if (
        normalizedConfirmation.confirmationUrl
      ) {
        application.result.confirmationUrl =
          normalizedConfirmation.confirmationUrl;
      }

      const confirmed =
        confirmation?.confirmed === true ||
        confirmation?.success === true ||
        (
          confirmation?.paymentStatus != null &&
          isPaidStatus(
            confirmation.paymentStatus
          )
        );

      if (!confirmed) {
        application.status =
          "requires_user";

        application.bot1.status =
          "requires_user";

        application.bot1.lastAction =
          "confirmation_not_verified";

        application.lock = {
          owner: null,
          expiresAt: null
        };

        await application.save();

        return {
          success: true,

          requiresUser: true,

          reason:
            "The booking was not independently confirmed.",

          application
        };
      }

      const completionMs =
        Date.now() -
        startedAt;

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

      application.radar.enabled =
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

        completed: true,

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

    application.bot2.monitoring =
      false;

    application.radar.enabled =
      false;

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
