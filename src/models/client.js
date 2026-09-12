const mongoose = require("mongoose");

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
        required: true
      },

      storageReference: {
        type: String,
        required: true
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
          validator: value =>
            value.length <= 10,
          message:
            "Maximum of 10 facial positions"
        }
      },

      videoReference: {
        type: String,
        default: null
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
      fullName: {
        type: String,
        required: true,
        trim: true
      },

      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
      },

      phone: {
        type: String,
        default: null
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

module.exports =
  mongoose.model(
    "Client",
    clientSchema
  );
