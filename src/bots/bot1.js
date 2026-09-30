"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Application = require("../models/application");
const OtpService = require("../services/otp/otp-service");
const FacialService = require("../services/facial/facial-service");
const PassportStorageService = require(
  "../services/passport/passport-storage-service"
);

const VfsNavigator = require(
  "../services/vfs/vfs-navigator"
);
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

  this.passportStorage =
    new PassportStorageService();

  /*
   * Cada Bot 1 possui o seu próprio Navigator.
   *
   * O Navigator fica preso ao applicationId do
   * adapter e nunca pode operar outra candidatura.
   *
   * Isto é importante quando começarmos a executar
   * várias candidaturas simultaneamente.
   */
  this.navigator =
    site?.applicationId
      ? new VfsNavigator(
          site,
          {
            applicationId:
              site.applicationId,
            logger
          }
        )
      : null;
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

  ready_for_automation:
    STATES.READY_FOR_AUTOMATION,

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

  async waitForOtpCodeWithLock(
    applicationId,
    request
  ) {

    const heartbeatIntervalMs =
      Math.max(
        5000,
        Math.floor(
          config.lockMs / 2
        )
      );

    let heartbeatTimer =
      null;

    try {

      await this.refreshLock(
        applicationId
      );

      heartbeatTimer =
        setInterval(
          () => {

            this.refreshLock(
              applicationId
            ).catch(
              () => {}
            );

          },
          heartbeatIntervalMs
        );

      return await this.otp.waitForCode(
        request
      );

    } finally {

      if (
        heartbeatTimer
      ) {
        clearInterval(
          heartbeatTimer
        );
      }

    }
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
   
    try {
    const startedAt =
      Date.now();

    const application =
  await this.claimApplication(
    applicationId,
    [
      "created",
      "error",
      "ready_for_automation"
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
    const wasAlreadyReadyForAutomation =
  application.workflowState ===
  STATES.READY_FOR_AUTOMATION;

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

  application.workflow =
  application.workflow ||
  {};

application.workflow.lastEvent =
  "BOT1_AUTOMATION_STARTED";

application.workflow.lastReason =
  "Bot 1 iniciou a automação de uma candidatura liberada pelo administrador.";

application.workflow.stateChangedAt =
  new Date();


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

logger.info(
  "BOT1 SITE INITIALIZATION STARTING",
  {
    applicationId:
      application._id?.toString(),

    workflowState:
      application.workflowState,

    reason:
      "Bot 1 vai inicializar o adaptador VFS."
  }
);

await withTimeout(
  this.site.initialize(),
  config.timeoutMs,
  "Site initialization"
);

logger.info(
  "BOT1 SITE INITIALIZATION COMPLETED",
  {
    applicationId:
      application._id?.toString(),

    workflowState:
      application.workflowState,

    reason:
      "Adaptador VFS inicializado com sucesso."
  }
);

logger.info(
  "BOT1 VFS SESSION STARTING",
  {
    applicationId:
      application._id?.toString(),

    workflowState:
      application.workflowState,

    reason:
      "Bot 1 vai iniciar a sessão VFS."
  }
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
            "VFS_SESSION_STARTED",

          reason:
            "Bot 1 abriu a sessão de automação da VFS."
        }
      );


      await application.save();


      logger.info(
        "BOT1 VFS SESSION STARTED",
        {
          applicationId:
            application._id?.toString(),

          workflowState:
            application.workflowState,

          reason:
            "Sessão VFS iniciada; próximo passo será autenticação."
        }
      );


      await moveState(
        application,
        STATES.VFS_AUTHENTICATING,
        {
          event:
            "VFS_AUTHENTICATION_STARTED",

          reason:
            "Bot 1 iniciou a autenticação na sessão VFS."
        }
      );


      await application.save();


      logger.info(
        "BOT1 VFS AUTHENTICATION STARTED",
        {
          applicationId:
            application._id?.toString(),

          workflowState:
            application.workflowState,

          reason:
            "Bot 1 vai localizar o formulário e tentar autenticar na VFS."
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
  STATES.RADAR_ACTIVE,
  {
    event:
      "RADAR_ACTIVATED",

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
   * PREPARAR PASSAPORTE PARA O VFS
   * =======================================================
   *
   * O sistema guarda o passaporte de forma criptografada
   * no PassportDocument.
   *
   * O Puppeteer, por sua vez, precisa de um caminho físico
   * para input.uploadFile().
   *
   * Aqui fazemos a ponte:
   *
   * MongoDB criptografado
   *        ↓
   * PassportStorageService
   *        ↓
   * Buffer
   *        ↓
   * ficheiro temporário
   *        ↓
   * VFS Puppeteer adapter
   *
   * O ficheiro temporário é removido depois do upload.
   */
  async preparePassportFile(
    application
  ) {

    if (!application) {
      throw new Error(
        "Application is required to prepare passport."
      );
    }

    const applicationId =
      application._id?.toString?.();

    if (!applicationId) {
      throw new Error(
        "Application ID is required to prepare passport."
      );
    }

    const clientId =
      application.client?._id?.toString?.() ||
      application.client?.toString?.();

    if (!clientId) {
      throw new Error(
        "Client ID is required to retrieve passport."
      );
    }

    if (
      !application.accountId
    ) {
      throw new Error(
        "Application accountId is required to retrieve passport."
      );
    }

    const stored =
      await this.passportStorage.getForBot({
        accountId:
          application.accountId,

        clientId
      });

    if (!stored) {
      throw new Error(
        "Verified passport document was not found for this application."
      );
    }

    if (
      !Buffer.isBuffer(
        stored.buffer
      ) ||
      !stored.buffer.length
    ) {
      throw new Error(
        "Stored passport document is empty."
      );
    }

    const extension =
      stored.mimeType ===
      "image/png"
        ? ".png"
        : ".jpg";

    const directory =
      await fs.promises.mkdtemp(
        path.join(
          os.tmpdir(),
          "travel-passport-"
        )
      );

    const filePath =
      path.join(
        directory,
        `passport-${applicationId}${extension}`
      );

    await fs.promises.writeFile(
      filePath,
      stored.buffer
    );

    return {
      filePath,

      directory,

      documentId:
        stored.documentId,

      mimeType:
        stored.mimeType,

      originalName:
        stored.originalName,

      sha256:
        stored.sha256
    };
  }


  /*
   * =======================================================
   * LIMPAR PASSAPORTE TEMPORÁRIO
   * =======================================================
   */
  async cleanupPassportFile(
    passportFile
  ) {

    if (!passportFile) {
      return;
    }

    try {

      if (
        passportFile.filePath
      ) {
        await fs.promises.rm(
          passportFile.filePath,
          {
            force: true
          }
        );
      }

      if (
        passportFile.directory
      ) {
        await fs.promises.rm(
          passportFile.directory,
          {
            recursive: true,
            force: true
          }
        );
      }

    } catch (
      error
    ) {

      logger.warn(
        "Temporary passport cleanup failed",
        {
          filePath:
            passportFile.filePath ||
            null,

          error:
            error.message
        }
      );
    }
  }
    /*
   * =======================================================
   * NAVIGATOR - CÉREBRO CENTRAL
   * =======================================================
   *
   * Esta função não substitui os executores especializados
   * do Bot 1.
   *
   * O Navigator observa a VFS, identifica o estado e decide
   * qual executor deve atuar.
   *
   * Cada candidatura possui o seu próprio Navigator.
   */

  async driveWithNavigator(
    application,
    options = {}
  ) {

    if (
      !application
    ) {

      throw new Error(
        "Navigator requires an application."
      );
    }

    if (
      !this.navigator
    ) {

      throw new Error(
        "Navigator is not initialized for this application."
      );
    }

    const applicationId =
      application._id?.toString?.() ||
      application.id?.toString?.();

    if (
      !applicationId
    ) {

      throw new Error(
        "Navigator requires a valid applicationId."
      );
    }

    /*
     * -------------------------------------------------------
     * GARANTIR ISOLAMENTO
     * -------------------------------------------------------
     */

    if (
      String(
        this.navigator.applicationId
      ) !==
      String(
        applicationId
      )
    ) {

      throw new Error(
        `Navigator/application mismatch: navigator=${this.navigator.applicationId} application=${applicationId}`
      );
    }

    /*
     * -------------------------------------------------------
     * EXECUTORES
     * -------------------------------------------------------
     *
     * O Navigator decide.
     *
     * O Adapter executa as operações específicas da VFS.
     *
     * Não duplicamos os seletores aqui.
     */

    const executors = {

      /*
       * ---------------------------------------------------
       * LOGIN
       * ---------------------------------------------------
       */

      LOGIN:
        async (
          app
        ) => {

          await this.assertAdminRelease(
            applicationId
          );

          await this.heartbeat(
            applicationId,
            "navigator_login"
          );

          const result =
            await withTimeout(
              this.site.login(
                app
              ),
              config.timeoutMs,
              "Navigator VFS login"
            );

          /*
           * CAPTCHA oficial
           */

          if (
            result?.state ===
            "CAPTCHA_REQUIRED" ||
            result?.checkpoint?.type ===
            "CAPTCHA_REQUIRED"
          ) {

            app.bot1.status =
              "waiting";

            app.bot1.lastAction =
              "captcha_required";

            await moveState(
              app,
              STATES.CAPTCHA_REQUIRED,
              {
                event:
                  "NAVIGATOR_CAPTCHA_REQUIRED",

                reason:
                  result.reason ||
                  "Official VFS CAPTCHA checkpoint."
              }
            );

            await app.save();

            return {
              success:
                true,

              requiresUser:
                true,

              officialCheckpoint:
                true,

              checkpoint:
                result.checkpoint ||
                {
                  type:
                    "CAPTCHA_REQUIRED"
                }
            };
          }

          if (
            result?.success ===
            false
          ) {

            throw new Error(
              result.reason ||
              "Navigator VFS login failed."
            );
          }

          await this.refreshLock(
            applicationId
          );

          return (
            result || {
              success:
                true
            }
          );
        },


      /*
       * ---------------------------------------------------
       * OTP
       * ---------------------------------------------------
       *
       * O tratamento automático do OTP continua sendo
       * responsabilidade do Bot 1.
       *
       * Não tentamos contornar nenhum checkpoint.
       */

      HANDLE_OTP:
        async (
          app
        ) => {

          await this.assertAdminRelease(
            applicationId
          );

          await this.heartbeat(
            applicationId,
            "navigator_otp"
          );

          /*
           * Se o OTP já foi verificado, não repetimos.
           */

          if (
            app.otp?.status ===
            "verified"
          ) {

            return {
              success:
                true
            };
          }

          /*
           * O fluxo especializado de OTP do Bot 1
           * continuará sendo usado pelo prepare/verifyOtp.
           *
           * Aqui o Navigator apenas informa ao supervisor
           * que a página está num checkpoint oficial.
           */

          app.bot1.status =
            "waiting";

          app.bot1.lastAction =
            "otp_required";

          await moveState(
            app,
            STATES.OTP_REQUIRED,
            {
              event:
                "NAVIGATOR_OTP_REQUIRED",

              reason:
                "VFS requested an OTP verification code."
            }
          );

          await app.save();

          return {
            success:
              true,

            requiresUser:
              true,

            officialCheckpoint:
              true,

            checkpoint:
              {
                type:
                  "OTP_REQUIRED"
              }
          };
        },


      /*
       * ---------------------------------------------------
       * NOVA CANDIDATURA
       * ---------------------------------------------------
       */

      START_NEW_BOOKING:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_new_booking"
          );

          return {
            success:
              true
          };
        },


      /*
       * ---------------------------------------------------
       * FORMULÁRIO
       * ---------------------------------------------------
       */

      INSPECT_BOOKING_FORM:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_booking_form"
          );

          return {
            success:
              true
          };
        },


      /*
       * ---------------------------------------------------
       * CENTRO
       * ---------------------------------------------------
       */

      SET_CENTER:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_center"
          );

          return await withTimeout(
            this.site.continueApplication(
              app,
              app.client
            ),
            config.timeoutMs,
            "Navigator center continuation"
          );
        },


      /*
       * ---------------------------------------------------
       * TIPO DE VISTO
       * ---------------------------------------------------
       */

      SET_VISA_TYPE:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_visa_type"
          );

          return await withTimeout(
            this.site.continueApplication(
              app,
              app.client
            ),
            config.timeoutMs,
            "Navigator visa type continuation"
          );
        },


      /*
       * ---------------------------------------------------
       * DISPONIBILIDADE
       * ---------------------------------------------------
       */

      CHECK_AVAILABILITY:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_check_availability"
          );

          const result =
            await withTimeout(
              this.site.checkAvailability(
                app
              ),
              config.timeoutMs,
              "Navigator availability check"
            );

          if (
            result?.requiresUser ===
            true
          ) {

            return result;
          }

          const slots =
            Array.isArray(
              result?.slots
            )
              ? result.slots
              : [];

          /*
           * Sem vaga:
           *
           * Navigator não bloqueia esta candidatura.
           * O Radar/Bot 2 assume.
           */

          if (
            !slots.length
          ) {

            return {
              success:
                true,

              noAvailability:
                true,

              handoffToRadar:
                true
            };
          }

          /*
           * Escolhemos a primeira vaga que o Adapter
           * considerou válida.
           */

          app.slot =
            slots[0];

          return {
            success:
              true,

            slot:
              app.slot,

            slots
          };
        },


      /*
       * ---------------------------------------------------
       * PAYMENT METHOD / CONTINUE
       * ---------------------------------------------------
       */

      CONTINUE:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_continue"
          );

          return await withTimeout(
            this.site.continueApplication(
              app,
              app.client
            ),
            config.timeoutMs,
            "Navigator continue"
          );
        },


      /*
       * ---------------------------------------------------
       * UPLOAD PASSAPORTE
       * ---------------------------------------------------
       *
       * Não duplicamos a lógica de armazenamento seguro.
       */

      UPLOAD_PASSPORT:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_passport_upload"
          );

          let passportFile =
            null;

          try {

            passportFile =
              await this.preparePassportFile(
                app
              );

            const result =
              await withTimeout(
                this.site.uploadPassport(
                  passportFile.filePath,
                  {
                    applicationId,

                    clientId:
                      app.client?._id?.toString?.() ||
                      app.client?.toString?.() ||
                      null,

                    documentId:
                      passportFile.documentId,

                    mimeType:
                      passportFile.mimeType,

                    originalName:
                      passportFile.originalName,

                    sha256:
                      passportFile.sha256
                  }
                ),
                config.timeoutMs,
                "Navigator passport upload"
              );

            return (
              result || {
                success:
                  true
              }
            );

          } finally {

            await this.cleanupPassportFile(
              passportFile
            );
          }
        },


      /*
       * ---------------------------------------------------
       * DADOS DO REQUERENTE
       * ---------------------------------------------------
       */

      FILL_DETAILS:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_fill_details"
          );

          return await withTimeout(
            this.site.continueApplication(
              app,
              app.client
            ),
            config.timeoutMs,
            "Navigator applicant details"
          );
        },


      /*
       * ---------------------------------------------------
       * FACIAL
       * ---------------------------------------------------
       *
       * A lógica de 10 posições continua no Bot 1.
       * O Navigator não substitui a máquina de liveness.
       */

      HANDLE_FACIAL:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_facial"
          );

          return {
            success:
              true,

            delegated:
              true,

            stage:
              "FACIAL"
          };
        },


      /*
       * ---------------------------------------------------
       * CALENDÁRIO
       * ---------------------------------------------------
       */

      SELECT_SLOT:
        async (
          app
        ) => {

          if (
            !app.slot
          ) {

            const availability =
              await this.site.checkAvailability(
                app
              );

            const slots =
              availability?.slots ||
              [];

            if (
              !slots.length
            ) {

              return {
                success:
                  true,

                noAvailability:
                  true,

                handoffToRadar:
                  true
              };
            }

            app.slot =
              slots[0];
          }

          /*
           * Revalidar antes de selecionar.
           */

          if (
            typeof this.site.revalidateSlot ===
            "function"
          ) {

            const revalidated =
              await this.site.revalidateSlot(
                app.slot,
                app
              );

            if (
              revalidated?.success ===
              false
            ) {

              return {
                success:
                  false,

                slotLost:
                  true,

                slot:
                  app.slot,

                reason:
                  revalidated.reason ||
                  "Selected appointment slot is no longer available."
              };
            }
          }

          const selected =
            await withTimeout(
              this.site.selectSlot(
                app.slot,
                app
              ),
              config.timeoutMs,
              "Navigator slot selection"
            );

          return (
            selected || {
              success:
                true,

              slot:
                app.slot
            }
          );
        },


      /*
       * ---------------------------------------------------
       * OPÇÕES DA REVISÃO
       * ---------------------------------------------------
       *
       * Mantemos a seleção especializada existente no
       * Adapter. O Navigator apenas continua depois.
       */

      SELECT_REVIEW_OPTIONS:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_review"
          );

          return await withTimeout(
            this.site.continueApplication(
              app,
              app.client
            ),
            config.timeoutMs,
            "Navigator review continuation"
          );
        },


      /*
       * ---------------------------------------------------
       * PAGAMENTO
       * ---------------------------------------------------
       *
       * Apenas extrair.
       *
       * NÃO PAGAR.
       */

      EXTRACT_PAYMENT:
        async (
          app
        ) => {

          await this.heartbeat(
            applicationId,
            "navigator_extract_payment"
          );

          const payment =
            await withTimeout(
              this.site.getPaymentDetails(
                app,
                app.client
              ),
              config.timeoutMs,
              "Navigator payment extraction"
            );

          app.result =
            app.result || {};

          app.result.reference =
            payment?.reference ||
            null;

          app.result.entity =
            payment?.entity ||
            null;

          app.result.paymentAmount =
            payment?.amount ||
            null;

          app.result.paymentCurrency =
            payment?.currency ||
            null;

          app.result.paymentStatus =
            payment?.paymentStatus ||
            null;

          app.result.paymentDeadline =
            payment?.deadline ||
            null;

          await app.save();

          return {
            success:
              true,

            payment
          };
        },


      /*
       * ---------------------------------------------------
       * REINSPECTION
       * ---------------------------------------------------
       */

      REINSPECT:
        async () => {

          await this.heartbeat(
            applicationId,
            "navigator_reinspect"
          );

          return {
            success:
              true
          };
        }

    };

    /*
     * -------------------------------------------------------
     * EXECUTAR O CÉREBRO
     * -------------------------------------------------------
     */

    const result =
      await this.navigator.drive(
        application,
        executors,
        {
          maxSteps:
            options.maxSteps ||
            40,

          sameStateLimit:
            options.sameStateLimit ||
            4,

          stepDelayMs:
            options.stepDelayMs ||
            300
        }
      );

    /*
     * -------------------------------------------------------
     * RESULTADO DO NAVIGATOR
     * -------------------------------------------------------
     */

    if (
      result?.requiresUser ===
      true
    ) {

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "navigator_checkpoint";

      await application.save();

      await this.releaseLock(
        applicationId
      );

      return result;
    }

    if (
      result?.handoffToRadar ===
      true
    ) {

      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "navigator_handoff_radar";

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

      return result;
    }

    if (
      result?.completed ===
      true
    ) {

      application.bot1.lastAction =
        "navigator_completed";

      await application.save();

      return result;
    }

    if (
      result?.success ===
      false
    ) {

      throw new Error(
        result.reason ||
        "Navigator failed to advance the VFS workflow."
      );
    }

    return result;
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
 * REVALIDAÇÃO + RECUPERAÇÃO INTELIGENTE DO SLOT
 * ---------------------------------------------------
 *
 * O Navigator é responsável por recuperar uma vaga
 * que desapareceu depois de ter sido encontrada pelo
 * Bot 2/Radar.
 *
 * Fluxo:
 *
 * Bot 2 encontra vaga
 *        ↓
 * Bot 1 recebe vaga
 *        ↓
 * revalida
 *        ↓
 * vaga desapareceu?
 *        ↓
 * Navigator procura outra
 *        ↓
 * outra hora no mesmo dia
 *        ↓
 * outro dia
 *        ↓
 * se não houver nenhuma → Bot 2/Radar
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

  /*
   * -------------------------------------------------
   * SLOT PERDIDO
   * -------------------------------------------------
   */

  if (
    revalidated?.success ===
    false
  ) {

    await moveState(
      application,
      STATES.SLOT_LOST,
      {
        event:
          "SLOT_LOST",

        reason:
          revalidated.reason ||
          "The selected VFS slot is no longer available."
      }
    );

    application.bot1.lastAction =
      "slot_lost_navigator";

    application.bot1.status =
      "continuing";

    await application.save();

    /*
     * -------------------------------------------------
     * NAVIGATOR RECOVERY
     * -------------------------------------------------
     *
     * O Navigator:
     *
     * 1. volta a verificar disponibilidade;
     * 2. ignora a vaga perdida;
     * 3. tenta outra hora no mesmo dia;
     * 4. depois tenta outro dia;
     * 5. só entrega ao Radar quando realmente
     *    não existir alternativa.
     */

    if (
      this.navigator &&
      typeof this.navigator.handleSlotLoss ===
      "function"
    ) {

      logger.warn(
        "BOT1 SLOT LOST - NAVIGATOR RECOVERY STARTING",
        {
          applicationId:
            applicationId,

          failedSlot:
            application.slot || null,

          reason:
            revalidated.reason ||
            "Selected slot is no longer available."
        }
      );

      const recovery =
        await withTimeout(
          this.navigator.handleSlotLoss(
            application,
            application.slot
          ),
          config.timeoutMs * 5,
          "Navigator slot recovery"
        );

      /*
       * -------------------------------------------------
       * RECUPEROU OUTRA VAGA
       * -------------------------------------------------
       */

      if (
        recovery?.slotRecovered ===
        true
      ) {

        application.slot =
          recovery.slot ||
          application.slot;

        application.status =
          "continuing";

        application.bot1.status =
          "continuing";

        application.bot1.lastAction =
          "navigator_slot_recovered";

        application.bot2 =
          application.bot2 ||
          {};

        application.bot2.status =
          "inactive";

        application.bot2.monitoring =
          false;

        application.radar =
          application.radar ||
          {};

        application.radar.enabled =
          false;

        await moveState(
          application,
          STATES.SLOT_REVALIDATED,
          {
            event:
              "NAVIGATOR_SLOT_RECOVERED",

            reason:
              "Navigator recovered an alternative appointment slot.",

            slot:
              application.slot
          }
        );

        await application.save();

        await this.refreshLock(
          applicationId
        );

        await this.heartbeat(
          applicationId,
          "navigator_slot_recovered"
        );

        logger.info(
          "BOT1 NAVIGATOR RECOVERED ALTERNATIVE SLOT",
          {
            applicationId:
              applicationId,

            slot:
              application.slot,

            attempts:
              recovery.attempts || 0
          }
        );

        /*
         * IMPORTANTE:
         *
         * Não fazemos return aqui.
         *
         * O Bot 1 continua o mesmo processo
         * usando a nova vaga recuperada.
         */
      }

      /*
       * -------------------------------------------------
       * CHECKPOINT OFICIAL
       * -------------------------------------------------
       */

      else if (
        recovery?.requiresUser ===
        true
      ) {

        application.bot1.status =
          "waiting";

        application.bot1.lastAction =
          "navigator_checkpoint";

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

          checkpoint:
            recovery.checkpoint ||
            null,

          application
        };
      }

      /*
       * -------------------------------------------------
       * SEM VAGA → RADAR/BOT 2
       * -------------------------------------------------
       */

      else {

        application.status =
          "waiting_for_slot";

        application.bot1.status =
          "waiting";

        application.bot1.lastAction =
          "navigator_handoff_radar";

        application.bot2 =
          application.bot2 ||
          {};

        application.bot2.status =
          "monitoring";

        application.bot2.monitoring =
          true;

        application.radar =
          application.radar ||
          {};

        application.radar.enabled =
          true;

        await application.save();

        await this.releaseLock(
          applicationId
        );

        logger.info(
          "BOT1 NAVIGATOR HANDOFF TO RADAR",
          {
            applicationId:
              applicationId,

            reason:
              recovery?.reason ||
              "Navigator found no alternative appointment slot."
          }
        );

        return {
          success:
            false,

          slotLost:
            true,

          handoffToRadar:
            true,

          reason:
            recovery?.reason ||
            "No alternative appointment slot is currently available.",

          application
        };
      }
    }

    /*
     * -------------------------------------------------
     * FALLBACK
     * -------------------------------------------------
     *
     * Se por algum motivo o Navigator não existir,
     * mantemos o comportamento seguro anterior.
     */

    else {

      application.status =
        "waiting_for_slot";

      application.bot1.status =
        "waiting";

      application.bot1.lastAction =
        "slot_lost";

      application.bot2 =
        application.bot2 ||
        {};

      application.bot2.status =
        "monitoring";

      application.bot2.monitoring =
        true;

      application.radar =
        application.radar ||
        {};

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

        handoffToRadar:
          true,

        reason:
          revalidated.reason ||
          "Selected VFS slot is no longer available.",

        application
      };
    }
  }
}

