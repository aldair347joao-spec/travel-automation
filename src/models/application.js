const mongoose = require("mongoose");

const {
  STATES,
  canTransition,
  transition
} = require("../services/application/application-state-machine");

/*
 * =========================================================
 * LEGACY STATUS -> WORKFLOW STATE
 * =========================================================
 *
 * Mantemos o campo "status" antigo durante a migração.
 * O novo "workflowState" passa a representar o estado
 * oficial do processo.
 */

const LEGACY_STATUS_TO_WORKFLOW_STATE = Object.freeze({
  created: STATES.CREATED,
  preparing: STATES.IDENTITY_PREPARATION,
  otp_required: STATES.OTP_REQUIRED,
  otp_verified: STATES.OTP_VERIFIED,
  identity_verification: STATES.FACIAL_POSITIONS,
  calendar: STATES.RADAR_ACTIVE,
  waiting_for_slot: STATES.RADAR_ACTIVE,
  slot_received: STATES.SLOT_FOUND,
  continuing: STATES.BOOKING,
  review_pay: STATES.REVIEW,
  book_appointment: STATES.BOOKING,
  completed: STATES.COMPLETED,
  requires_user: STATES.ERROR,
  error: STATES.ERROR,
  cancelled: STATES.CANCELLED
});

/*
 * =========================================================
 * LIVENESS SNAPSHOT
 * =========================================================
 *
 * Isto NÃO representa imagens.
 *
 * Guarda somente os dados da sessão de liveness que já foi
 * executada e validada pelo fluxo facial.
 *
 * A Administração pode saber:
 * - qual sessão foi executada;
 * - se foi aprovada;
 * - score;
 * - quantas posições foram concluídas;
 * - quais posições foram verificadas;
 * - quando começou e terminou;
 * - se o sorriso foi validado.
 */

const livenessPositionSchema = new mongoose.Schema(
  {
    position: {
      type: Number,
      min: 1,
      max: 10,
      required: true
    },

    label: {
      type: String,
      default: null,
      maxlength: 80
    },

    instruction: {
      type: String,
      default: null,
      maxlength: 240
    },

    sequence: {
      type: Number,
      min: 1,
      max: 10,
      default: null
    },

    score: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },

    positionScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },

    faceDetected: {
      type: Boolean,
      default: false
    },

    singleFace: {
      type: Boolean,
      default: false
    },

    faceCount: {
      type: Number,
      min: 0,
      default: 0
    },

    faceArea: {
      type: Number,
      min: 0,
      default: 0
    },

    detectionScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },

    pose: {
      yaw: {
        type: Number,
        default: 0
      },

      pitch: {
        type: Number,
        default: 0
      },

      roll: {
        type: Number,
        default: 0
      }
    },

    quality: {
      brightness: {
        type: Number,
        default: 0
      },

      brightnessScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      sharpnessScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      faceSizeScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      detectionScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      }
    },

    smileDetected: {
      type: Boolean,
      default: false
    },

    smileScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },

    verified: {
      type: Boolean,
      default: false
    },

    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    _id: false
  }
);

const livenessSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      default: null,
      maxlength: 160
    },

    status: {
      type: String,
      enum: [
        "not_started",
        "in_progress",
        "passed",
        "failed",
        "requires_user"
      ],
      default: "not_started"
    },

    source: {
      type: String,
      default: "local_liveness",
      maxlength: 80
    },

    score: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },

    completedCount: {
      type: Number,
      min: 0,
      max: 10,
      default: 0
    },

    total: {
      type: Number,
      min: 0,
      max: 10,
      default: 10
    },

    verified: {
      type: Boolean,
      default: false
    },

    startedAt: {
      type: Date,
      default: null
    },

    completedAt: {
      type: Date,
      default: null
    },

    positions: {
      type: [livenessPositionSchema],
      default: []
    }
  },
  {
    _id: false
  }
);

/*
 * =========================================================
 * APPLICANT
 * =========================================================
 */

const applicantSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true
    },

    passport: {
      number: {
        type: String,
        default: null
      },

      nationality: {
        type: String,
        default: null
      },

      expiryDate: {
        type: String,
        default: null
      },

      validationStatus: {
        type: String,
        enum: [
          "not_started",
          "pending",
          "passed",
          "failed"
        ],
        default: "not_started"
      }
    },

    personalData: {
      fullName: {
        type: String,
        default: null
      },

      dateOfBirth: {
        type: String,
        default: null
      },

      gender: {
        type: String,
        default: null
      },

      nationality: {
        type: String,
        default: null
      },

      email: {
        type: String,
        default: null
      },

      phone: {
        type: String,
        default: null
      }
    },

    /*
     * Estado resumido da identidade do candidato.
     */
    identityStatus: {
      type: String,
      enum: [
        "not_started",
        "pending",
        "ready",
        "requires_user",
        "verified",
        "failed"
      ],
      default: "not_started"
    },

    /*
     * =====================================================
     * LIVENESS
     * =====================================================
     *
     * Guarda o resultado da sessão de liveness associada
     * ao candidato.
     *
     * Não guarda fotografia nem data URL.
     */
    liveness: {
      type: livenessSchema,
      default: () => ({
        status: "not_started",
        source: "local_liveness",
        completedCount: 0,
        total: 10,
        verified: false,
        positions: []
      })
    },

    vfsStatus: {
      type: String,
      enum: [
        "not_started",
        "prepared",
        "otp_required",
        "otp_verified",
        "identity_required",
        "identity_verified",
        "ready",
        "completed",
        "error"
      ],
      default: "not_started"
    }
  },
  {
    _id: true
  }
);

/*
 * =========================================================
 * APPLICATION
 * =========================================================
 */

