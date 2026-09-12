const express = require("express");

const mongoose = require("mongoose");

const Application = require("../models/application");

const {
  requireAuth,
  requireRole
} = require("../middleware/auth");

function createSystemRouter({ supervisor }) {
  const router = express.Router();

  router.get("/health", async (req, res) => {
    const dbReady =
      mongoose.connection.readyState === 1;

    return res.status(dbReady ? 200 : 503).json({
      success: dbReady,
      service: "travel-automation",
      database: dbReady ? "connected" : "disconnected",
      timestamp: new Date().toISOString()
    });
  });

  router.use(requireAuth);

  router.get(
    "/status",
    requireRole("owner", "admin"),
    async (req, res, next) => {
      try {
        const [
          total,
          waiting,
          processing,
          completed,
          errors
        ] = await Promise.all([
          Application.countDocuments({
            accountId: req.user.accountId
          }),

          Application.countDocuments({
            accountId: req.user.accountId,
            status: "waiting_for_slot"
          }),

          Application.countDocuments({
            accountId: req.user.accountId,
            status: {
              $in: [
                "preparing",
                "otp_required",
                "identity_verification",
                "calendar",
                "slot_received",
                "continuing"
              ]
            }
          }),

          Application.countDocuments({
            accountId: req.user.accountId,
            status: "completed"
          }),

          Application.countDocuments({
            accountId: req.user.accountId,
            status: "error"
          })
        ]);

        return res.json({
          success: true,

          database: {
            connected:
              mongoose.connection.readyState === 1
          },

          applications: {
            total,
            waiting,
            processing,
            completed,
            errors
          },

          supervisor:
            supervisor.status()
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports = createSystemRouter;
