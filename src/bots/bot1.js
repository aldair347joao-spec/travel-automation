"use strict";

const crypto = require("crypto");

const Application = require("../models/application");
const OtpService = require("../services/otp/otp-service");
const FacialService = require("../services/facial/facial-service");
const {
  requireAutomationRelease
} = require(
  "../services/admin/automation-guard"
);
const { decryptJson } = require("../utils/crypto");
const logger = require("../utils/logger");

const stateMachine = require(
  "../services/application/application-state-machine"
);

const {
  STATES,
  transition: transitionState
} = stateMachine;


const config = {
  lockMs:
    Number(process.env.BOT1_LOCK_MS) || 60000,

  maxAttempts:
    Number(process.env.BOT1_MAX_ATTEMPTS) || 3,

  timeoutMs:
    Number(process.env.BOT1_TIMEOUT_MS) || 30000
};


/*
 * =========================================================
 * TIMEOUT
 * =========================================================
 */

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

  try {

    return await Promise.race([
      promise,
      timeout
    ]);

  } finally {

    clearTimeout(timer);
  }
}


/*
 * =========================================================
 * PAYMENT HELPERS
 * =========================================================
 */

function normalizePaymentDetails(
  details = {}
) {

  return {

    reference:
      details.reference ??
      details.requestReference ??
      details.RequestRefNo ??
      null,

    entity:
      details.entity ??
      details.Entity ??
      null,

    transactionId:
      details.transactionId ??
      details.TransactionId ??
      null,

    paymentStatus:
      details.paymentStatus ??
      details.PaymentStatus ??
      details.status ??
      null,

    amount:
      details.amount ??
      details.paymentAmount ??
      details.Amount ??
      null,

    currency:
      details.currency ??
      details.paymentCurrency ??
      details.Currency ??
      null,

    deadline:
      details.deadline ??
      details.paymentDeadline ??
      details.Deadline ??
      null,

    confirmationUrl:
      details.confirmationUrl ??
      null,

    requiresUser:
      details.requiresUser === true

  };
}


function isPaidStatus(
  status
) {

  if (
    status === null ||
    status === undefined
  ) {

    return false;
  }

  return [
    "true",
    "paid",
    "success",
    "successful",
    "completed",
    "confirmed",
    "approved"
  ].includes(
    String(status)
      .trim()
      .toLowerCase()
  );
}


function isPendingPayment(
  payment
) {

  if (
    payment?.requiresUser === true
  ) {

    return true;
  }

  if (
    payment?.paymentStatus === null ||
    payment?.paymentStatus === undefined
  ) {

    return false;
  }

  return !isPaidStatus(
    payment.paymentStatus
  );
}


/*
 * =========================================================
 * WORKFLOW
 * =========================================================
 */

function getWorkflowState(
  application
) {

  if (
    application?.workflowState
  ) {

    return application.workflowState;
  }

  const legacy =
    application?.status;

  const map = {

    created:
      STATES.CREATED,

    preparing:
      STATES.IDENTITY_PREPARATION,

    otp_required:
      STATES.OTP_REQUIRED,

    otp_verified:
      STATES.OTP_VERIFIED,

    identity_verification:
      STATES.IDENTITY_PREPARATION,

    calendar:
      STATES.RADAR_ACTIVE,

    waiting_for_slot:
      STATES.RADAR_ACTIVE,

    slot_received:
      STATES.SLOT_FOUND,

    continuing:
      STATES.BOOKING,

    review_pay:
      STATES.REVIEW,

    book_appointment:
      STATES.BOOKING,

    requires_user:
      application?.result?.paymentStatus
        ? STATES.PAYMENT_PENDING
        : STATES.ERROR,

    completed:
      STATES.COMPLETED,

    cancelled:
      STATES.CANCELLED,

    error:
      STATES.ERROR

  };

  return (
    map[legacy] ||
    STATES.CREATED
  );
}


async function moveState(
  application,
  nextState,
  metadata = {}
) {

  const current =
    getWorkflowState(
      application
    );

  if (
    current === nextState
  ) {

    application.workflow =
      application.workflow || {};

    application.workflow.lastEvent =
      metadata.event || null;

    application.workflow.lastReason =
      metadata.reason || null;

    application.workflow.stateChangedAt =
      new Date();

    application.workflow.transitionCount =
      Number(
        application.workflow.transitionCount || 0
      ) + 1;

    return application;
  }

  transitionState(
    application,
    nextState,
    metadata
  );

  application.workflow =
    application.workflow || {};

  application.workflow.transitionCount =
    Number(
      application.workflow.transitionCount || 0
    ) + 1;

  return application;
}


