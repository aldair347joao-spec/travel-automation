const mongoose =
  require("mongoose");

const applicationSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        required: true,
        index: true
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      },

      client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
        index: true
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
          "identity_verification",
          "calendar",
          "waiting_for_slot",
          "slot_received",
          "continuing",
          "completed",
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

      slot: {
        date: {
          type: String,
          default: null
        },

        time: {
          type: String,
          default: null
        }
      },

      result: {
        reference: {
          type: String,
          default: null
        },

        entity: {
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
        }
      },

      bot2: {
        status: {
          type: String,
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

        slotDetectedAt: {
          type: Date,
          default: null
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

module.exports =
  mongoose.model(
    "Application",
    applicationSchema
  );
