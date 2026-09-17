const mongoose = require("mongoose");

const applicationAdminControlSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        required: true,
        index: true
      },

      applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Application",
        required: true,
        unique: true,
        index: true
      },

      status: {
        type: String,
        enum: [
          "PENDING_REVIEW",
          "READY_FOR_AUTOMATION",
          "AUTOMATION_ACTIVE",
          "PAUSED",
          "COMPLETED",
          "CANCELLED"
        ],
        default: "PENDING_REVIEW",
        index: true
      },

      vfsCredentials: {
        emailEncrypted: {
          type: String,
          default: null
        },

        passwordEncrypted: {
          type: String,
          default: null
        },

        configuredAt: {
          type: Date,
          default: null
        },

        configuredBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null
        }
      },

      release: {
        enabled: {
          type: Boolean,
          default: false,
          index: true
        },

        releasedAt: {
          type: Date,
          default: null
        },

        releasedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null
        }
      },

      lastAdminAction: {
        action: {
          type: String,
          default: null
        },

        actorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null
        },

        at: {
          type: Date,
          default: null
        }
      },

      notes: {
        type: String,
        default: ""
      }
    },
    {
      timestamps: true
    }
  );

applicationAdminControlSchema.index(
  {
    accountId: 1,
    status: 1
  }
);

applicationAdminControlSchema.index(
  {
    accountId: 1,
    "release.enabled": 1
  }
);

module.exports =
  mongoose.model(
    "ApplicationAdminControl",
    applicationAdminControlSchema
  );
