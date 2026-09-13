const express =
  require("express");

const mongoose =
  require("mongoose");

const Application =
  require("../models/application");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const config =
  require("../config/environment");

function createSystemRouter({
  supervisor
}) {
  const router =
    express.Router();

  router.get(
    "/health",
    async (
      req,
      res
    ) => {
      const dbReady =
        mongoose.connection
          .readyState === 1;

      return res.status(
        dbReady ? 200 : 503
      ).json({
        success:
          dbReady,

        service:
          config.appName,

        database:
          dbReady
            ? "connected"
            : "disconnected",

        authentication:
          config.authEnabled
            ? "enabled"
            : "disabled",

        timestamp:
          new Date().toISOString()
      });
    }
  );

  router.use(
    requireAuth
  );

  router.get(
    "/status",
    requireRole(
      "owner",
      "admin"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        const accountId =
          req.user.accountId;

        const [
          total,
          waiting,
          processing,
          completed,
          errors,
          cancelled
        ] =
          await Promise.all([
            Application.countDocuments({
              accountId
            }),

            Application.countDocuments({
              accountId,

              status:
                "waiting_for_slot"
            }),

            Application.countDocuments({
              accountId,

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
              accountId,

              status:
                "completed"
            }),

            Application.countDocuments({
              accountId,

              status:
                "error"
            }),

            Application.countDocuments({
              accountId,

              status:
                "cancelled"
            })
          ]);

        const databaseConnected =
          mongoose.connection
            .readyState === 1;

        return res.json({
          success: true,

          platform: {
            name:
              config.appName,

            mode:
              config.authEnabled
                ? "authenticated"
                : "development",

            authentication:
              config.authEnabled
                ? "enabled"
                : "disabled"
          },

          database: {
            connected:
              databaseConnected,

            state:
              mongoose.connection
                .readyState
          },

          applications: {
            total,
            waiting,
            processing,
            completed,
            errors,
            cancelled
          },

          supervisor:
            supervisor.status(),

          timestamp:
            new Date().toISOString()
        });

      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}

module.exports =
  createSystemRouter;
