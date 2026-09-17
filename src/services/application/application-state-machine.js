const logger = require("../../utils/logger");

/**
 * =========================================================
 * APPLICATION STATE MACHINE
 * =========================================================
 *
 * Esta é a máquina de estados oficial do novo fluxo.
 *
 * IMPORTANTE:
 * - Não substituir imediatamente os estados antigos.
 * - A integração com Application/Bot1/Bot2 será feita
 *   progressivamente nos próximos blocos.
 * - Este módulo não grava MongoDB.
 * - Ele apenas valida e executa transições.
 */

const STATES = Object.freeze({

  // -------------------------------------------------------
  // PREPARAÇÃO
  // -------------------------------------------------------

  CREATED:
    "CREATED",

  PASSPORT_PENDING:
    "PASSPORT_PENDING",

  PASSPORT_VERIFIED:
    "PASSPORT_VERIFIED",

  IDENTITY_PREPARATION:
    "IDENTITY_PREPARATION",

  IDENTITY_READY:
    "IDENTITY_READY",

  PREFERENCES_PENDING:
    "PREFERENCES_PENDING",

  READY_FOR_AUTOMATION:
    "READY_FOR_AUTOMATION",


  // -------------------------------------------------------
  // VFS
  // -------------------------------------------------------

  VFS_SESSION:
    "VFS_SESSION",

  VFS_AUTHENTICATING:
    "VFS_AUTHENTICATING",

  CAPTCHA_REQUIRED:
    "CAPTCHA_REQUIRED",

  VFS_AUTHENTICATED:
    "VFS_AUTHENTICATED",


  // -------------------------------------------------------
  // RADAR / BOT 2
  // -------------------------------------------------------

  RADAR_ACTIVE:
    "RADAR_ACTIVE",

  SLOT_FOUND:
    "SLOT_FOUND",

  SLOT_LOCKED:
    "SLOT_LOCKED",

  SLOT_REVALIDATED:
    "SLOT_REVALIDATED",

  SLOT_LOST:
    "SLOT_LOST",


  // -------------------------------------------------------
  // BOT 1 / BOOKING
  // -------------------------------------------------------

  BOOKING:
    "BOOKING",

  DOCUMENT_UPLOAD:
    "DOCUMENT_UPLOAD",

  FACIAL_POSITIONS:
    "FACIAL_POSITIONS",

  FACIAL_POSITION_UNRESOLVED:
    "FACIAL_POSITION_UNRESOLVED",

  FACIAL_POSITION_FAILED:
    "FACIAL_POSITION_FAILED",


  // -------------------------------------------------------
  // OTP
  // -------------------------------------------------------

  OTP_REQUIRED:
    "OTP_REQUIRED",

  OTP_SUBMITTING:
    "OTP_SUBMITTING",

  OTP_VERIFIED:
    "OTP_VERIFIED",

  OTP_FAILED:
    "OTP_FAILED",


  // -------------------------------------------------------
  // CONFIRMAÇÃO
  // -------------------------------------------------------

  REVIEW:
    "REVIEW",

  APPOINTMENT_BOOKED:
    "APPOINTMENT_BOOKED",


  // -------------------------------------------------------
  // PAGAMENTO
  // -------------------------------------------------------

  PAYMENT_PENDING:
    "PAYMENT_PENDING",

  PAYMENT_CONFIRMED:
    "PAYMENT_CONFIRMED",

  PAYMENT_EXPIRED:
    "PAYMENT_EXPIRED",


  // -------------------------------------------------------
  // ERROS / EXCEÇÕES
  // -------------------------------------------------------

  VFS_SESSION_EXPIRED:
    "VFS_SESSION_EXPIRED",

  VFS_ACCOUNT_RESTRICTED:
    "VFS_ACCOUNT_RESTRICTED",

  BOOKING_FAILED:
    "BOOKING_FAILED",

  ERROR:
    "ERROR",

  CANCELLED:
    "CANCELLED",


  // -------------------------------------------------------
  // FINAL
  // -------------------------------------------------------

  COMPLETED:
    "COMPLETED"
});


/**
 * Estados realmente finais.
 *
 * PAYMENT_EXPIRED não é final porque poderá existir
 * uma nova tentativa de pagamento.
 */
const TERMINAL_STATES = new Set([

  STATES.COMPLETED,

  STATES.CANCELLED

]);