/*
 * ---------------------------------------------------
 * SLOT CONFIRMADO
 * ---------------------------------------------------
 */

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

  let passportFile =
    null;

  try {

    passportFile =
      await this.preparePassportFile(
        application
      );

    logger.info(
      "Verified passport prepared for VFS upload",
      {
        applicationId:
          applicationId,

        documentId:
          passportFile.documentId,

        mimeType:
          passportFile.mimeType
      }
    );

    const passport =
      await withTimeout(
        this.site.uploadPassport(
          passportFile.filePath,
          {
            applicationId,

            clientId:
              application.client?._id?.toString?.() ||
              application.client?.toString?.() ||
              null,

            documentId:
              passportFile.documentId,

            mimeType:
              passportFile.mimeType,

            originalName:
              passportFile.originalName,

            sha256:
              passportFile.sha256
          }
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

  } finally {

    await this.cleanupPassportFile(
      passportFile
    );
  }
}

        /*
       * ---------------------------------------------------
       * CONTACT DETAILS APÓS EXTRAÇÃO DO PASSAPORTE
       * ---------------------------------------------------
       *
       * A VFS já extraiu os dados do passaporte.
       *
       * O Bot1 altera somente:
       * - Country code: 244
       * - Phone: 9XXXXXXXX
       * - Email: agendamentov001@gmail.com
       */

      if (
        typeof this.site.fillVfsContactDetails ===
        "function"
      ) {

        const contactDetails =
          await withTimeout(
            this.site.fillVfsContactDetails(
              application
            ),
            config.timeoutMs,
            "VFS contact details"
          );

        if (
          contactDetails?.success ===
          false
        ) {

          if (
            contactDetails.requiresUser ===
            true
          ) {

            application.bot1.status =
              "waiting";

            application.bot1.lastAction =
              "vfs_contact_details_checkpoint";

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
                false,

              application
            };
          }

          throw new Error(
            contactDetails.reason ||
            "VFS contact details could not be filled."
          );
        }

        /*
         * Guardamos apenas os dados que o Bot1
         * realmente adicionou.
         */
        application.vfsContact =
          application.vfsContact ||
          {};

        application.vfsContact.countryCode =
          "244";

        application.vfsContact.phone =
          contactDetails.phone;

        application.vfsContact.email =
          "agendamentov001@gmail.com";

        application.bot1.lastAction =
          "vfs_contact_details_filled";

        await application.save();

        await this.refreshLock(
          applicationId
        );
      }

  /*
 * ---------------------------------------------------
 * FACIAL POSITIONS
 * ---------------------------------------------------
 *
 * A VFS abre a câmera uma única vez e pode solicitar
 * qualquer quantidade de posições.
 *
 * Não assumimos 4 posições.
 *
 * A sequência termina quando a VFS deixa de apresentar
 * uma instrução facial concreta.
 *
 * Uma nova instrução significa que a instrução anterior
 * foi aceita pela VFS.
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
  typeof this.site.processFacialVfsInstruction ===
  "function"
) {

  const facialStartedAt =
    Date.now();

  /*
   * Tempo máximo da etapa facial.
   *
   * Não limita a quantidade de posições.
   * Apenas evita que o Bot 1 fique preso
   * indefinidamente caso a página da VFS
   * não responda.
   */
  const facialTimeoutMs =
    Math.max(
      config.timeoutMs * 6,
      180000
    );

  let noInstructionCount =
    0;

  let lastProcessedPosition =
    null;

  let facialCompleted =
    false;


  while (
    Date.now() -
      facialStartedAt <
    facialTimeoutMs
  ) {

    await this.refreshLock(
      applicationId
    );

    await this.heartbeat(
      applicationId,
      "facial_vfs_instruction"
    );


    const facialResult =
      await withTimeout(
        this.site.processFacialVfsInstruction(
          application,
          application.client
        ),
        config.timeoutMs,
        "Facial VFS instruction handling"
      );


    /*
     * -------------------------------------------------
     * CÂMERA AINDA NÃO ABRIU
     * -------------------------------------------------
     */

    if (
      facialResult?.waitingForCamera ===
      true
    ) {

      application.bot1.lastAction =
        "waiting_for_vfs_camera";

      await application.save();

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;
    }


    /*
     * -------------------------------------------------
     * VFS AINDA NÃO MOSTROU A INSTRUÇÃO
     * -------------------------------------------------
     */

    if (
      facialResult?.waitingForInstruction ===
      true
    ) {

      noInstructionCount += 1;

      application.bot1.lastAction =
        "waiting_for_facial_instruction";

      await application.save();


      /*
       * Uma ausência isolada não significa
       * que a etapa terminou.
       *
       * A página pode estar atualizando o DOM.
       */
      if (
        noInstructionCount < 3
      ) {

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1200
            )
        );

        continue;
      }


      /*
       * Depois de várias leituras sem instrução,
       * verificamos novamente o checkpoint oficial.
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
            "Facial completion checkpoint detection"
          );
      }


      /*
       * Se a VFS já não está numa etapa facial,
       * a sequência terminou.
       */
      if (
        !checkpoint ||
        checkpoint.type !==
          "FACIAL_POSITION"
      ) {

        facialCompleted =
          true;

        break;
      }


      /*
       * Ainda está na etapa facial.
       * Voltamos a aguardar.
       */
      noInstructionCount =
        0;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;
    }


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
     * POSIÇÃO JÁ PROCESSADA
     * -------------------------------------------------
     */

    if (
      facialResult?.state ===
      "FACIAL_POSITION_ALREADY_ACCEPTED"
    ) {

      /*
       * Não falhamos a candidatura.
       *
       * A VFS pode repetir uma instrução que já
       * foi processada.
       */

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1200
          )
      );

      continue;
    }


    /*
     * -------------------------------------------------
     * NOVO VÍDEO ATIVO
     * -------------------------------------------------
     */

    if (
      facialResult?.state ===
      "FACIAL_POSITION_VIDEO_ACTIVE"
    ) {

      noInstructionCount =
        0;

      const currentPosition =
        Number(
          facialResult.position
        );


      /*
       * Guardamos no documento da candidatura
       * a posição que está sendo apresentada.
       */

      application.facialCheckpoint =
        application.facialCheckpoint ||
        {};


      application.facialCheckpoint.position =
        currentPosition;

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

      application.facialCheckpoint.videoId =
        facialResult.videoId ||
        null;

      application.facialCheckpoint.resolvedAt =
        new Date();


      application.bot1.lastAction =
        "facial_video_active";


      await application.save();


      lastProcessedPosition =
        currentPosition;


      /*
       * O método processFacialVfsInstruction()
       * já deixou o vídeo correto no mesmo
       * MediaStream.
       *
       * Agora NÃO fazemos outra chamada.
       *
       * Esperamos a próxima instrução.
       */

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;
    }


    /*
     * -------------------------------------------------
     * MESMA INSTRUÇÃO — AGUARDANDO ACEITAÇÃO
     * -------------------------------------------------
     */

    if (
      facialResult?.state ===
      "FACIAL_POSITION_WAITING_ACCEPTANCE"
    ) {

      noInstructionCount =
        0;

      application.bot1.lastAction =
        "waiting_facial_position_acceptance";


      await application.save();


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;
    }


    /*
     * -------------------------------------------------
     * FALHA REAL
     * -------------------------------------------------
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
     * -------------------------------------------------
     * CHECKPOINT OFICIAL
     * -------------------------------------------------
     */

    if (
      facialResult?.requiresUser ===
        true
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


    /*
     * -------------------------------------------------
     * SEGURANÇA
     * -------------------------------------------------
     */

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1200
        )
    );
  }


  /*
   * ---------------------------------------------------
   * TIMEOUT DA ETAPA FACIAL
   * ---------------------------------------------------
   */

  if (
    !facialCompleted &&
    Date.now() -
      facialStartedAt >=
      facialTimeoutMs
  ) {

    throw new Error(
      "VFS facial verification did not finish within the allowed session time."
    );
  }


  /*
   * ---------------------------------------------------
   * MARCAR ÚLTIMA POSIÇÃO COMO ACEITA
   * ---------------------------------------------------
   *
   * Se a VFS saiu da etapa facial sem apresentar
   * uma nova instrução, a última posição ativa é
   * considerada concluída.
   */

  const facialSession =
    this.site.facialSession;


  if (
    facialSession?.currentPosition
  ) {

    const finalPosition =
      Number(
        facialSession.currentPosition
      );

    const alreadyAccepted =
      Array.isArray(
        facialSession.acceptedPositions
      ) &&
      facialSession.acceptedPositions.some(
        item =>
          Number(item.position) ===
          finalPosition
      );


    if (
      !alreadyAccepted
    ) {

      facialSession.acceptedPositions =
        facialSession.acceptedPositions ||
        [];

      facialSession.acceptedPositions.push(
        {
          position:
            finalPosition,

          request:
            facialSession.currentRequest ||
            null,

          acceptedAt:
            new Date().toISOString()
        }
      );

      facialSession.lastAcceptedAt =
        new Date().toISOString();
    }
  }


  /*
   * ---------------------------------------------------
   * FINALIZAR SESSÃO FACIAL
   * ---------------------------------------------------
   */

  if (
    facialSession
  ) {

    facialSession.completed =
      true;

    facialSession.active =
      false;
  }


  application.facialCheckpoint =
    application.facialCheckpoint ||
    {};


  application.facialCheckpoint.completed =
    true;

  application.facialCheckpoint.completedAt =
    new Date();


  application.facialCheckpoint.acceptedPositions =
    Array.isArray(
      facialSession?.acceptedPositions
    )
      ? facialSession.acceptedPositions
      : [];


  application.bot1.lastAction =
    "facial_positions_completed";


  await application.save();
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

        /*
         * ---------------------------------------------------
         * OTP REQUIRED
         * ---------------------------------------------------
         *
         * VFS pediu OTP.
         *
         * O OTP é enviado para o e-mail VFS configurado
         * pela Administração.
         *
         * O Bot 1 permanece com o lock ativo enquanto
         * aguarda a chegada do e-mail.
         * ---------------------------------------------------
         */

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


        /*
         * ---------------------------------------------------
         * SOLICITAR OTP
         * ---------------------------------------------------
         *
         * IMPORTANTE:
         *
         * Não usamos telefone nem e-mail do cliente.
         *
         * O OtpService vai buscar as credenciais VFS
         * configuradas pela Administração.
         * ---------------------------------------------------
         */

        const requestResult =
          await this.otp.requestCode(
            otp,
            null
          );


        application.status =
          "otp_required";


        application.bot1.status =
          "waiting";


        application.bot1.lastAction =
          "waiting_for_otp_email";


        await application.save();


        /*
         * ---------------------------------------------------
         * AGUARDAR OTP NO E-MAIL VFS
         * ---------------------------------------------------
         *
         * waitForOtpCodeWithLock()
         * mantém o lock do Bot 1 renovado enquanto
         * o OtpService procura o e-mail.
         * ---------------------------------------------------
         */

        const receivedOtp =
          await this.waitForOtpCodeWithLock(
            applicationId,
            otp
          );


        /*
         * ---------------------------------------------------
         * OTP NÃO RECEBIDO
         * ---------------------------------------------------
         */

        if (
          !receivedOtp ||
          receivedOtp.status !==
            "received"
        ) {

          if (
            receivedOtp?.status ===
            "expired"
          ) {

            application.otp.status =
              "expired";

            application.bot1.status =
              "error";

            application.bot1.lastAction =
              "otp_email_expired";

            await application.save();

            throw new Error(
              "OTP email was not received before expiration."
            );
          }


          throw new Error(
            "OTP email could not be retrieved."
          );
        }


        const otpCode =
          receivedOtp.code;


        /*
         * ---------------------------------------------------
         * VALIDAR FORMATO DO OTP
         * ---------------------------------------------------
         */

        const validCode =
          this.otp.validateCode(
            otpCode
          );


        if (
          !validCode
        ) {

          application.otp.status =
            "failed";

          application.bot1.status =
            "error";

          application.bot1.lastAction =
            "otp_invalid_format";

          await application.save();

          throw new Error(
            "OTP received from VFS email has an invalid format."
          );
        }


        /*
         * ---------------------------------------------------
         * VERIFICAR OTP
         * ---------------------------------------------------
         */

        const verification =
          await this.otp.verifyCode({
            request: otp,
            code: otpCode,
            attempts:
              Number(
                application.otp.attempts ||
                0
              )
          });


        if (
          verification.status ===
          "expired"
        ) {

          application.otp.status =
            "expired";

          application.bot1.status =
            "error";

          application.bot1.lastAction =
            "otp_expired";

          await application.save();

          throw new Error(
            "OTP expired before verification."
          );
        }


        if (
          !verification.verified
        ) {

          application.otp.attempts =
            Number(
              application.otp.attempts ||
              0
            ) + 1;

          application.otp.status =
            "failed";

          application.bot1.status =
            "error";

          application.bot1.lastAction =
            "otp_verification_failed";

          await application.save();

          throw new Error(
            "OTP verification failed."
          );
        }


        /*
         * ---------------------------------------------------
         * OTP VERIFICADO
         * ---------------------------------------------------
         */

        await moveState(
          application,
          STATES.OTP_VERIFIED,
          {
            event:
              "OTP_VERIFIED"
          }
        );


        /*
         * ---------------------------------------------------
         * SUBMETER OTP AO VFS
         * ---------------------------------------------------
         */

        await moveState(
          application,
          STATES.OTP_SUBMITTING,
          {
            event:
              "OTP_SUBMITTING"
          }
        );


        application.otp.status =
          "verified";


        application.otp.verifiedAt =
          new Date();


        application.bot1.status =
          "running";


        application.bot1.lastAction =
          "submitting_otp";


        await application.save();


        if (
          typeof this.site.submitOtp !==
          "function"
        ) {

          throw new Error(
            "VFS adapter does not provide submitOtp()."
          );
        }


        const otpResult =
          await withTimeout(
            this.site.submitOtp(
              otpCode
            ),
            config.timeoutMs,
            "VFS OTP submission"
          );


        /*
         * ---------------------------------------------------
         * VFS PEDIU INTERVENÇÃO OFICIAL
         * ---------------------------------------------------
         */

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


        /*
         * ---------------------------------------------------
         * FALHA AO SUBMETER OTP
         * ---------------------------------------------------
         */

        if (
          otpResult?.success ===
            false
        ) {

          throw new Error(
            otpResult.reason ||
            "VFS OTP submission failed."
          );
        }


        /*
         * ---------------------------------------------------
         * CONTINUAR FLUXO NORMAL
         * ---------------------------------------------------
         */

        await moveState(
          application,
          STATES.REVIEW,
          {
            event:
              "REVIEW_STARTED",

            reason:
              "VFS OTP was received from the configured mailbox and submitted successfully."
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
