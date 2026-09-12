const mongoose =
  require("mongoose");

const auditLogSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        index: true,
        default: null
      },

      actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
      },

      action: {
        type: String,
        required: true,
        index: true
      },

      resource: {
        type: String,
        default: null
      },

      resourceId: {
        type: String,
        default: null
      },

      ip: {
        type: String,
        default: null
      },

      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    },
    {
      timestamps: true
    }
  );

auditLogSchema.index({
  accountId: 1,
  createdAt: -1
});

module.exports =
  mongoose.model(
    "AuditLog",
    auditLogSchema
  );
