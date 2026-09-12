const Application =
  require("../models/application");

const Client =
  require("../models/client");

const OtpService =
  require("../services/otp/otp-service");

const FacialService =
  require("../services/facial/facial-service");

const eventBus =
  require("../utils/logger");

class Bot1 {
  constructor(site) {
    this.site = site;

    this.otp =
      new OtpService();

    this.facial =
      new FacialService();
  }

  async prepare(
    applicationId
  ) {
    const application =
      await Application
        .findById(
          applicationId
        )
        .populate("client");

    if (!application) {
      throw new Error(
        "Application not found"
      );
    }

    application.status =
      "preparing";

    application.bot1.status =
      "running";

    application.bot1.startedAt =
      new Date();

    await application.save();

    try {
      await this.site.initialize();

      /*
       * O objetivo aqui é preparar tudo
       * antes da disponibilidade.
       */

      await this.site.login();

      await this.site.fillApplication(
        application,
        application.client
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

      await application.save();

      /*
       * O fluxo de OTP será retomado
       * através do provider autorizado.
       */

      return application;
    } catch (error) {
      application.status =
        "error";

      application.bot1.status =
        "error";

      application.error = {
        code: "BOT1_PREPARATION_ERROR",
        message: error.message
      };

      await application.save();

      throw error;
    }
  }

  async continueAfterVerification(
    applicationId
  ) {
    const application =
      await Application
        .findById(
          applicationId
        )
        .populate("client");

    if (!application) {
      throw new Error(
        "Application not found"
      );
    }

    const started =
      performance.now();

    try {
      application.status =
        "calendar";

      await application.save();

      await this.site.openCalendar();

      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.preparedAt =
        new Date();

      await application.save();

      return application;
    } catch (error) {
      application.status =
        "error";

      application.error = {
        code: "BOT1_CALENDAR_ERROR",
        message: error.message
      };

      await application.save();

      throw error;
    }
  }

  async handleSlot(
    applicationId,
    slot
  ) {
    /*
     * Lock atómico no MongoDB.
     *
     * Isto evita que duas instâncias do worker
     * tentem concluir o mesmo processo.
     */

    const application =
      await Application.findOneAndUpdate(
        {
          _id: applicationId,

          status:
            "waiting_for_slot",

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
              "slot_received",

            "lock.owner":
              process.pid.toString(),

            "lock.expiresAt":
              new Date(
                Date.now() +
                30000
              ),

            slot
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
          "Already locked or completed"
      };
    }

    const started =
      performance.now();

    try {
      application.status =
        "continuing";

      application.bot1.status =
        "continuing";

      await application.save();

      await this.site.selectSlot(
        slot
      );

      await this.site.continueApplication(
        application,
        application.client
      );

      const reference =
        await this.site.getReference();

      const entity =
        await this.site.getEntity();

      const elapsed =
        performance.now() -
        started;

      application.result = {
        reference,
        entity
      };

      application.status =
        "completed";

      application.bot1.status =
        "completed";

      application.bot1.completedAt =
        new Date();

      application.metrics.completionMs =
        Math.round(
          elapsed
        );

      application.lock =
        {
          owner: null,
          expiresAt: null
        };

      await application.save();

      return {
        success: true,
        application,
        elapsedMs:
          Math.round(
            elapsed
          )
      };
    } catch (error) {
      application.status =
        "error";

      application.bot1.status =
        "error";

      application.error = {
        code:
          "BOT1_COMPLETION_ERROR",

        message:
          error.message
      };

      application.lock = {
        owner: null,
        expiresAt: null
      };

      await application.save();

      throw error;
    }
  }
}

module.exports =
  Bot1;
