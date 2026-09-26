"use strict";

const logger = require("../../utils/logger");

/**
 * ============================================================
 * TRAVEL AUTOMATION
 * APPLICATION STATE MACHINE
 * ============================================================
 *
 * Máquina central do workflow de uma candidatura.
 *
 * PRINCÍPIOS:
 *
 * 1. Cada candidatura possui UM estado principal.
 * 2. Nenhum bot pode saltar arbitrariamente entre estados.
 * 3. Bot 2 é responsável pelo RADAR.
 * 4. Bot 1 é responsável pelo BOOKING.
 * 5. Supervisor coordena ownership, recuperação e transições.
 * 6. CAPTCHA, PASSAPORTE, FACIAL e OTP são checkpoints.
 * 7. PAYMENT_PENDING não significa erro.
 * 8. COMPLETED só acontece depois da conclusão real.
 *
 * Este módulo NÃO grava MongoDB.
 * Apenas valida e executa transições no objeto Application.
 * ============================================================
 */


/**
 * ============================================================
 * STATES
 * ============================================================
 */

const STATES = Object.freeze({

  // ----------------------------------------------------------
  // PREPARAÇÃO
  // ----------------------------------------------------------

  CREATED:
    "CREATED",

  PASSPORT_PENDING:
    "PASSPORT_PENDING",

  PASSPORT_VALIDATING:
    "PASSPORT_VALIDATING",

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


  // ----------------------------------------------------------
  // VFS SESSION
  // ----------------------------------------------------------

  VFS_SESSION:
    "VFS_SESSION",

  VFS_AUTHENTICATING:
    "VFS_AUTHENTICATING",

  VFS_AUTHENTICATED:
    "VFS_AUTHENTICATED",

  VFS_SESSION_EXPIRED:
    "VFS_SESSION_EXPIRED",

  VFS_ACCOUNT_RESTRICTED:
    "VFS_ACCOUNT_RESTRICTED",


  // ----------------------------------------------------------
  // CAPTCHA CHECKPOINT
  // ----------------------------------------------------------

  CAPTCHA_REQUIRED:
    "CAPTCHA_REQUIRED",

  CAPTCHA_PROCESSING:
    "CAPTCHA_PROCESSING",

  CAPTCHA_COMPLETED:
    "CAPTCHA_COMPLETED",

  CAPTCHA_FAILED:
    "CAPTCHA_FAILED",


  // ----------------------------------------------------------
  // RADAR / BOT 2
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // BOOKING / BOT 1
  // ----------------------------------------------------------

  BOOKING:
    "BOOKING",

  DOCUMENT_UPLOAD:
    "DOCUMENT_UPLOAD",

  PASSPORT_UPLOAD_REQUIRED:
    "PASSPORT_UPLOAD_REQUIRED",

  PASSPORT_UPLOADING:
    "PASSPORT_UPLOADING",

  PASSPORT_UPLOADED:
    "PASSPORT_UPLOADED",


  // ----------------------------------------------------------
  // FACIAL
  // ----------------------------------------------------------

  FACIAL_SESSION_STARTING:
    "FACIAL_SESSION_STARTING",

  FACIAL_LIVENESS_REQUIRED:
    "FACIAL_LIVENESS_REQUIRED",

  FACIAL_LIVENESS_PROCESSING:
    "FACIAL_LIVENESS_PROCESSING",

  FACIAL_POSITION_REQUESTED:
    "FACIAL_POSITION_REQUESTED",

  FACIAL_POSITION_RESOLVING:
    "FACIAL_POSITION_RESOLVING",

  FACIAL_POSITION_SUBMITTING:
    "FACIAL_POSITION_SUBMITTING",

  FACIAL_POSITIONS:
    "FACIAL_POSITIONS",

  FACIAL_POSITION_UNRESOLVED:
    "FACIAL_POSITION_UNRESOLVED",

  FACIAL_POSITION_FAILED:
    "FACIAL_POSITION_FAILED",

  FACIAL_VERIFICATION_COMPLETED:
    "FACIAL_VERIFICATION_COMPLETED",

  FACIAL_VERIFICATION_FAILED:
    "FACIAL_VERIFICATION_FAILED",


  // ----------------------------------------------------------
  // OTP
  // ----------------------------------------------------------

  OTP_REQUIRED:
    "OTP_REQUIRED",

  OTP_RECEIVING:
    "OTP_RECEIVING",

  OTP_RECEIVED:
    "OTP_RECEIVED",

  OTP_SUBMITTING:
    "OTP_SUBMITTING",

  OTP_VERIFIED:
    "OTP_VERIFIED",

  OTP_FAILED:
    "OTP_FAILED",

  OTP_EXPIRED:
    "OTP_EXPIRED",


  // ----------------------------------------------------------
  // REVIEW / BOOKING RESULT
  // ----------------------------------------------------------

  REVIEW:
    "REVIEW",

  APPOINTMENT_BOOKED:
    "APPOINTMENT_BOOKED",


  // ----------------------------------------------------------
  // PAYMENT
  // ----------------------------------------------------------

  PAYMENT_PENDING:
    "PAYMENT_PENDING",

  PAYMENT_CONFIRMED:
    "PAYMENT_CONFIRMED",

  PAYMENT_EXPIRED:
    "PAYMENT_EXPIRED",


  // ----------------------------------------------------------
  // FAILURES
  // ----------------------------------------------------------

  BOOKING_FAILED:
    "BOOKING_FAILED",

  ERROR:
    "ERROR",

  CANCELLED:
    "CANCELLED",


  // ----------------------------------------------------------
  // FINAL
  // ----------------------------------------------------------

  COMPLETED:
    "COMPLETED"
});


