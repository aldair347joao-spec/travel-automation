const mongoose =
  require("mongoose");

const userSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        required: true,
        index: true
      },

      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
      },

      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
      },

      passwordHash: {
        type: String,
        required: true,
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

      sessionVersion: {
        type: Number,
        default: 0
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

userSchema.index(
  {
    accountId: 1,
    email: 1
  },
  {
    unique: true
  }
);

module.exports =
  mongoose.model(
    "User",
    userSchema
  );
