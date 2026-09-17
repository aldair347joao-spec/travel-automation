"use strict";

const crypto = require("crypto");

const Application = require("../models/application");
const OtpService = require("../services/otp/otp-service");
const FacialService = require("../services/facial/facial-service");

const { decryptJson } = require("../utils/crypto");
const logger = require("../utils/logger");

/*

* O state machine será usado quando estiver disponível.
* 
* Mantemos fallback local para que o Bot 1 não quebre
* durante a migração caso o arquivo ainda não tenha sido
* colocado no repositório.
  */
  let STATES;
  let transitionState;

try {
const stateMachine = require(
"../services/application/application-state-machine"
);

STATES = stateMachine.STATES;

transitionState =
stateMachine.transition;
} catch {
STATES = {
CREATED: "CREATED",
PASSPORT_PENDING: "PASSPORT_PENDING",
PASSPORT_VERIFIED: "PASSPORT_VERIFIED",
IDENTITY_PREPARATION: "IDENTITY_PREPARATION",
IDENTITY_READY: "IDENTITY_READY",
PREFERENCES_PENDING: "PREFERENCES_PENDING",
READY_FOR_AUTOMATION: "READY_FOR_AUTOMATION",

VFS_SESSION: "VFS_SESSION",
VFS_AUTHENTICATING: "VFS_AUTHENTICATING",
CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
VFS_AUTHENTICATED: "VFS_AUTHENTICATED",

RADAR_ACTIVE: "RADAR_ACTIVE",
SLOT_FOUND: "SLOT_FOUND",
SLOT_LOCKED: "SLOT_LOCKED",
SLOT_REVALIDATED: "SLOT_REVALIDATED",
SLOT_LOST: "SLOT_LOST",

BOOKING: "BOOKING",
DOCUMENT_UPLOAD: "DOCUMENT_UPLOAD",
FACIAL_POSITIONS: "FACIAL_POSITIONS",
FACIAL_POSITION_UNRESOLVED:
  "FACIAL_POSITION_UNRESOLVED",
FACIAL_POSITION_FAILED:
  "FACIAL_POSITION_FAILED",

OTP_REQUIRED: "OTP_REQUIRED",
OTP_SUBMITTING: "OTP_SUBMITTING",
OTP_VERIFIED: "OTP_VERIFIED",

REVIEW: "REVIEW",
APPOINTMENT_BOOKED: "APPOINTMENT_BOOKED",

PAYMENT_PENDING: "PAYMENT_PENDING",
PAYMENT_CONFIRMED: "PAYMENT_CONFIRMED",
PAYMENT_EXPIRED: "PAYMENT_EXPIRED",

VFS_SESSION_EXPIRED: "VFS_SESSION_EXPIRED",
VFS_ACCOUNT_RESTRICTED:
  "VFS_ACCOUNT_RESTRICTED",

BOOKING_FAILED: "BOOKING_FAILED",
ERROR: "ERROR",
CANCELLED: "CANCELLED",
COMPLETED: "COMPLETED"

};

transitionState = async (
application,
nextState,
metadata = {}
) => {
application.workflowState =
nextState;

application.workflow =
  application.workflow || {};

application.workflow.previousState =
  application.workflowState;

application.workflow.stateChangedAt =
  new Date();

application.workflow.lastEvent =
  metadata.event || null;

application.workflow.lastReason =
  metadata.reason || null;

application.workflow.transitionCount =
  Number(
    application.workflow.transitionCount
  ) + 1;

return application;

};
}

const config = {
lockMs:
Number(process.env.BOT1_LOCK_MS) ||
60000,

maxAttempts:
Number(process.env.BOT1_MAX_ATTEMPTS) ||
3,

timeoutMs:
Number(process.env.BOT1_TIMEOUT_MS) ||
30000
};

