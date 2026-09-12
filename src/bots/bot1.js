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

  async prepare(
    applicationId
  ) {
    const application =
      await Application.findById(
        applicationId
      )
        .populate("client")
        .select(
          "+preparedDataEncrypted"
        );

    if (!application) {
      throw new Error(
        "Application not found"
      );
    }

    if (
      application.status ===
      "completed"
    ) {
      return application;
    }

    application.status =
      "preparing";

    application.bot1.status =
      "running";

    application.bot1.workerId =
      this.workerId;

    application.bot1.startedAt =
      new Date();

    application.bot1.lastAction =
      "initializing";

    await application.save();

    try {
      await this.site.initialize();

      application.bot1.lastAction =
        "login";

      await application.save();

      await this.site.login();

      const preparedData =
        application.preparedDataEncrypted
          ? decryptJson(
              application.preparedDataEncrypted
            )
          : null;

      application.bot1.lastAction =
        "filling_application";

      await application.save();

      await this.site.fillApplication(
        application,
        application.client,
        preparedData
      );

      const otp =
        this.otp.createRequest(
          application._id.toString()
        );

      application.otp.requestId =
        otp.requestId;

      application.otp.status =
        "waiting";

      application.status =
        "otp_required";

      application.bot1.lastAction =
        "waiting_for_otp";

      await application.save();

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

  async continueAfterVerification(
    applicationId
  ) {
    const application =
      await Application.findById(
        applicationId
      ).populate("client");

    if (!application) {
      throw new Error(
        "Application not found"
      );
    }

    try {
      application.status =
        "identity_verification";

      application.bot1.lastAction =
        "identity_verification";

      await application.save();

      if (
        application.client
          ?.facialProfile
          ?.verificationStatus ===
        "pending"
      ) {
        await this.facial.verify({
          clientId:
            application.client._id.toString(),
          templateReference:
            application.client
              .facialProfile
              .templateReference
        });
      }

      application.status =
        "calendar";

      application.bot1.lastAction =
        "opening_calendar";

      await application.save();

      await this.site.openCalendar();

      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "waiting_for_slot";

      application.preparedAt =
        new Date();

      application.bot2.monitoring =
        true;

      await application.save();

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
    const lockOwner =
      this.workerId;

    const lockExpiry =
      new Date(
        Date.now() + 30000
      );

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
                $lt: new Date()
              }
            }
          ]
        },
        {
          $set: {
            status:
              "continuing",

            "lock.owner":
              lockOwner,

            "lock.expiresAt":
              lockExpiry,

            "bot1.status":
              "continuing",

            "bot1.workerId":
              lockOwner,

            "bot1.lastAction":
              "claiming_slot"
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

    const startedAt =
      Date.now();

    try {
      if (
        slotReceivedAt
      ) {
        application.metrics.resumeMs =
          Math.max(
            0,
            Date.now() -
              new Date(
                slotReceivedAt
              ).getTime()
          );
      }

      await this.site.selectSlot(
        application.slot
      );

      application.bot1.lastAction =
        "continuing_application";

      await application.save();

      await this.site.continueApplication(
        application,
        application.client
      );

      const reference =
        await this.site.getReference();

      const entity =
        await this.site.getEntity();

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

      application.lock = {
        owner: null,
        expiresAt: null
      };

      await application.save();

      throw error;
    }
  }

  async markError(
    application,
    code,
    error
  ) {
    application.status =
      "error";

    application.bot1.status =
      "error";

    application.error = {
      code,
      message:
        error.message
    };

    await application.save();

    logger.error(
      "Bot1 failed",
      {
        applicationId:
          application._id.toString(),
        code,
        error:
          error.message
      }
    );
  }
}

module.exports =
  Bot1;