/**
 * ============================================================
 * TERMINAL STATES
 * ============================================================
 */

const TERMINAL_STATES = new Set([

  STATES.COMPLETED,

  STATES.CANCELLED

]);


/**
 * ============================================================
 * TRANSITIONS
 * ============================================================
 */

const TRANSITIONS = Object.freeze({

  // ----------------------------------------------------------
  // PREPARAÇÃO
  // ----------------------------------------------------------

  [STATES.CREATED]: new Set([
    STATES.PASSPORT_PENDING,
    STATES.PASSPORT_VERIFIED,
    STATES.IDENTITY_PREPARATION,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PASSPORT_PENDING]: new Set([
    STATES.PASSPORT_VALIDATING,
    STATES.PASSPORT_VERIFIED,
    STATES.ERROR,
    STATES.CANCELLED
  ]),


  [STATES.PASSPORT_VALIDATING]: new Set([
    STATES.PASSPORT_VERIFIED,
    STATES.PASSPORT_PENDING,
    STATES.ERROR
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


  /*
   * ----------------------------------------------------------
   * ALTERAÇÃO IMPORTANTE
   * ----------------------------------------------------------
   *
   * Depois que a candidatura foi liberada/preparada,
   * o Bot 1 pode colocá-la diretamente no RADAR.
   *
   * Antes:
   *
   * READY_FOR_AUTOMATION -> VFS_SESSION
   *
   * Agora também:
   *
   * READY_FOR_AUTOMATION -> RADAR_ACTIVE
   *
   * Isto permite que o fluxo Admin -> Bot 1 -> Bot 2
   * seja reconhecido pela máquina de estados.
   */

  [STATES.READY_FOR_AUTOMATION]: new Set([
    STATES.VFS_SESSION,
    STATES.RADAR_ACTIVE,
    STATES.CANCELLED,
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // VFS
  // ----------------------------------------------------------

  [STATES.VFS_SESSION]: new Set([
    STATES.VFS_AUTHENTICATING,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.VFS_AUTHENTICATING]: new Set([
    STATES.VFS_AUTHENTICATED,
    STATES.CAPTCHA_REQUIRED,
    STATES.CAPTCHA_PROCESSING,
    STATES.VFS_ACCOUNT_RESTRICTED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.CAPTCHA_REQUIRED]: new Set([
    STATES.CAPTCHA_PROCESSING,
    STATES.VFS_AUTHENTICATING,
    STATES.ERROR
  ]),


  [STATES.CAPTCHA_PROCESSING]: new Set([
    STATES.CAPTCHA_COMPLETED,
    STATES.CAPTCHA_FAILED,
    STATES.ERROR
  ]),


  [STATES.CAPTCHA_COMPLETED]: new Set([
    STATES.VFS_AUTHENTICATING,
    STATES.VFS_AUTHENTICATED,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  [STATES.CAPTCHA_FAILED]: new Set([
    STATES.CAPTCHA_REQUIRED,
    STATES.ERROR
  ]),


  [STATES.VFS_AUTHENTICATED]: new Set([
    STATES.RADAR_ACTIVE,
    STATES.BOOKING,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.VFS_SESSION_EXPIRED]: new Set([
    STATES.VFS_SESSION,
    STATES.VFS_AUTHENTICATING,
    STATES.ERROR
  ]),


  [STATES.VFS_ACCOUNT_RESTRICTED]: new Set([
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // RADAR
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // BOOKING
  // ----------------------------------------------------------

  [STATES.BOOKING]: new Set([
    STATES.CAPTCHA_REQUIRED,
    STATES.DOCUMENT_UPLOAD,
    STATES.PASSPORT_UPLOAD_REQUIRED,
    STATES.FACIAL_SESSION_STARTING,
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.APPOINTMENT_BOOKED,
    STATES.BOOKING_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // DOCUMENTOS
  // ----------------------------------------------------------

  [STATES.DOCUMENT_UPLOAD]: new Set([
    STATES.PASSPORT_UPLOAD_REQUIRED,
    STATES.PASSPORT_UPLOADING,
    STATES.PASSPORT_UPLOADED,
    STATES.FACIAL_SESSION_STARTING,
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.BOOKING_FAILED,
    STATES.ERROR
  ]),


  [STATES.PASSPORT_UPLOAD_REQUIRED]: new Set([
    STATES.PASSPORT_UPLOADING,
    STATES.BOOKING_FAILED,
    STATES.ERROR
  ]),


  [STATES.PASSPORT_UPLOADING]: new Set([
    STATES.PASSPORT_UPLOADED,
    STATES.PASSPORT_UPLOAD_REQUIRED,
    STATES.BOOKING_FAILED,
    STATES.ERROR
  ]),


  [STATES.PASSPORT_UPLOADED]: new Set([
    STATES.FACIAL_SESSION_STARTING,
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.BOOKING_FAILED,
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // FACIAL
  // ----------------------------------------------------------

  [STATES.FACIAL_SESSION_STARTING]: new Set([
    STATES.FACIAL_LIVENESS_REQUIRED,
    STATES.FACIAL_LIVENESS_PROCESSING,
    STATES.FACIAL_POSITION_REQUESTED,
    STATES.FACIAL_POSITIONS,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.FACIAL_VERIFICATION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_LIVENESS_REQUIRED]: new Set([
    STATES.FACIAL_LIVENESS_PROCESSING,
    STATES.FACIAL_VERIFICATION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_LIVENESS_PROCESSING]: new Set([
    STATES.FACIAL_POSITION_REQUESTED,
    STATES.FACIAL_POSITIONS,
    STATES.FACIAL_VERIFICATION_COMPLETED,
    STATES.FACIAL_VERIFICATION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITIONS]: new Set([
    STATES.FACIAL_POSITION_REQUESTED,
    STATES.FACIAL_POSITION_RESOLVING,
    STATES.FACIAL_VERIFICATION_COMPLETED,
    STATES.FACIAL_POSITION_UNRESOLVED,
    STATES.FACIAL_POSITION_FAILED,
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_REQUESTED]: new Set([
    STATES.FACIAL_POSITION_RESOLVING,
    STATES.FACIAL_POSITION_FAILED,
    STATES.FACIAL_VERIFICATION_COMPLETED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_RESOLVING]: new Set([
    STATES.FACIAL_POSITION_SUBMITTING,
    STATES.FACIAL_POSITION_UNRESOLVED,
    STATES.FACIAL_POSITION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_SUBMITTING]: new Set([
    STATES.FACIAL_POSITION_REQUESTED,
    STATES.FACIAL_VERIFICATION_COMPLETED,
    STATES.FACIAL_POSITION_FAILED,
    STATES.FACIAL_VERIFICATION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_UNRESOLVED]: new Set([
    STATES.FACIAL_POSITION_RESOLVING,
    STATES.FACIAL_POSITION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_POSITION_FAILED]: new Set([
    STATES.FACIAL_POSITION_REQUESTED,
    STATES.FACIAL_POSITION_RESOLVING,
    STATES.FACIAL_VERIFICATION_FAILED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_VERIFICATION_COMPLETED]: new Set([
    STATES.OTP_REQUIRED,
    STATES.REVIEW,
    STATES.BOOKING,
    STATES.APPOINTMENT_BOOKED,
    STATES.ERROR
  ]),


  [STATES.FACIAL_VERIFICATION_FAILED]: new Set([
    STATES.FACIAL_SESSION_STARTING,
    STATES.FACIAL_POSITIONS,
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // OTP
  // ----------------------------------------------------------

  [STATES.OTP_REQUIRED]: new Set([
    STATES.OTP_RECEIVING,
    STATES.OTP_SUBMITTING,
    STATES.OTP_EXPIRED,
    STATES.OTP_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.OTP_RECEIVING]: new Set([
    STATES.OTP_RECEIVED,
    STATES.OTP_EXPIRED,
    STATES.OTP_FAILED,
    STATES.VFS_SESSION_EXPIRED,
    STATES.ERROR
  ]),


  [STATES.OTP_RECEIVED]: new Set([
    STATES.OTP_SUBMITTING,
    STATES.OTP_FAILED,
    STATES.ERROR
  ]),


  [STATES.OTP_SUBMITTING]: new Set([
    STATES.OTP_VERIFIED,
    STATES.OTP_REQUIRED,
    STATES.OTP_EXPIRED,
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
    STATES.OTP_RECEIVING,
    STATES.ERROR
  ]),


  [STATES.OTP_EXPIRED]: new Set([
    STATES.OTP_REQUIRED,
    STATES.OTP_RECEIVING,
    STATES.ERROR
  ]),


  // ----------------------------------------------------------
  // REVIEW / APPOINTMENT
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // PAYMENT
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // ERRORS
  // ----------------------------------------------------------

  [STATES.BOOKING_FAILED]: new Set([
    STATES.BOOKING,
    STATES.RADAR_ACTIVE,
    STATES.ERROR
  ]),


  [STATES.ERROR]: new Set([
    STATES.READY_FOR_AUTOMATION,
    STATES.VFS_SESSION,
    STATES.VFS_AUTHENTICATING,
    STATES.RADAR_ACTIVE,
    STATES.BOOKING,
    STATES.PAYMENT_PENDING,
    STATES.CANCELLED
  ]),


  // ----------------------------------------------------------
  // TERMINAL
  // ----------------------------------------------------------

  [STATES.COMPLETED]: new Set([]),

  [STATES.CANCELLED]: new Set([])
});


/**
 * ============================================================
 * HELPERS
 * ============================================================
 */

function isKnownState(state) {

  return Object
    .values(STATES)
    .includes(state);

}


function isTerminal(state) {

  return TERMINAL_STATES.has(state);

}


function canTransition(from, to) {

  if (!isKnownState(from)) {
    return false;
  }

  if (!isKnownState(to)) {
    return false;
  }

  if (from === to) {
    return true;
  }

  return TRANSITIONS[from]?.has(to) === true;

}


function assertTransition(from, to) {

  if (!isKnownState(from)) {

    throw new Error(
      `Unknown application state: ${from}`
    );

  }

  if (!isKnownState(to)) {

    throw new Error(
      `Unknown application state: ${to}`
    );

  }

  if (!canTransition(from, to)) {

    throw new Error(
      `Invalid application transition: ${from} -> ${to}`
    );

  }

}


function allowedTransitions(state) {

  if (!isKnownState(state)) {
    return [];
  }

  return Array.from(
    TRANSITIONS[state] || []
  );

}


/**
 * ============================================================
 * TRANSITION
 * ============================================================
 */

function transition(
  application,
  to,
  metadata = {}
) {

  if (!application) {

    throw new Error(
      "Application is required"
    );

  }

  const from =
    application.workflowState ||
    STATES.CREATED;

  assertTransition(
    from,
    to
  );

  if (isTerminal(from)) {

    throw new Error(
      `Application is already terminal: ${from}`
    );

  }

  const now =
    new Date();

  application.workflowState =
    to;

  if (!application.workflow) {
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

  application.workflow.transitionCount =
    Number(
      application.workflow.transitionCount || 0
    ) + 1;

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
 * ============================================================
 * CHECKPOINT CLASSIFICATION
 * ============================================================
 */

function isAutomationCheckpoint(state) {

  return [

    STATES.CAPTCHA_REQUIRED,

    STATES.CAPTCHA_PROCESSING,

    STATES.PASSPORT_UPLOAD_REQUIRED,

    STATES.PASSPORT_UPLOADING,

    STATES.FACIAL_LIVENESS_REQUIRED,

    STATES.FACIAL_LIVENESS_PROCESSING,

    STATES.FACIAL_POSITION_REQUESTED,

    STATES.FACIAL_POSITION_RESOLVING,

    STATES.FACIAL_POSITION_SUBMITTING,

    STATES.OTP_REQUIRED,

    STATES.OTP_RECEIVING,

    STATES.OTP_SUBMITTING

  ].includes(state);

}


function isBookingState(state) {

  return [

    STATES.BOOKING,

    STATES.DOCUMENT_UPLOAD,

    STATES.PASSPORT_UPLOAD_REQUIRED,

    STATES.PASSPORT_UPLOADING,

    STATES.PASSPORT_UPLOADED,

    STATES.FACIAL_SESSION_STARTING,

    STATES.FACIAL_LIVENESS_REQUIRED,

    STATES.FACIAL_LIVENESS_PROCESSING,

    STATES.FACIAL_POSITION_REQUESTED,

    STATES.FACIAL_POSITION_RESOLVING,

    STATES.FACIAL_POSITION_SUBMITTING,

    STATES.FACIAL_POSITIONS,

    STATES.OTP_REQUIRED,

    STATES.OTP_RECEIVING,

    STATES.OTP_RECEIVED,

    STATES.OTP_SUBMITTING,

    STATES.OTP_VERIFIED,

    STATES.REVIEW

  ].includes(state);

}


function isPaymentState(state) {

  return [

    STATES.PAYMENT_PENDING,

    STATES.PAYMENT_CONFIRMED,

    STATES.PAYMENT_EXPIRED

  ].includes(state);

}


/**
 * ============================================================
 * EXPORT
 * ============================================================
 */

module.exports = {

  STATES,

  TERMINAL_STATES,

  TRANSITIONS,

  isKnownState,

  isTerminal,

  canTransition,

  assertTransition,

  allowedTransitions,

  isAutomationCheckpoint,

  isBookingState,

  isPaymentState,

  transition

};