async function withTimeout(
promise,
timeoutMs,
operation
) {
let timer;

const timeout = new Promise(
(_, reject) => {
timer = setTimeout(() => {
reject(
new Error(
"${operation} timed out after ${timeoutMs}ms"
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
payment?.paymentStatus ===
null ||
payment?.paymentStatus ===
undefined
) {
return false;
}

return !isPaidStatus(
payment.paymentStatus
);
}

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
  application?.result
    ?.paymentStatus
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
getWorkflowState(application);

/*

* Se já estiver no estado pretendido,
* apenas atualizamos o evento.
  */
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

return application;

}

/*

* O state machine oficial valida

* transições quando o arquivo estiver

* disponível.
  */
  if (
  transitionState
  ) {
  try {
  await transitionState(
  application,
  nextState,
  metadata
  );
  
  return application;
  } catch (error) {
  /*
  
  * Durante a migração aceitamos
  * estados legados conhecidos.
  * 
  * O erro será lançado para estados
  * incompatíveis reais.
    */
    if (
    application.workflowState
    ) {
    throw error;
    }
    }
    }

application.workflowState =
nextState;

application.workflow =
application.workflow || {};

application.workflow.previousState =
current;

application.workflow.stateChangedAt =
new Date();

application.workflow.lastEvent =
metadata.event || null;

application.workflow.lastReason =
metadata.reason || null;

application.workflow.transitionCount =
Number(
application.workflow.transitionCount || 0
) + 1;

return application;
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
allowedStatuses = []
) {
const now =
new Date();

const lockExpires =
  new Date(
    Date.now() +
      config.lockMs
  );

const workflowCandidates =
  allowedStatuses
    .map(status => {
      const map = {
        created:
          STATES.CREATED,

        otp_required:
          STATES.OTP_REQUIRED,

        otp_verified:
          STATES.OTP_VERIFIED,

        slot_received:
          STATES.SLOT_FOUND,

        waiting_for_slot:
          STATES.RADAR_ACTIVE
      };

      return (
        map[status] ||
        status
      );
    });

const legacyCandidates =
  allowedStatuses;

const orState =
  workflowCandidates.length
    ? [
        {
          workflowState: {
            $in:
              workflowCandidates
          }
        },
        {
          status: {
            $in:
              legacyCandidates
          }
        }
      ]
    : [];

return Application
  .findOneAndUpdate(
    {
      _id:
        applicationId,

      ...(orState.length
        ? {
            $or: [
              ...orState,

              {
                $and: [
                  {
                    $or: [
                      {
                        "lock.owner":
                          null
                      },
                      {
                        "lock.expiresAt":
                          {
                            $lt:
                              now
                          }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        : {}),

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

async claimSlot(
applicationId
) {
const now =
new Date();

const lockExpires =
  new Date(
    Date.now() +
      config.lockMs
  );

const application =
  await Application
    .findOneAndUpdate(
      {
        _id:
          applicationId,

        $or: [
          {
            workflowState:
              STATES.SLOT_FOUND
          },
          {
            status:
              "slot_received"
          }
        ],

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

          "bot1.status":
            "continuing",

          "bot1.startedAt":
            now,

          "bot1.heartbeatAt":
            now,

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
    )
    .populate("client")
    .select(
      "+preparedDataEncrypted"
    );

return application;

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
    ).populate("client");

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

try {
  await moveState(
    application,
    STATES.IDENTITY_PREPARATION,
    {
      event:
        "BOT1_PREPARATION_STARTED",
      reason:
        "Bot 1 iniciou preparação da candidatura."
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
    code: null,
    message: null,
    at: null,
    attempts: 0
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
      this.site.login(),
      config.timeoutMs,
      "Site login"
    );

  /*
   * O adapter atual devolve requiresUser
   * porque o login/captcha oficial ainda
   * precisa do DOM real.
   *
   * Não fazemos bypass.
   */
  if (
    loginResult?.success === false
  ) {
    throw new Error(
      loginResult.reason ||
      "VFS login failed"
    );
  }

  if (
    loginResult?.requiresUser === true
  ) {
    await moveState(
      application,
      STATES.VFS_AUTHENTICATING,
      {
        event:
          "VFS_AUTHENTICATION_CHECKPOINT",
        reason:
          loginResult.reason
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
    application
      .preparedDataEncrypted
      ? decryptJson(
          application
            .preparedDataEncrypted
        )
      : null;

  if (!preparedData) {
    throw new Error(
      "Prepared application data is missing"
    );
  }

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

  /*
   * Preparação local/VFS inicial concluída.
   *
   * OTP não deve ser confundido com o
   * estado de disponibilidade de vaga.
   */
  application.preparedAt =
    new Date();

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
        "Dados preparados e candidatura pronta para radar."
    }
  );

  application.status =
    "waiting_for_slot";

  application.bot1.status =
    "waiting";

  application.bot1.lastAction =
    "ready_for_automation";

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
await Application.findById(
applicationId
)
.select(
"+preparedDataEncrypted"
)
.populate("client");

if (!application) {
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

  await this.markError(
    application,
    "OTP_EXPIRED",
    new Error(
      "OTP expired"
    )
  );

  return application;
}

if (!result.verified) {
  if (
    application.otp.attempts >=
    this.otp.maxAttempts
  ) {
    application.otp.status =
      "failed";

    await this.markError(
      application,
      "OTP_MAX_ATTEMPTS",
      new Error(
        "Maximum OTP attempts exceeded"
      )
    );
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

    await application.save();
  }

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

async continueAfterVerification(
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

  await moveState(
    application,
    STATES.IDENTITY_READY,
    {
      event:
        "IDENTITY_READY"
    }
  );

  /*
   * A partir daqui o Bot 1 NÃO abre
   * calendário para ficar esperando.
   *
   * O Bot 2 será responsável pelo radar.
   */
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
    "BOT1_IDENTITY_ERROR",
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
  await this.claimSlot(
    applicationId
  );

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
   * Revalidação:
   *
   * O adapter atual ainda não possui
   * revalidateSlot(). Portanto não
   * inventamos uma implementação.
   *
   * Se existir no futuro, ela será
   * chamada antes da seleção.
   */
  if (
    typeof this.site
      .revalidateSlot ===
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
      revalidated?.success === false
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

      application.bot2.status =
        "monitoring";

      application.bot2.monitoring =
        true;

      application.radar.enabled =
        true;

      await application.save();

      await this.releaseLock(
        applicationId
      );

      return {
        success: false,

        slotLost: true,

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

  await this.heartbeat(
    applicationId,
    "booking"
  );

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
    selected?.success === false
  ) {
    if (
      selected.requiresUser ===
      true
    ) {
      throw new Error(
        selected.reason ||
        "VFS slot selection requires the official DOM flow"
      );
    }

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
    continued?.success === false
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
   * ======================================================
   * DOCUMENT UPLOAD
   * ======================================================
   *
   * O método só será chamado quando
   * existir no adapter. Não inventamos
   * selectors nem enviamos documento
   * para um endpoint desconhecido.
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
    typeof this.site
      .uploadPassport ===
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
  }

  /*
   * ======================================================
   * FACIAL POSITIONS
   * ======================================================
   *
   * O projeto já possui exatamente
   * as 10 posições do cliente.
   *
   * Não criamos novas posições.
   *
   * O adapter deverá futuramente
   * interpretar semanticamente a
   * solicitação do VFS e selecionar
   * a captura correspondente.
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
    typeof this.site
      .handleFacialPositionRequest ===
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
            facialResult.reason
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
        success: false,

        requiresUser:
          facialResult.requiresUser ===
          true,

        facialPositionUnresolved:
          true,

        application
      };
    }

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
  }

  /*
   * ======================================================
   * OTP
   * ======================================================
   *
   * Só criamos a solicitação quando
   * a etapa oficial exigir OTP.
   */
  await moveState(
    application,
    STATES.OTP_REQUIRED,
    {
      event:
        "OTP_REQUIRED"
    }
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

  /*
   * O provider existente é responsável
   * por encaminhar a solicitação pelo
   * canal autorizado/configurado.
   */
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
    success: true,

    otpRequired: true,

    application
  };
} catch (error) {
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

async finalizeAfterOtp(
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

  if (
    typeof this.site
      .submitOtp ===
    "function"
  ) {
    const otpResult =
      await withTimeout(
        this.site.submitOtp(
          application.otp.code ||
          application.otp.value ||
          null
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

  if (!payment.reference) {
    payment.reference =
      await withTimeout(
        this.site.getReference(
          application
        ),
        config.timeoutMs,
        "Reference retrieval"
      ).catch(
        () => null
      );
  }

  if (!payment.entity) {
    payment.entity =
      await withTimeout(
        this.site.getEntity(
          application
        ),
        config.timeoutMs,
        "Entity retrieval"
      ).catch(
        () => null
      );
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

  /*
   * ======================================================
   * APPOINTMENT BOOKED / PAYMENT PENDING
   * ======================================================
   */
  if (
    isPendingPayment(payment)
  ) {
    await moveState(
      application,
      STATES.APPOINTMENT_BOOKED,
      {
        event:
          "APPOINTMENT_BOOKED_PAYMENT_PENDING",
        reason:
          "VFS returned appointment/payment data but payment is not confirmed."
      }
    );

    await moveState(
      application,
      STATES.PAYMENT_PENDING,
      {
        event:
          "PAYMENT_PENDING",
        reason:
          "Payment must be completed through the official payment flow."
      }
    );

    application.bot1.status =
      "waiting";

    application.bot1.lastAction =
      "payment_pending";

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

      paymentPending: true,

      requiresUser: false,

      payment: {
        reference:
          application.result
            .reference,

        entity:
          application.result
            .entity,

        amount:
          application.result
            .paymentAmount,

        currency:
          application.result
            .paymentCurrency,

        deadline:
          application.result
            .paymentDeadline,

        status:
          application.result
            .paymentStatus,

        confirmationUrl:
          application.result
            .confirmationUrl
      },

      application
    };
  }

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
        success: true,

        requiresUser: true,

        officialCheckpoint: true,

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

  const normalized =
    normalizePaymentDetails(
      confirmation || {}
    );

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

  if (!confirmed) {
    await moveState(
      application,
      STATES.PAYMENT_PENDING,
      {
        event:
          "PAYMENT_CONFIRMATION_PENDING",
        reason:
          "VFS did not independently confirm payment."
      }
    );

    application.bot1.status =
      "waiting";

    application.bot1.lastAction =
      "payment_pending";

    application.lock = {
      owner: null,
      expiresAt: null
    };

    await application.save();

    return {
      success: true,

      paymentPending: true,

      requiresUser: false,

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

  const completionMs =
    Date.now() -
    Number(
      application
        .bot1
        ?.lastAttemptAt
        ? new Date(
            application.bot1
              .lastAttemptAt
          ).getTime()
        : Date.now()
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
    "BOT1_FINALIZATION_ERROR",
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

/*
 * Não convertemos PAYMENT_PENDING
 * em erro.
 */
if (
  getWorkflowState(
    application
  ) ===
  STATES.PAYMENT_PENDING
) {
  application.bot1.status =
    "waiting";

  application.bot1.lastAction =
    "payment_pending";

  application.lock = {
    owner: null,
    expiresAt: null
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

try {
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
} catch {
  application.workflowState =
    STATES.ERROR;
}

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