/**
 * =========================================================
 * TRANSITIONS
 * =========================================================
 *
 * Cada estado declara explicitamente para onde pode ir.
 *
 * Isto impede que, por exemplo:
 *
 * PAYMENT_PENDING
 *        ↓
 * COMPLETED
 *
 * aconteça sem PAYMENT_CONFIRMED.
 */

const TRANSITIONS = Object.freeze({

  [STATES.CREATED]: new Set([
    STATES.PASSPORT_PENDING,
    STATES.PASSPORT_VERIFIED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PASSPORT_PENDING]: new Set([
    STATES.PASSPORT_VERIFIED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PASSPORT_VERIFIED]: new Set([
    STATES.IDENTITY_PREPARATION,
    STATES.PREFERENCES_PENDING,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.IDENTITY_PREPARATION]: new Set([
    STATES.IDENTITY_READY,
    STATES.FACIAL_POSITION_FAILED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.IDENTITY_READY]: new Set([
    STATES.PREFERENCES_PENDING,
    STATES.READY_FOR_AUTOMATION,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PREFERENCES_PENDING]: new Set([
    STATES.READY_FOR_AUTOMATION,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.READY_FOR_AUTOMATION]: new Set([
    STATES.VFS_SESSION,
    STATES.CANCELLED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // VFS SESSION
  // -------------------------------------------------------

  [STATES.VFS_SESSION]: new Set([
    STATES.VFS_AUTHENTICATING,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.VFS_AUTHENTICATING]: new Set([
    STATES.VFS_AUTHENTICATED,
    STATES.CAPTCHA_REQUIRED,
    STATES.VFS_ACCOUNT_RESTRICTED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.CAPTCHA_REQUIRED]: new Set([
    STATES.VFS_AUTHENTICATING,
    STATES.VFS_AUTHENTICATED,
    STATES.ERROR
  ]),


  [STATES.VFS_AUTHENTICATED]: new Set([
    STATES.RADAR_ACTIVE,
    STATES.BOOKING,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // RADAR
  // -------------------------------------------------------

  [STATES.RADAR_ACTIVE]: new Set([
    STATES.SLOT_FOUND,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.SLOT_FOUND]: new Set([
    STATES.SLOT_LOCKED,
    STATES.SLOT_LOST,
    STATES.RADAR_ACTIVE,
    STATES.ERROR
  ]),


  [STATES.SLOT_LOCKED]: new Set([
    STATES.SLOT_REVALIDATED,
    STATES.SLOT_LOST,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  [STATES.SLOT_REVALIDATED]: new Set([
    STATES.BOOKING,
    STATES.SLOT_LOST,
    STATES.ERROR
  ]),


  [STATES.SLOT_LOST]: new Set([
    STATES.RADAR_ACTIVE,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // BOOKING
  // -------------------------------------------------------

  [STATES.BOOKING]: new Set([
    STATES.DOCUMENT_UPLOAD,
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.APPOINTMENT_BOOKED,
    STATES.BOOKING_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.DOCUMENT_UPLOAD]: new Set([
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.BOOKING_FAILED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // FACIAL
  // -------------------------------------------------------

  [STATES.FACIAL_POSITIONS]: new Set([
    STATES.FACIAL_POSITIONS,
    STATES.FACIAL_POSITION_UNRESOLVED,
    STATES.FACIAL_POSITION_FAILED,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_UNRESOLVED]: new Set([
    STATES.FACIAL_POSITIONS,
    STATES.FACIAL_POSITION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_FAILED]: new Set([
    STATES.FACIAL_POSITIONS,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // OTP
  // -------------------------------------------------------

  [STATES.OTP_REQUIRED]: new Set([
    STATES.OTP_SUBMITTING,
    STATES.OTP_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.OTP_SUBMITTING]: new Set([
    STATES.OTP_VERIFIED,
    STATES.OTP_REQUIRED,
    STATES.OTP_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.OTP_VERIFIED]: new Set([
    STATES.REVIEW,
    STATES.APPOINTMENT_BOOKED,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  [STATES.OTP_FAILED]: new Set([
    STATES.OTP_REQUIRED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // REVIEW / APPOINTMENT
  // -------------------------------------------------------

  [STATES.REVIEW]: new Set([
    STATES.APPOINTMENT_BOOKED,
    STATES.BOOKING_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.APPOINTMENT_BOOKED]: new Set([
    STATES.PAYMENT_PENDING,
    STATES.PAYMENT_CONFIRMED,
    STATES.COMPLETED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // PAYMENT
  // -------------------------------------------------------

  [STATES.PAYMENT_PENDING]: new Set([
    STATES.PAYMENT_CONFIRMED,
    STATES.PAYMENT_EXPIRED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PAYMENT_EXPIRED]: new Set([
    STATES.PAYMENT_PENDING,
    STATES.CANCELLED,
    STATES.ERROR
  ]),


  [STATES.PAYMENT_CONFIRMED]: new Set([
    STATES.COMPLETED,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // SESSION / ACCOUNT
  // -------------------------------------------------------

  [STATES.VFS_SESSION_EXPIRED]: new Set([
    STATES.VFS_SESSION,
    STATES.VFS_AUTHENTICATING,
    STATES.ERROR
  ]),


  [STATES.VFS_ACCOUNT_RESTRICTED]: new Set([
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // BOOKING ERROR
  // -------------------------------------------------------

  [STATES.BOOKING_FAILED]: new Set([
    STATES.BOOKING,
    STATES.RADAR_ACTIVE,
    STATES.ERROR
  ]),


  // -------------------------------------------------------
  // GENERIC ERROR
  // -------------------------------------------------------

  [STATES.ERROR]: new Set([
    STATES.READY_FOR_AUTOMATION,
    STATES.VFS_SESSION,
    STATES.RADAR_ACTIVE,
    STATES.BOOKING,
    STATES.PAYMENT_PENDING,
    STATES.CANCELLED
  ]),


  // -------------------------------------------------------
  // TERMINAL
  // -------------------------------------------------------

  [STATES.COMPLETED]: new Set([]),

  [STATES.CANCELLED]: new Set([])
});


/**
 * =========================================================
 * HELPERS
 * =========================================================
 */

function isKnownState(
  state
) {

  return Object
    .values(STATES)
    .includes(state);

}


function canTransition(
  from,
  to
) {

  if (
    !isKnownState(from) ||
    !isKnownState(to)
  ) {

    return false;

  }

  if (
    from === to
  ) {

    return true;

  }

  return (
    TRANSITIONS[from]?.has(to) === true
  );

}


function assertTransition(
  from,
  to
) {

  if (
    !isKnownState(from)
  ) {

    throw new Error(
      `Unknown application state: ${from}`
    );

  }

  if (
    !isKnownState(to)
  ) {

    throw new Error(
      `Unknown application state: ${to}`
    );

  }

  if (
    !canTransition(
      from,
      to
    )
  ) {

    throw new Error(
      `Invalid application transition: ${from} -> ${to}`
    );

  }

}


function isTerminal(
  state
) {

  return TERMINAL_STATES.has(
    state
  );

}


function allowedTransitions(
  state
) {

  if (
    !isKnownState(state)
  ) {

    return [];

  }

  return Array.from(
    TRANSITIONS[state] || []
  );

}


/**
 * =========================================================
 * TRANSITION
 * =========================================================
 *
 * Trabalha com um objeto JavaScript/Mongoose.
 *
 * Não salva automaticamente no MongoDB.
 */
function transition(
  application,
  to,
  metadata = {}
) {

  if (
    !application
  ) {

    throw new Error(
      "Application is required"
    );

  }

  const from =
    application.workflowState;


  assertTransition(
    from,
    to
  );


  if (
    isTerminal(from)
  ) {

    throw new Error(
      `Application is already terminal: ${from}`
    );

  }


  const now =
    new Date();


  application.workflowState =
    to;


  if (
    !application.workflow
  ) {

    application.workflow = {};

  }


  application.workflow.previousState =
    from;


  application.workflow.stateChangedAt =
    now;


  application.workflow.lastEvent =
    metadata.event ||
    null;


  application.workflow.lastReason =
    metadata.reason ||
    null;


  logger.info(
    "APPLICATION state transition",
    {
      applicationId:
        application._id
          ?.toString?.() ||
        null,

      from,

      to,

      event:
        metadata.event ||
        null,

      reason:
        metadata.reason ||
        null
    }
  );


  return application;

}


/**
 * =========================================================
 * EXPORT
 * =========================================================
 */

module.exports = {

  STATES,

  TERMINAL_STATES,

  TRANSITIONS,

  isKnownState,

  canTransition,

  assertTransition,

  isTerminal,

  allowedTransitions,

  transition

};
