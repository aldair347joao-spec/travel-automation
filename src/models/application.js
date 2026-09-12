const mongoose = require("mongoose");

const applicationSchema =
  new mongoose.Schema(
    {
      client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
        index: true
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
        start: String,
        end: String
      },

      preferredTime: {
        type: String,
        default: null
      },

      slot: {
        date: String,
        time: String
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

      bot1: {
        status: {
          type: String,
          default: "idle"
        },

        lastAction: {
          type: String,
          default: null
        },

        preparedAt: Date,

        startedAt: Date,

        completedAt: Date
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

        lastCheckAt: Date
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
        slotDetectionMs: Number,
        resumeMs: Number,
        completionMs: Number
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
        code: String,
        message: String
      }
    },
    {
      timestamps: true
    }
  );

applicationSchema.index({
  status: 1,
  "bot2.monitoring": 1
});

module.exports =
  mongoose.model(
    "Application",
    applicationSchema
  );
