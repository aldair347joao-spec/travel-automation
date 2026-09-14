const mongoose = require("mongoose");

const passportDocumentSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      required: true,
      index: true
    },

    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true
    },

    mimeType: {
      type: String,
      required: true,
      enum: [
        "image/jpeg",
        "image/png"
      ]
    },

    originalName: {
      type: String,
      required: true,
      maxlength: 255
    },

    size: {
      type: Number,
      required: true,
      min: 1
    },

    sha256: {
      type: String,
      required: true,
      index: true
    },

    encryptedData: {
      type: String,
      required: true
    },

    validationStatus: {
      type: String,
      enum: [
        "pending",
        "passed",
        "requires_user",
        "failed"
      ],
      default: "pending"
    },

    uploadedAt: {
      type: Date,
      default: Date.now
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true
    },

    usedByBotAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

passportDocumentSchema.index({
  clientId: 1,
  createdAt: -1
});

passportDocumentSchema.index({
  expiresAt: 1
});

module.exports = mongoose.model(
  "PassportDocument",
  passportDocumentSchema
);
