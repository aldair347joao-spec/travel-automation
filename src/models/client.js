const mongoose =
  require("mongoose");

const facePositionSchema =
  new mongoose.Schema(
    {
      position: {
        type: Number,
        min: 1,
        max: 10,
        required: true
      },

      label: {
        type: String,
        required: true,
        maxlength: 80
      },

      storageReference: {
        type: String,
        required: true,
        maxlength: 500
      },

      capturedAt: {
        type: Date,
        default: Date.now
      },

      verified: {
        type: Boolean,
        default: false
      }
    },
    {
      _id: false
    }
  );

const facialProfileSchema =
  new mongoose.Schema(
    {
      provider: {
        type: String,
        default: null
      },

      templateReference: {
        type: String,
        default: null
      },

      positions: {
        type: [facePositionSchema],

        validate: {
          validator(value) {
            return value.length <= 10;
          },

          message:
            "Maximum of 10 facial positions"
        }
      },

      videoReference: {
        type: String,
        default: null,
        maxlength: 500
      },

      /*
       * This field represents ONLY the
       * official facial verification state.
       *
       * The internal preflight below is
       * deliberately kept separate.
       */
      verificationStatus: {
        type: String,

        enum: [
          "not_started",
          "pending",
          "verified",
          "failed"
        ],

        default:
          "not_started"
      }
    },
    {
      _id: false
    }
  );

/*
 * Internal facial preparation.
 *
 * IMPORTANT:
 * facialPreflight.passed does NOT mean
 * that VFS facial verification has been
 * completed.
 */
const facialPreflightSchema =
  new mongoose.Schema(
    {
      status: {
        type: String,

        enum: [
          "not_started",
          "in_progress",
          "passed",
          "requires_user",
          "failed"
        ],

        default:
          "not_started"
      },

      score: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      minimumScore: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      minimumPositionScore: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      positionsCompleted: {
        type: Number,
        min: 0,
        max: 10,
        default: 0
      },

      positionsRequired: {
        type: Number,
        min: 0,
        max: 10,
        default: 10
      },

      smileDetected: {
        type: Boolean,
        default: false
      },

      passportMatch: {
        name: {
          type: Boolean,
          default: null
        },

        dateOfBirth: {
          type: Boolean,
          default: null
        },

        passportNumber: {
          type: Boolean,
          default: null
        },

        nationality: {
          type: Boolean,
          default: null
        }
      },

      issues: {
        type: [String],
        default: []
      },

      checkedAt: {
        type: Date,
        default: null
      },

      consentAcceptedAt: {
        type: Date,
        default: null
      }
    },
    {
      _id: false
    }
  );

const clientSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        required: true,
        index: true
      },

      createdBy: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref: "User",

        required: true
      },

      fullName: {
        type: String,

        required: true,

        trim: true,

        maxlength: 160
      },

      email: {
        type: String,

        required: true,

        lowercase: true,

        trim: true,

        maxlength: 254
      },

      phone: {
        type: String,

        default: null,

        maxlength: 40
      },

      dateOfBirth: {
        type: String,

        default: null
      },

      nationality: {
        type: String,

        default: null
      },

      gender: {
        type: String,

        default: null
      },

      passportNumber: {
        type: String,

        default: null
      },

      passportIssueDate: {
        type: String,

        default: null
      },

      passportExpiryDate: {
        type: String,

        default: null
      },

      passportCountry: {
        type: String,

        default: null
      },

      facialConsent: {
        accepted: {
          type: Boolean,

          default: false
        },

        acceptedAt: {
          type: Date,

          default: null
        }
      },

      facialProfile: {
        type:
          facialProfileSchema,

        default: () => ({
          positions: []
        })
      },

      /*
       * Internal quality/readiness check.
       *
       * This is NOT the VFS verification.
       */
      facialPreflight: {
        type:
          facialPreflightSchema,

        default: () => ({
          status:
            "not_started",

          positionsCompleted:
            0,

          positionsRequired:
            10,

          issues: []
        })
      },

      active: {
        type: Boolean,

        default: true
      }
    },

    {
      timestamps: true
    }
  );

clientSchema.index({
  accountId: 1,
  email: 1
});

module.exports =
  mongoose.model(
    "Client",
    clientSchema
  );
