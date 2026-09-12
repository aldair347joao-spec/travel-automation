const mongoose = require("mongoose");

const userSchema =
  new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
      },

      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
      },

      passwordHash: {
        type: String,
        select: false
      },

      role: {
        type: String,
        enum: [
          "owner",
          "admin",
          "operator",
          "viewer"
        ],
        default: "operator"
      },

      active: {
        type: Boolean,
        default: true
      },

      failedLoginAttempts: {
        type: Number,
        default: 0
      },

      lockedUntil: {
        type: Date,
        default: null
      },

      lastLoginAt: {
        type: Date,
        default: null
      }
    },
    {
      timestamps: true
    }
  );

module.exports =
  mongoose.model(
    "User",
    userSchema
  );
