const mongoose = require("mongoose");

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

const applicationSchema = new mongoose.Schema(
{
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

/*
 * Mantido para compatibilidade com
 * aplicações antigas de candidato único.
 */
client: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Client",
  required: false,
  index: true
},

/*
 * Identifica uma operação de grupo.
 */
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

idempotencyKey: {
  type: String,
  default: null
},

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
 * Resultado final e dados necessários
 * para continuar o processo depois do
 * pagamento.
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

  /*
   * Valor apresentado pelo fluxo oficial
   * de pagamento.
   */
  paymentAmount: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  /*
   * Moeda apresentada pelo fluxo oficial.
   */
  paymentCurrency: {
    type: String,
    default: null
  },

  /*
   * Prazo de pagamento apresentado pelo
   * fluxo oficial.
   */
  paymentDeadline: {
    type: String,
    default: null
  },

  confirmationUrl: {
    type: String,
    default: null
  }
},

preparedDataEncrypted: {
  type: String,
  default: null,
  select: false
},

preparedAt: {
  type: Date,
  default: null
},

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

applicationSchema.index({
accountId: 1,
status: 1
});

applicationSchema.index({
accountId: 1,
groupId: 1
});

applicationSchema.index({
status: 1,
"bot2.monitoring": 1
});

applicationSchema.index({
status: 1,
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

module.exports = mongoose.model(
"Application",
applicationSchema
);
