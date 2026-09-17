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
 *
 * Isto permite atualizar Bot 1, Bot 2 e Supervisor
 * progressivamente sem quebrar documentos existentes.
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

    /*
     * Serviço solicitado no VFS.
     *
     * Mantemos como string para permitir que diferentes
     * categorias de visto tenham serviços diferentes sem
     * bloquear a aplicação com um enum demasiado rígido.
     */
    serviceType: {
      type: String,
      default: null,
      trim: true
    },

    /*
     * Alguns tipos de visto não seguem o fluxo normal
     * de marcação pelo VFS.
     *
     * Exemplos futuros:
     * - VFS_APPOINTMENT
     * - CONSULATE_ASSIGNED
     * - MANUAL
     */
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
     *
     * NÃO remover ainda.
     *
     * Código existente do projeto ainda pode consultar
     * este campo. A nova arquitetura usa workflowState.
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
     *
     * Este passa a ser o estado oficial da aplicação.
     */

    workflowState: {
      type: String,
      enum: Object.values(STATES),
      default: STATES.CREATED,
      index: true
    },

    /*
     * Histórico mínimo necessário para recuperação,
     * auditoria operacional e debugging.
     */

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
     * PREFERÊNCIAS DO CLIENTE
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
     * RESULTADO DA MARCAÇÃO
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

/**
 * Retorna o workflowState real.
 *
 * Para documentos antigos que ainda não possuem
 * workflowState, convertemos temporariamente o status legado.
 */
applicationSchema.methods.getWorkflowState = function () {
  if (this.workflowState) {
    return this.workflowState;
  }

  return (
    LEGACY_STATUS_TO_WORKFLOW_STATE[this.status] ||
    STATES.CREATED
  );
};

/**
 * Verifica se uma transição é permitida.
 */
applicationSchema.methods.canTransitionTo = function (
  nextState
) {
  const currentState = this.getWorkflowState();

  return canTransition(
    currentState,
    nextState
  );
};

/**
 * Transiciona a aplicação para um novo estado.
 *
 * Não altera automaticamente o status legado.
 * A sincronização temporária será feita pelos serviços
 * durante a migração do sistema.
 */
applicationSchema.methods.transitionTo = function (
  nextState,
  metadata = {}
) {
  const currentState = this.getWorkflowState();

  const result = transition(
    this,
    nextState,
    metadata
  );

  /*
   * Mantemos uma pequena camada de sincronização para
   * estados antigos que possuem equivalente claro.
   */

  const workflowToLegacyStatus = {
    [STATES.CREATED]: "created",
    [STATES.IDENTITY_PREPARATION]: "preparing",
    [STATES.OTP_REQUIRED]: "otp_required",
    [STATES.OTP_VERIFIED]: "otp_verified",
    [STATES.FACIAL_POSITIONS]: "identity_verification",
    [STATES.RADAR_ACTIVE]: "waiting_for_slot",
    [STATES.SLOT_FOUND]: "slot_received",
    [STATES.BOOKING]: "book_appointment",
    [STATES.REVIEW]: "review_pay",
    [STATES.COMPLETED]: "completed",
    [STATES.CANCELLED]: "cancelled",
    [STATES.ERROR]: "error"
  };

  if (workflowToLegacyStatus[nextState]) {
    this.status = workflowToLegacyStatus[nextState];
  }

  /*
   * Guardamos o estado anterior explicitamente.
   */
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
    Number(this.workflow.transitionCount || 0) + 1;

  return result;
};

/**
 * Sincroniza um documento legado para o novo
 * workflowState sem executar uma transição.
 */
applicationSchema.methods.syncWorkflowStateFromLegacy =
  function () {
    if (this.workflowState) {
      return this.workflowState;
    }

    const mapped =
      LEGACY_STATUS_TO_WORKFLOW_STATE[
        this.status
      ] || STATES.CREATED;

    this.workflowState = mapped;

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
