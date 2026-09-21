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

  /*
   * =====================================================
   * CLIENT ACCOUNT LINK
   * =====================================================
   *
   * Quando o utilizador possui role "client", este campo
   * identifica exatamente o perfil Client ao qual a conta
   * pertence.
   *
   * Para owner/admin/operator/viewer permanece null.
   * =====================================================
   */

  clientId: {
    type:
      mongoose.Schema.Types.ObjectId,

    ref: "Client",

    default: null,

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
      "viewer",
      "client"
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

userSchema.index(
{
accountId: 1,
clientId: 1
}
);

module.exports =
mongoose.model(
"User",
userSchema
);