const applicationSchema = new mongoose.Schema(
  {
    /*
     * =====================================================
     * ACCOUNT / OWNERSHIP
     * =====================================================
     */

    accountId: {
      type: String,
      required: true,
      index: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null
    },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: false,
      index: true
    },

    groupId: {
      type: String,
      default: null,
      index: true
    },

    bookingMode: {
      type: String,
      enum: [
        "GROUP_REQUIRED",
        "PARTIAL_ALLOWED",
        "SINGLE"
      ],
      default: "SINGLE",
      index: true
    },

    applicantsCount: {
      type: Number,
      min: 1,
      default: 1
    },

    applicants: {
      type: [applicantSchema],
      default: []
    },

    /*
     * =====================================================
     * TRAVEL / VISA
     * =====================================================
     */

    visaType: {
      type: String,
      enum: [
        "SCHENGEN",
        "NACIONAL"
      ],
      required: true,
      index: true
    },

    visaCenter: {
      type: String,
      default: null,
      trim: true
    },

    travelPurpose: {
      type: String,
      default: null,
      trim: true
    },

    serviceType: {
      type: String,
      default: null,
      trim: true
    },

    appointmentMode: {
      type: String,
      enum: [
        "VFS_APPOINTMENT",
        "CONSULATE_ASSIGNED",
        "MANUAL"
      ],
      default: "VFS_APPOINTMENT"
    },

    idempotencyKey: {
      type: String,
      default: null
    },

    /*
     * =====================================================
     * LEGACY STATUS
     * =====================================================
     */

    status: {
      type: String,
      enum: [
        "created",
        "preparing",
        "otp_required",
        "otp_verified",
        "identity_verification",
        "calendar",
        "waiting_for_slot",
        "slot_received",
        "continuing",
        "review_pay",
        "book_appointment",
        "completed",
        "requires_user",
        "error",
        "cancelled"
      ],
      default: "created",
      index: true
    },

    /*
     * =====================================================
     * NOVO WORKFLOW STATE
     * =====================================================
     */

    workflowState: {
      type: String,
      enum: Object.values(STATES),
      default: STATES.CREATED,
      index: true
    },

    workflow: {
      previousState: {
        type: String,
        enum: [
          ...Object.values(STATES),
          null
        ],
        default: null
      },

      stateChangedAt: {
        type: Date,
        default: null
      },

      lastEvent: {
        type: String,
        default: null,
        trim: true
      },

      lastReason: {
        type: String,
        default: null,
        trim: true
      },

      transitionCount: {
        type: Number,
        default: 0,
        min: 0
      }
    },

    /*
     * =====================================================
     * PREFERÊNCIAS
     * =====================================================
     */

    preferredDates: {
      start: {
        type: String,
        default: null
      },

      end: {
        type: String,
        default: null
      }
    },

    preferredTime: {
      type: String,
      default: null
    },

    preferredWeekdays: {
      type: [Number],
      default: []
    },

    /*
     * =====================================================
     * SLOT
     * =====================================================
     */

    slot: {
      date: {
        type: String,
        default: null
      },

      time: {
        type: String,
        default: null
      },

      applicants: {
        type: [
          {
            client: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Client"
            },

            date: String,
            time: String
          }
        ],
        default: []
      }
    },

    /*
     * =====================================================
     * RADAR / BOT 2
     * =====================================================
     */

    radar: {
      enabled: {
        type: Boolean,
        default: false
      },

      lastAvailabilityHash: {
        type: String,
        default: null
      },

      lastChangeAt: {
        type: Date,
        default: null
      },

      lastSuccessfulCheckAt: {
        type: Date,
        default: null
      },

      nextCheckAt: {
        type: Date,
        default: null
      },

      consecutiveErrors: {
        type: Number,
        default: 0
      },

      consecutiveEmptyChecks: {
        type: Number,
        default: 0
      },

      currentIntervalMs: {
        type: Number,
        default: 5000
      },

      riskLevel: {
        type: String,
        enum: [
          "normal",
          "elevated",
          "cooldown",
          "blocked_signal"
        ],
        default: "normal"
      }
    },

    /*
     * =====================================================
     * RESULTADO
     * =====================================================
     */

    result: {
      reference: {
        type: String,
        default: null
      },

      entity: {
        type: String,
        default: null
      },

      transactionId: {
        type: String,
        default: null
      },

      paymentStatus: {
        type: String,
        default: null
      },

      paymentAmount: {
        type: mongoose.Schema.Types.Mixed,
        default: null
      },

      paymentCurrency: {
        type: String,
        default: null
      },

      paymentDeadline: {
        type: String,
        default: null
      },

      confirmationUrl: {
        type: String,
        default: null
      }
    },

    /*
     * =====================================================
     * DADOS PREPARADOS
     * =====================================================
     */

    preparedDataEncrypted: {
      type: String,
      default: null,
      select: false
    },

    preparedAt: {
      type: Date,
      default: null
    },

    /*
     * =====================================================
     * BOT 1
     * =====================================================
     */

    bot1: {
      status: {
        type: String,
        enum: [
          "idle",
          "starting",
          "running",
          "waiting",
          "continuing",
          "completed",
          "requires_user",
          "error"
        ],
        default: "idle"
      },

      workerId: {
        type: String,
        default: null
      },

      lastAction: {
        type: String,
        default: null
      },

      startedAt: {
        type: Date,
        default: null
      },

      completedAt: {
        type: Date,
        default: null
      },

      heartbeatAt: {
        type: Date,
        default: null
      },

      attempts: {
        type: Number,
        default: 0
      },

      lastAttemptAt: {
        type: Date,
        default: null
      }
    },

    /*
     * =====================================================
     * BOT 2
     * =====================================================
     */

    bot2: {
      status: {
        type: String,
        enum: [
          "idle",
          "monitoring",
          "slot_found",
          "cooldown",
          "requires_user",
          "error",
          "stopped"
        ],
        default: "idle"
      },

      monitoring: {
        type: Boolean,
        default: false
      },

      workerId: {
        type: String,
        default: null
      },

      lastCheckAt: {
        type: Date,
        default: null
      },

      heartbeatAt: {
        type: Date,
        default: null
      },

      slotDetectedAt: {
        type: Date,
        default: null
      },

      checks: {
        type: Number,
        default: 0
      },

      errors: {
        type: Number,
        default: 0
      }
    },

    /*
     * =====================================================
     * OTP
     * =====================================================
     */

    otp: {
      requestId: {
        type: String,
        default: null
      },

      status: {
        type: String,
        enum: [
          "not_required",
          "waiting",
          "verified",
          "expired",
          "failed"
        ],
        default: "not_required"
      },

      expiresAt: {
        type: Date,
        default: null
      },

      verifiedAt: {
        type: Date,
        default: null
      },

      attempts: {
        type: Number,
        default: 0
      }
    },

    /*
     * =====================================================
     * MÉTRICAS
     * =====================================================
     */

    metrics: {
      slotDetectionMs: {
        type: Number,
        default: null
      },

      resumeMs: {
        type: Number,
        default: null
      },

      completionMs: {
        type: Number,
        default: null
      },

      preparationMs: {
        type: Number,
        default: null
      },

      navigationCount: {
        type: Number,
        default: 0
      },

      reloadCount: {
        type: Number,
        default: 0
      }
    },

    /*
     * =====================================================
     * LOCK DE BOOKING
     * =====================================================
     */

    lock: {
      owner: {
        type: String,
        default: null
      },

      expiresAt: {
        type: Date,
        default: null
      }
    },

    /*
     * =====================================================
     * ERRO
     * =====================================================
     */

    error: {
      code: {
        type: String,
        default: null
      },

      message: {
        type: String,
        default: null
      },

      at: {
        type: Date,
        default: null
      },

      attempts: {
        type: Number,
        default: 0
      }
    }
  },
  {
    timestamps: true
  }
);