/*
 * =========================================================
 * BOT 1
 * =========================================================
 */

class Bot1 {

  constructor(
    site
  ) {

    this.site =
      site;

    this.workerId =
      crypto.randomUUID();

    this.otp =
      new OtpService();

    this.facial =
      new FacialService();
  }

  /*
   * =======================================================
   * ADMIN AUTOMATION GATE
   * =======================================================
   */

  async assertAdminRelease(
    applicationId
  ) {
    await requireAutomationRelease(
      applicationId
    );

    return true;
  }
  /*
   * -------------------------------------------------------
   * HEARTBEAT
   * -------------------------------------------------------
   */

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


  /*
   * -------------------------------------------------------
   * LOCK APPLICATION
   * -------------------------------------------------------
   */

  async claimApplication(
    applicationId,
    allowedStatuses = []
  ) {
         await this.assertAdminRelease(
      applicationId
    );
    const now =
      new Date();

    const lockExpires =
      new Date(
        Date.now() +
        config.lockMs
      );

    const workflowMap = {

      created:
        STATES.CREATED,

      error:
        STATES.ERROR,

      otp_required:
        STATES.OTP_REQUIRED,

      otp_verified:
        STATES.OTP_VERIFIED,

      slot_received:
        STATES.SLOT_FOUND,

      waiting_for_slot:
        STATES.RADAR_ACTIVE

    };

    const workflowCandidates =
      allowedStatuses.map(
        status =>
          workflowMap[status] ||
          status
      );

    const query = {

      _id:
        applicationId,

      $and: [

        {
          $or: [

            {
              workflowState: {
                $in:
                  workflowCandidates
              }
            },

            {
              status: {
                $in:
                  allowedStatuses
              }
            }

          ]
        },

        {
          $or: [

            {
              "lock.owner":
                null
            },

            {
              "lock.owner": {
                $exists:
                  false
              }
            },

            {
              "lock.expiresAt": {
                $lt:
                  now
              }
            }

          ]
        }

      ]
    };

    return Application
      .findOneAndUpdate(
        query,
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
          new:
            true
        }
      )
      .populate("client")
      .select(
        "+preparedDataEncrypted"
      );
  }


  /*
   * -------------------------------------------------------
   * CLAIM SLOT
   * -------------------------------------------------------
   *
   * O Supervisor pode reservar previamente
   * a vaga usando o seu próprio workerId.
   *
   * Nesse caso o Bot 1 recebe explicitamente
   * esse lock através de bot1.workerId e faz
   * o handoff para o seu próprio worker.
   */

  async claimSlot(
    applicationId
  ) {
         await this.assertAdminRelease(
      applicationId
    );
    const now =
      new Date();

    const lockExpires =
      new Date(
        Date.now() +
        config.lockMs
      );

    const application =
      await Application.findOne(
        {
          _id:
            applicationId,

          $or: [

            {
              workflowState:
                STATES.SLOT_FOUND
            },

            {
              workflowState:
                STATES.SLOT_LOCKED
            },

            {
              status:
                "slot_received"
            }

          ]
        }
      )
      .populate("client")
      .select(
        "+preparedDataEncrypted"
      );


    if (
      !application
    ) {

      return null;
    }


    const currentOwner =
      application.lock?.owner;

    const lockExpiresAt =
      application.lock?.expiresAt;

    const lockIsExpired =
      !lockExpiresAt ||
      new Date(
        lockExpiresAt
      ).getTime() <=
      now.getTime();


    /*
     * Handoff autorizado pelo Supervisor.
     *
     * O Supervisor grava o seu workerId
     * simultaneamente em lock.owner e
     * bot1.workerId.
     */

    const supervisorHandoff =
      Boolean(
        currentOwner &&
        application.bot1?.workerId &&
        currentOwner ===
          application.bot1.workerId &&
        !lockIsExpired
      );


    /*
     * Lock pertencente a outro Bot 1:
     * não roubamos.
     */

    if (
      currentOwner &&
      currentOwner !==
        this.workerId &&
      !lockIsExpired &&
      !supervisorHandoff
    ) {

      return null;
    }


    /*
     * Transferimos o lock para o worker
     * real desta instância de Bot 1.
     */

    application.lock = {

      owner:
        this.workerId,

      expiresAt:
        lockExpires

    };


    application.bot1 =
      application.bot1 || {};


    application.bot1.workerId =
      this.workerId;

    application.bot1.status =
      "continuing";

    application.bot1.startedAt =
      application.bot1.startedAt ||
      now;

    application.bot1.heartbeatAt =
      now;

    application.bot1.lastAction =
      "claiming_slot";


    application.bot2 =
      application.bot2 || {};


    application.bot2.monitoring =
      false;

    application.bot2.status =
      "slot_found";


    application.bot1.attempts =
      Number(
        application.bot1.attempts || 0
      ) + 1;


    await application.save();

    return application;
  }


  /*
   * -------------------------------------------------------
   * LOCK
   * -------------------------------------------------------
   */

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
        application?.bot1?.attempts || 0
      ) >
      config.maxAttempts
    );
  }


  /*
   * =======================================================
   * PREPARE
   * =======================================================
   */

  async prepare(
    applicationId
  ) {
        await this.assertAdminRelease(
      applicationId
    );
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


    if (
      !application
    ) {

      const existing =
        await Application.findById(
          applicationId
        )
          .populate("client")
          .select(
            "+preparedDataEncrypted"
          );


      if (
        !existing
      ) {

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


    try {

      await moveState(
        application,
        STATES.IDENTITY_PREPARATION,
        {
          event:
            "BOT1_PREPARATION_STARTED",

          reason:
            "Bot 1 iniciou a preparação da candidatura."
        }
      );


      application.status =
        "preparing";

      application.bot1.status =
        "running";

      application.bot1.startedAt =
        new Date();

      application.bot1.lastAction =
        "initializing";


      application.error = {

        code:
          null,

        message:
          null,

        at:
          null,

        attempts:
          0

      };


      await application.save();


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
        "vfs_session"
      );


      await moveState(
        application,
        STATES.VFS_SESSION,
        {
          event:
            "VFS_SESSION_STARTED"
        }
      );


      const loginResult =
        await withTimeout(
          this.site.login(
            application
          ),
          config.timeoutMs,
          "Site login"
        );


      if (
        loginResult?.state ===
        "CAPTCHA_REQUIRED"
      ) {

        await moveState(
          application,
          STATES.CAPTCHA_REQUIRED,
          {
            event:
              "VFS_CAPTCHA_REQUIRED",

            reason:
              loginResult.reason ||
              "VFS requires its official CAPTCHA checkpoint."
          }
        );


        application.bot1.status =
          "waiting";

        application.bot1.lastAction =
          "captcha_required";


        await application.save();

        await this.releaseLock(
          applicationId
        );

        return application;
      }


      if (
        loginResult?.success ===
        false
      ) {

        if (
          loginResult?.restricted ===
          true
        ) {

          await moveState(
            application,
            STATES.VFS_ACCOUNT_RESTRICTED,
            {
              event:
                "VFS_ACCOUNT_RESTRICTED",

              reason:
                loginResult.reason
            }
          );


          application.bot1.status =
            "error";


          await application.save();

          await this.releaseLock(
            applicationId
          );

          return application;
        }


        throw new Error(
          loginResult.reason ||
          "VFS login failed"
        );
      }


      if (
        loginResult?.requiresUser ===
        true
      ) {

        await moveState(
          application,
          STATES.VFS_AUTHENTICATING,
          {
            event:
              "VFS_AUTHENTICATION_CHECKPOINT",

            reason:
              loginResult.reason ||
              "Official VFS authentication checkpoint."
          }
        );


        application.bot1.status =
          "waiting";

        application.bot1.lastAction =
          "vfs_authentication_checkpoint";


        await application.save();

        await this.releaseLock(
          applicationId
        );

        return application;
      }


      await moveState(
        application,
        STATES.VFS_AUTHENTICATED,
        {
          event:
            "VFS_AUTHENTICATED"
        }
      );


      const preparedData =
        application.preparedDataEncrypted
          ? decryptJson(
              application.preparedDataEncrypted
            )
          : null;


      if (
        !preparedData
      ) {

        throw new Error(
          "Prepared application data is missing"
        );
      }


      await this.heartbeat(
        applicationId,
        "filling_application"
      );


      const filled =
        await withTimeout(
          this.site.fillApplication(
            application,
            application.client,
            preparedData
          ),
          config.timeoutMs,
          "Application preparation"
        );


      if (
        filled?.success ===
        false
      ) {

        if (
          filled.requiresUser ===
          true
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "application_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );

          return application;
        }


        throw new Error(
          filled.reason ||
          "Application preparation failed"
        );
      }


      application.preparedAt =
        new Date();


      application.metrics =
        application.metrics || {};


      application.metrics.preparationMs =
        Date.now() -
        startedAt;


      await moveState(
        application,
        STATES.READY_FOR_AUTOMATION,
        {
          event:
            "APPLICATION_READY_FOR_AUTOMATION",

          reason:
            "Dados preparados e candidatura pronta para o radar."
        }
      );


      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "ready_for_automation";


      application.bot2 =
        application.bot2 || {};


      application.bot2.status =
        "monitoring";

      application.bot2.monitoring =
        true;

      application.bot2.workerId =
        null;


      application.radar =
        application.radar || {};


      application.radar.enabled =
        true;


      await application.save();

      await this.releaseLock(
        applicationId
      );


      return application;

    } catch (
      error
    ) {
     
      await this.markError(
        application,
        "BOT1_PREPARATION_ERROR",
        error
      );

      throw error;
    }
  }


  /*
   * =======================================================
   * OTP VERIFICATION
   * =======================================================
   */

  async verifyOtp(
    applicationId,
    code
  ) {
     await this.assertAdminRelease(
    applicationId
  );
    const application =
      await Application.findById(
        applicationId
      )
        .select(
          "+preparedDataEncrypted"
        )
        .populate("client");


    if (
      !application
    ) {

      throw new Error(
        "Application not found"
      );
    }


    const state =
      getWorkflowState(
        application
      );


    if (
      state !==
        STATES.OTP_REQUIRED &&
      application.status !==
        "otp_required"
    ) {

      throw new Error(
        `OTP cannot be verified from workflow state ${state}`
      );
    }


    if (
      application.otp?.status !==
      "waiting"
    ) {

      throw new Error(
        `OTP is not waiting: ${application.otp?.status}`
      );
    }


    const request = {

      requestId:
        application.otp.requestId,

      applicationId:
        application._id.toString(),

      expiresAt:
        application.otp.expiresAt

    };


    const attempts =
      Number(
        application.otp.attempts || 0
      );


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


      await this.markError(
        application,
        "OTP_EXPIRED",
        new Error(
          "OTP expired"
        )
      );


      return application;
    }


    if (
      !result.verified
    ) {

      if (
        application.otp.attempts >=
        this.otp.maxAttempts
      ) {

        application.otp.status =
          "failed";


        try {

          await moveState(
            application,
            STATES.OTP_FAILED,
            {
              event:
                "OTP_MAX_ATTEMPTS"
            }
          );

        } catch {

          application.workflowState =
            STATES.OTP_FAILED;
        }


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

      } else {

        application.error = {

          code:
            "OTP_INVALID",

          message:
            "Invalid OTP",

          at:
            new Date(),

          attempts:
            application.otp.attempts

        };

        application.bot1.lastAction =
          "otp_invalid";
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


    await moveState(
      application,
      STATES.OTP_VERIFIED,
      {
        event:
          "OTP_VERIFIED"
      }
    );


    await application.save();

    return application;
  }


  /*
   * =======================================================
   * CONTINUE AFTER OTP / VERIFICATION
   * =======================================================
   */

  async continueAfterVerification(
    applicationId
  ) {
     await this.assertAdminRelease(
    applicationId
  );
    const application =
      await Application.findById(
        applicationId
      )
        .populate("client")
        .select(
          "+preparedDataEncrypted"
        );


    if (
      !application
    ) {

      throw new Error(
        "Application not found"
      );
    }


    if (
      application.otp?.status !==
      "verified"
    ) {

      throw new Error(
        "OTP must be verified before continuing"
      );
    }


    try {

      await moveState(
        application,
        STATES.IDENTITY_PREPARATION,
        {
          event:
            "IDENTITY_VERIFICATION_STARTED"
        }
      );


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
        application.client?.facialProfile
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
          result.verified !==
          true
        ) {

          throw new Error(
            "Identity verification was not successful"
          );
        }
      }


      await moveState(
        application,
        STATES.IDENTITY_READY,
        {
          event:
            "IDENTITY_READY"
        }
      );


      await moveState(
        application,
        STATES.READY_FOR_AUTOMATION,
        {
          event:
            "AUTOMATION_READY",

          reason:
            "Identidade verificada e candidatura pronta para radar."
        }
      );


      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "ready_for_automation";


      application.bot2 =
        application.bot2 || {};


      application.bot2.status =
        "monitoring";

      application.bot2.monitoring =
        true;

      application.bot2.workerId =
        null;


      application.radar =
        application.radar || {};


      application.radar.enabled =
        true;


      await application.save();


      await this.releaseLock(
        applicationId
      );


      return application;

    } catch (
      error
    ) {

      await this.markError(
        application,
        "BOT1_IDENTITY_ERROR",
        error
      );

      throw error;
    }
  }


  /*
   * =======================================================
   * HANDLE SLOT
   * =======================================================
   */

  async handleSlot(
    applicationId,
    slotReceivedAt = null
  ) {
      await this.assertAdminRelease(
    applicationId
  );
    const startedAt =
      Date.now();


    const application =
      await this.claimSlot(
        applicationId
      );


    if (
      !application
    ) {

      return {

        success:
          false,

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

      if (
        slotReceivedAt
      ) {

        application.metrics =
          application.metrics || {};


        application.metrics.resumeMs =
          Math.max(
            0,
            Date.now() -
            new Date(
              slotReceivedAt
            ).getTime()
          );
      }


      await moveState(
        application,
        STATES.SLOT_LOCKED,
        {
          event:
            "SLOT_LOCKED"
        }
      );


      await this.heartbeat(
        applicationId,
        "slot_locked"
      );


      /*
       * ---------------------------------------------------
       * REVALIDAÇÃO
       * ---------------------------------------------------
       */

      if (
        typeof this.site.revalidateSlot ===
        "function"
      ) {

        const revalidated =
          await withTimeout(
            this.site.revalidateSlot(
              application.slot,
              application
            ),
            config.timeoutMs,
            "Slot revalidation"
          );


        if (
          revalidated?.success ===
          false
        ) {

          await moveState(
            application,
            STATES.SLOT_LOST,
            {
              event:
                "SLOT_REVALIDATION_FAILED",

              reason:
                revalidated.reason ||
                "Slot no longer available"
            }
          );


          application.status =
            "waiting_for_slot";

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "slot_lost";


          application.bot2 =
            application.bot2 || {};


          application.bot2.status =
            "monitoring";

          application.bot2.monitoring =
            true;


          application.radar =
            application.radar || {};


          application.radar.enabled =
            true;


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              false,

            slotLost:
              true,

            reason:
              revalidated.reason ||
              "Slot no longer available",

            application

          };
        }
      }


      await moveState(
        application,
        STATES.SLOT_REVALIDATED,
        {
          event:
            "SLOT_REVALIDATED"
        }
      );


      await this.refreshLock(
        applicationId
      );


      /*
       * ---------------------------------------------------
       * BOOKING
       * ---------------------------------------------------
       */

      await moveState(
        application,
        STATES.BOOKING,
        {
          event:
            "BOOKING_STARTED"
        }
      );


      application.status =
        "continuing";

      application.bot1.status =
        "continuing";

      application.bot1.lastAction =
        "selecting_slot";


      await application.save();


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
        selected?.success ===
        false
      ) {

        if (
          selected.requiresUser ===
          true
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "official_slot_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            application

          };
        }


        throw new Error(
          selected.reason ||
          "Slot selection failed"
        );
      }


      await this.refreshLock(
        applicationId
      );


      /*
       * ---------------------------------------------------
       * CONTINUE VFS
       * ---------------------------------------------------
       */

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
        continued?.success ===
        false
      ) {

        if (
          continued.requiresUser ===
          true
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "official_vfs_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            application

          };
        }


        throw new Error(
          continued.reason ||
          "Application continuation failed"
        );
      }


      await this.refreshLock(
        applicationId
      );


      /*
       * ---------------------------------------------------
       * DOCUMENT UPLOAD
       * ---------------------------------------------------
       */

      await moveState(
        application,
        STATES.DOCUMENT_UPLOAD,
        {
          event:
            "DOCUMENT_UPLOAD_STARTED"
        }
      );


      application.bot1.lastAction =
        "document_upload";


      await application.save();


      if (
        typeof this.site.uploadPassport ===
        "function"
      ) {

        const passport =
          await withTimeout(
            this.site.uploadPassport(
              application,
              application.client
            ),
            config.timeoutMs,
            "Passport upload"
          );


        if (
          passport?.success ===
            false &&
          passport?.requiresUser !==
            true
        ) {

          throw new Error(
            passport.reason ||
            "Passport upload failed"
          );
        }


        if (
          passport?.requiresUser ===
          true
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "passport_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            application

          };
        }
      }


      /*
       * ---------------------------------------------------
       * FACIAL POSITIONS
       * ---------------------------------------------------
       *
       * As 10 posições existentes no Client
       * continuam sendo a fonte oficial.
       */

      await moveState(
        application,
        STATES.FACIAL_POSITIONS,
        {
          event:
            "FACIAL_POSITIONS_STARTED"
        }
      );


      application.bot1.lastAction =
        "facial_positions";


      await application.save();


      if (
        typeof this.site.handleFacialPositionRequest ===
        "function"
      ) {

        const facialResult =
          await withTimeout(
            this.site.handleFacialPositionRequest(
              application,
              application.client
            ),
            config.timeoutMs,
            "Facial position handling"
          );


        /*
         * -------------------------------------------------
         * POSIÇÃO NÃO RESOLVIDA
         * -------------------------------------------------
         */

        if (
          facialResult?.state ===
          "FACIAL_POSITION_UNRESOLVED"
        ) {

          await moveState(
            application,
            STATES.FACIAL_POSITION_UNRESOLVED,
            {
              event:
                "FACIAL_POSITION_UNRESOLVED",

              reason:
                facialResult.reason ||
                "VFS facial request could not be mapped unambiguously."
            }
          );


          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "facial_position_unresolved";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              false,

            requiresUser:
              true,

            facialPositionUnresolved:
              true,

            candidates:
              facialResult.candidates ||
              [],

            application

          };
        }


        /*
         * -------------------------------------------------
         * POSIÇÃO RESOLVIDA
         * -------------------------------------------------
         */

        if (
          facialResult?.state ===
          "FACIAL_POSITION_RESOLVED"
        ) {

          application.facialCheckpoint =
            application.facialCheckpoint ||
            {};


          application.facialCheckpoint.position =
            facialResult.position;

          application.facialCheckpoint.label =
            facialResult.label ||
            null;

          application.facialCheckpoint.storageReference =
            facialResult.storageReference ||
            null;

          application.facialCheckpoint.score =
            facialResult.score ||
            null;

          application.facialCheckpoint.request =
            facialResult.request ||
            null;

          application.facialCheckpoint.resolvedAt =
            new Date();


          application.bot1.lastAction =
            "facial_position_resolved";


          await application.save();
        }


        /*
         * Falha real.
         */

        if (
          facialResult?.success ===
            false &&
          facialResult?.requiresUser !==
            true
        ) {

          throw new Error(
            facialResult.reason ||
            "Facial position handling failed"
          );
        }


        /*
         * Checkpoint oficial.
         */

        if (
          facialResult?.requiresUser ===
            true &&
          facialResult?.state !==
            "FACIAL_POSITION_RESOLVED"
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "facial_official_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            application

          };
        }
      }


      /*
       * ---------------------------------------------------
       * DETECTAR OTP REAL
       * ---------------------------------------------------
       */

      let checkpoint =
        null;


      if (
        typeof this.site.detectCheckpoint ===
        "function"
      ) {

        checkpoint =
          await withTimeout(
            this.site.detectCheckpoint(),
            config.timeoutMs,
            "VFS checkpoint detection"
          );
      }


      const otpRequired =
        checkpoint?.type ===
          "otp" ||

        checkpoint?.type ===
          "OTP_REQUIRED" ||

        checkpoint?.otpRequired ===
          true ||

        checkpoint?.state ===
          "OTP_REQUIRED";


      /*
       * ---------------------------------------------------
       * OTP REQUIRED
       * ---------------------------------------------------
       */

      if (
        otpRequired
      ) {

        await moveState(
          application,
          STATES.OTP_REQUIRED,
          {
            event:
              "OTP_REQUIRED",

            reason:
              checkpoint.reason ||
              "VFS presented an OTP checkpoint."
          }
        );


        const otp =
          this.otp.createRequest(
            applicationId
          );


        application.otp =
          application.otp || {};


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


        await application.save();

        await this.releaseLock(
          applicationId
        );


        return {

          success:
            true,

          otpRequired:
            true,

          application

        };
      }


      /*
       * ---------------------------------------------------
       * NO OTP
       * ---------------------------------------------------
       */

      await moveState(
        application,
        STATES.REVIEW,
        {
          event:
            "REVIEW_STARTED",

          reason:
            "VFS não apresentou checkpoint OTP nesta etapa."
        }
      );


      application.status =
        "review_pay";

      application.bot1.status =
        "running";

      application.bot1.lastAction =
        "review_pay";


      await application.save();


      return await this.processPaymentStage(
        application
      );


    } catch (
      error
    ) {

      await this.markError(
        application,
        "BOT1_BOOKING_ERROR",
        error
      );


      await this.releaseLock(
        applicationId
      );


      throw error;
    }
  }


  /*
   * =======================================================
   * PROCESS PAYMENT STAGE
   * =======================================================
   */

  async processPaymentStage(
    application
  ) {

    const applicationId =
      application._id.toString();


    await this.refreshLock(
      applicationId
    );


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


    if (
      !payment.reference &&
      typeof this.site.getReference ===
        "function"
    ) {

      payment.reference =
        await withTimeout(
          this.site.getReference(
            application
          ),
          config.timeoutMs,
          "Reference retrieval"
        ).catch(
          () =>
            null
        );
    }


    if (
      !payment.entity &&
      typeof this.site.getEntity ===
        "function"
    ) {

      payment.entity =
        await withTimeout(
          this.site.getEntity(
            application
          ),
          config.timeoutMs,
          "Entity retrieval"
        ).catch(
          () =>
            null
        );
    }


    application.result =
      application.result || {};


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


    /*
     * ---------------------------------------------------
     * PAYMENT PENDING
     * ---------------------------------------------------
     */

    if (
      isPendingPayment(
        payment
      )
    ) {

      await moveState(
        application,
        STATES.APPOINTMENT_BOOKED,
        {
          event:
            "APPOINTMENT_BOOKED_PAYMENT_PENDING"
        }
      );


      await moveState(
        application,
        STATES.PAYMENT_PENDING,
        {
          event:
            "PAYMENT_PENDING",

          reason:
            "VFS returned appointment/payment data but payment is not confirmed."
        }
      );


      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "payment_pending";


      application.bot2 =
        application.bot2 || {};


      application.bot2.monitoring =
        false;


      application.radar =
        application.radar || {};


      application.radar.enabled =
        false;


      application.lock = {

        owner:
          null,

        expiresAt:
          null

      };


      await application.save();


      return {

        success:
          true,

        paymentPending:
          true,

        requiresUser:
          false,

        payment: {

          reference:
            application.result.reference,

          entity:
            application.result.entity,

          amount:
            application.result.paymentAmount,

          currency:
            application.result.paymentCurrency,

          deadline:
            application.result.paymentDeadline,

          status:
            application.result.paymentStatus,

          confirmationUrl:
            application.result.confirmationUrl

        },

        application

      };
    }


    /*
     * ---------------------------------------------------
     * APPOINTMENT BOOKED
     * ---------------------------------------------------
     */

    await moveState(
      application,
      STATES.APPOINTMENT_BOOKED,
      {
        event:
          "APPOINTMENT_BOOKED"
      }
    );


    await this.refreshLock(
      applicationId
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
      finalization?.success ===
      false
    ) {

      if (
        finalization.requiresUser ===
        true
      ) {

        application.bot1.status =
          "waiting";

        application.bot1.lastAction =
          "official_vfs_checkpoint";


        await application.save();

        await this.releaseLock(
          applicationId
        );


        return {

          success:
            true,

          requiresUser:
            true,

          officialCheckpoint:
            true,

          application

        };
      }


      throw new Error(
        finalization.reason ||
        "Booking finalization failed"
      );
    }


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


    return await this.completeFromConfirmation(
      application,
      confirmation
    );
  }


  /*
   * =======================================================
   * FINALIZE AFTER OTP
   * =======================================================
   */

  async finalizeAfterOtp(
    applicationId
  ) {
     await this.assertAdminRelease(
    applicationId
  );
    const application =
      await Application.findById(
        applicationId
      )
        .populate("client")
        .select(
          "+preparedDataEncrypted"
        );


    if (
      !application
    ) {

      throw new Error(
        "Application not found"
      );
    }


    if (
      application.otp?.status !==
      "verified"
    ) {

      throw new Error(
        "OTP must be verified before finalization"
      );
    }


    try {

      await moveState(
        application,
        STATES.OTP_SUBMITTING,
        {
          event:
            "OTP_SUBMITTING"
        }
      );


      application.bot1.status =
        "running";

      application.bot1.lastAction =
        "submitting_otp";


      await application.save();


      const otpCode =
        application.otp?.code ||
        application.otp?.value ||
        null;


      if (
        typeof this.site.submitOtp ===
        "function"
      ) {

        const otpResult =
          await withTimeout(
            this.site.submitOtp(
              otpCode
            ),
            config.timeoutMs,
            "VFS OTP submission"
          );


        if (
          otpResult?.success ===
            false &&
          otpResult?.requiresUser !==
            true
        ) {

          throw new Error(
            otpResult.reason ||
            "VFS OTP submission failed"
          );
        }


        if (
          otpResult?.requiresUser ===
          true
        ) {

          application.bot1.status =
            "waiting";

          application.bot1.lastAction =
            "otp_official_checkpoint";


          await application.save();

          await this.releaseLock(
            applicationId
          );


          return {

            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            application

          };
        }
      }


      await moveState(
        application,
        STATES.OTP_VERIFIED,
        {
          event:
            "OTP_VERIFIED"
        }
      );


      await moveState(
        application,
        STATES.REVIEW,
        {
          event:
            "REVIEW_STARTED"
        }
      );


      application.status =
        "review_pay";

      application.bot1.lastAction =
        "review_pay";


      await application.save();


      return await this.processPaymentStage(
        application
      );

    } catch (
      error
    ) {

      await this.markError(
        application,
        "BOT1_FINALIZATION_ERROR",
        error
      );


      await this.releaseLock(
        applicationId
      );


      throw error;
    }
  }


  /*
   * =======================================================
   * COMPLETE FROM CONFIRMATION
   * =======================================================
   */

  async completeFromConfirmation(
    application,
    confirmation
  ) {

    const normalized =
      normalizePaymentDetails(
        confirmation || {}
      );


    application.result =
      application.result || {};


    if (
      normalized.reference
    ) {

      application.result.reference =
        normalized.reference;
    }


    if (
      normalized.entity
    ) {

      application.result.entity =
        normalized.entity;
    }


    if (
      normalized.transactionId
    ) {

      application.result.transactionId =
        normalized.transactionId;
    }


    if (
      normalized.paymentStatus
    ) {

      application.result.paymentStatus =
        normalized.paymentStatus;
    }


    if (
      normalized.confirmationUrl
    ) {

      application.result.confirmationUrl =
        normalized.confirmationUrl;
    }


    const confirmed =
      confirmation?.confirmed ===
        true ||

      confirmation?.success ===
        true ||

      isPaidStatus(
        confirmation?.paymentStatus
      );


    if (
      !confirmed
    ) {

      await moveState(
        application,
        STATES.PAYMENT_PENDING,
        {
          event:
            "PAYMENT_CONFIRMATION_PENDING",

          reason:
            "Payment was not independently confirmed."
        }
      );


      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "payment_pending";


      application.lock = {

        owner:
          null,

        expiresAt:
          null

      };


      await application.save();


      return {

        success:
          true,

        paymentPending:
          true,

        requiresUser:
          false,

        application

      };
    }


    await moveState(
      application,
      STATES.PAYMENT_CONFIRMED,
      {
        event:
          "PAYMENT_CONFIRMED"
      }
    );


    await moveState(
      application,
      STATES.COMPLETED,
      {
        event:
          "APPLICATION_COMPLETED"
      }
    );


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


    application.bot2 =
      application.bot2 || {};


    application.bot2.monitoring =
      false;


    application.radar =
      application.radar || {};


    application.radar.enabled =
      false;


    application.lock = {

      owner:
        null,

      expiresAt:
        null

    };


    application.metrics =
      application.metrics || {};


    application.metrics.completionMs =
      Date.now() -
      Number(
        application.bot1.lastAttemptAt
          ? new Date(
              application.bot1.lastAttemptAt
            ).getTime()
          : Date.now()
      );


    await application.save();


    return {

      success:
        true,

      completed:
        true,

      application

    };
  }


  /*
   * =======================================================
   * ERROR
   * =======================================================
   */

  async markError(
    application,
    code,
    error
  ) {

    const current =
      getWorkflowState(
        application
      );


    /*
     * PAYMENT_PENDING não é erro.
     */

    if (
      current ===
      STATES.PAYMENT_PENDING
    ) {

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "payment_pending";


      application.lock = {

        owner:
          null,

        expiresAt:
          null

      };


      await application.save();

      return;
    }


    application.status =
      "error";

    application.bot1.status =
      "error";

    application.bot1.lastAction =
      code;


    application.error =
      application.error || {};


    application.error.code =
      code;

    application.error.message =
      error?.message ||
      "Unknown Bot 1 error";

    application.error.at =
      new Date();

    application.error.attempts =
      Number(
        application.error.attempts || 0
      ) + 1;


    try {

      if (
        getWorkflowState(
          application
        ) !==
        STATES.ERROR
      ) {

        await moveState(
          application,
          STATES.ERROR,
          {
            event:
              "BOT1_ERROR",

            reason:
              error?.message ||
              code
          }
        );
      }

    } catch {

      application.workflowState =
        STATES.ERROR;
    }


    application.lock = {

      owner:
        null,

      expiresAt:
        null

    };


    application.bot2 =
      application.bot2 || {};


    application.bot2.monitoring =
      false;


    application.radar =
      application.radar || {};


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
          application.error.attempts,

        error:
          error?.message

      }
    );
  }
}


module.exports =
  Bot1;
