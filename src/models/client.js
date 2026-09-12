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

      verificationStatus: {
        type: String,
        enum: [
          "not_started",
          "pending",
          "verified",
          "failed"
        ],
        default: "not_started"
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
        type: mongoose.Schema.Types.ObjectId,
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
        type: facialProfileSchema,
        default: () => ({
          positions: []
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