/*
 * =========================================================
 * LEGACY COMPATIBILITY HELPERS
 * =========================================================
 */

applicationSchema.methods.getWorkflowState = function () {
  if (this.workflowState) {
    return this.workflowState;
  }

  return (
    LEGACY_STATUS_TO_WORKFLOW_STATE[
      this.status
    ] ||
    STATES.CREATED
  );
};

applicationSchema.methods.canTransitionTo =
  function (nextState) {
    const currentState =
      this.getWorkflowState();

    return canTransition(
      currentState,
      nextState
    );
  };

applicationSchema.methods.transitionTo =
  function (
    nextState,
    metadata = {}
  ) {
    const currentState =
      this.getWorkflowState();

    const result = transition(
      this,
      nextState,
      metadata
    );

    const workflowToLegacyStatus = {
      [STATES.CREATED]:
        "created",

      [STATES.IDENTITY_PREPARATION]:
        "preparing",

      [STATES.OTP_REQUIRED]:
        "otp_required",

      [STATES.OTP_VERIFIED]:
        "otp_verified",

      [STATES.FACIAL_POSITIONS]:
        "identity_verification",

      [STATES.RADAR_ACTIVE]:
        "waiting_for_slot",

      [STATES.SLOT_FOUND]:
        "slot_received",

      [STATES.BOOKING]:
        "book_appointment",

      [STATES.REVIEW]:
        "review_pay",

      [STATES.COMPLETED]:
        "completed",

      [STATES.CANCELLED]:
        "cancelled",

      [STATES.ERROR]:
        "error"
    };

    if (
      workflowToLegacyStatus[
        nextState
      ]
    ) {
      this.status =
        workflowToLegacyStatus[
          nextState
        ];
    }

    if (!this.workflow) {
      this.workflow = {};
    }

    this.workflow.previousState =
      currentState;

    this.workflow.stateChangedAt =
      new Date();

    if (metadata.event) {
      this.workflow.lastEvent =
        String(metadata.event);
    }

    if (metadata.reason) {
      this.workflow.lastReason =
        String(metadata.reason);
    }

    this.workflow.transitionCount =
      Number(
        this.workflow.transitionCount || 0
      ) + 1;

    return result;
  };

applicationSchema.methods.syncWorkflowStateFromLegacy =
  function () {
    if (this.workflowState) {
      return this.workflowState;
    }

    const mapped =
      LEGACY_STATUS_TO_WORKFLOW_STATE[
        this.status
      ] ||
      STATES.CREATED;

    this.workflowState =
      mapped;

    if (!this.workflow) {
      this.workflow = {};
    }

    this.workflow.stateChangedAt =
      this.workflow.stateChangedAt ||
      new Date();

    return mapped;
  };

/*
 * =========================================================
 * INDEXES
 * =========================================================
 */

applicationSchema.index({
  accountId: 1,
  status: 1
});

applicationSchema.index({
  accountId: 1,
  workflowState: 1
});

applicationSchema.index({
  accountId: 1,
  groupId: 1
});

applicationSchema.index({
  accountId: 1,
  visaType: 1,
  status: 1
});

applicationSchema.index({
  accountId: 1,
  visaType: 1,
  workflowState: 1
});

applicationSchema.index({
  status: 1,
  "bot2.monitoring": 1
});

applicationSchema.index({
  workflowState: 1,
  "bot2.monitoring": 1
});

applicationSchema.index({
  status: 1,
  "lock.expiresAt": 1
});

applicationSchema.index({
  workflowState: 1,
  "lock.expiresAt": 1
});

applicationSchema.index(
  {
    accountId: 1,
    idempotencyKey: 1
  },
  {
    unique: true,
    sparse: true
  }
);

/*
 * =========================================================
 * MODEL
 * =========================================================
 */

module.exports = mongoose.model(
  "Application",
  applicationSchema
);
