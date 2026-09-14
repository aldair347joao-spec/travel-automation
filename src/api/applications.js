const express = require("express");

const Application =
  require("../models/application");

const Client =
  require("../models/client");

const AuditLog =
  require("../models/audit-log");

const {
  encryptJson
} = require("../utils/crypto");

const {
  requireAuth,
  requireRole
} = require("../middleware/auth");

function buildApplicant(client) {
  return {
    client: client._id,

    passport: {
      number:
        client.passportNumber || null,

      nationality:
        client.nationality || null,

      expiryDate:
        client.passportExpiryDate || null,

      validationStatus:
        "not_started"
    },

    personalData: {
      fullName:
        client.fullName || null,

      dateOfBirth:
        client.dateOfBirth || null,

      gender:
        client.gender || null,

      nationality:
        client.nationality || null,

      email:
        client.email || null,

      phone:
        client.phone || null
    },

    identityStatus:
      "not_started",

    vfsStatus:
      "not_started"
  };
}

function buildPreparedData(clients) {
  return {
    applicants:
      clients.map(client => ({
        clientId:
          client._id.toString(),

        fullName:
          client.fullName,

        email:
          client.email,

        phone:
          client.phone,

        dateOfBirth:
          client.dateOfBirth,

        nationality:
          client.nationality,

        gender:
          client.gender,

        passportNumber:
          client.passportNumber,

        passportIssueDate:
          client.passportIssueDate,

        passportExpiryDate:
          client.passportExpiryDate,

        passportCountry:
          client.passportCountry
      }))
  };
}

function createApplicationRouter({
  supervisor
}) {
  const router =
    express.Router();

  router.use(
    requireAuth
  );

  router.post(
    "/",
    requireRole(
      "owner",
      "admin",
      "operator"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        let clientIds = [];

        if (req.body.clientIds) {
          clientIds =
            Array.isArray(req.body.clientIds)
              ? req.body.clientIds
              : [];
        }

        if (
          req.body.clientId &&
          !clientIds.includes(
            req.body.clientId
          )
        ) {
          clientIds.push(
            req.body.clientId
          );
        }

        if (!clientIds.length) {
          return res.status(400).json({
            success: false,
            error:
              "clientId or clientIds is required"
          });
        }

        const uniqueClientIds =
          [...new Set(
            clientIds.map(
              String
            )
          )];

        if (
          uniqueClientIds.length >
          20
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Maximum of 20 applicants per application"
          });
        }

        const clients =
          await Client.find({
            _id: {
              $in:
                uniqueClientIds
            },

            accountId:
              req.user.accountId,

            active:
              true
          });

        if (
          clients.length !==
          uniqueClientIds.length
        ) {
          return res.status(404).json({
            success: false,
            error:
              "One or more clients were not found"
          });
        }

        const requestedMode =
          String(
            req.body.bookingMode ||
            (
              clients.length > 1
                ? "GROUP_REQUIRED"
                : "SINGLE"
            )
          ).toUpperCase();

        const allowedModes = [
          "SINGLE",
          "GROUP_REQUIRED",
          "PARTIAL_ALLOWED"
        ];

        if (
          !allowedModes.includes(
            requestedMode
          )
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid bookingMode"
          });
        }

        if (
          requestedMode ===
            "SINGLE" &&
          clients.length > 1
        ) {
          return res.status(400).json({
            success: false,
            error:
              "SINGLE mode accepts only one applicant"
          });
        }

        const idempotencyKey =
          req.get(
            "Idempotency-Key"
          ) ||
          req.body.idempotencyKey ||
          null;

        if (
          idempotencyKey
        ) {
          const existing =
            await Application.findOne({
              accountId:
                req.user.accountId,

              idempotencyKey
            });

          if (existing) {
            return res.status(200).json({
              success: true,
              existing: true,
              application:
                existing
            });
          }
        }

        const groupId =
          clients.length > 1
            ? (
                req.body.groupId ||
                `GRP-${Date.now()}`
              )
            : null;

        const preparedData =
          buildPreparedData(
            clients
          );

        const application =
          await Application.create({
            accountId:
              req.user.accountId,

            createdBy:
              req.user._id,

            /*
             * Compatibilidade com
             * código antigo.
             */
            client:
              clients[0]._id,

            groupId,

            bookingMode:
              requestedMode,

            applicantsCount:
              clients.length,

            applicants:
              clients.map(
                buildApplicant
              ),

            idempotencyKey,

            preferredDates:
              req.body.preferredDates ||
              {
                start: null,
                end: null
              },

            preferredTime:
              req.body.preferredTime ||
              null,

            preferredWeekdays:
              Array.isArray(
                req.body.preferredWeekdays
              )
                ? req.body.preferredWeekdays
                : [],

            preparedDataEncrypted:
              encryptJson(
                preparedData
              ),

            status:
              "created"
          });

        await AuditLog.create({
          actorId:
            req.user._id,

          action:
            "application.create",

          resource:
            "application",

          resourceId:
            application._id.toString(),

          ip:
            req.ip
        });

        return res.status(201).json({
          success: true,
          application
        });

      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/",
    async (
      req,
      res,
      next
    ) => {
      try {
        const applications =
          await Application.find({
            accountId:
              req.user.accountId
          })
            .populate(
              "client",
              "fullName email passportNumber"
            )
            .populate(
              "applicants.client",
              "fullName email passportNumber"
            )
            .sort({
              createdAt: -1
            })
            .limit(200);

        return res.json({
          success: true,
          applications
        });

      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/:id",
    async (
      req,
      res,
      next
    ) => {
      try {
        const application =
          await Application.findOne({
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          })
            .populate(
              "client"
            )
            .populate(
              "applicants.client"
            );

        if (!application) {
          return res.status(404).json({
            success: false,
            error:
              "Application not found"
          });
        }

        return res.json({
          success: true,
          application
        });

      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:id/prepare",
    requireRole(
      "owner",
      "admin",
      "operator"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        const application =
          await Application.findOne({
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          });

        if (!application) {
          return res.status(404).json({
            success: false,
            error:
              "Application not found"
          });
        }

        const result =
          await supervisor.prepare(
            application._id.toString()
          );

        return res.json({
          success: true,
          application:
            result
        });

      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/:id/continue",
    requireRole(
      "owner",
      "admin",
      "operator"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        const application =
          await Application.findOne({
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          });

        if (!application) {
          return res.status(404).json({
            success: false,
            error:
              "Application not found"
          });
        }

        const result =
          await supervisor.continueAfterVerification(
            application._id.toString()
          );

        return res.json({
          success: true,
          application:
            result
        });

      } catch (error) {
        next(error);
      }
    }
  );
  router.post(
  "/:id/otp/verify",
  requireRole(
    "owner",
    "admin",
    "operator"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      const application =
        await Application.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId
        });

      if (!application) {
        return res.status(404).json({
          success:
            false,

          error:
            "Application not found"
        });
      }

      const code =
        typeof req.body.code ===
        "string"
          ? req.body.code.trim()
          : "";

      if (!/^\d{4,8}$/.test(code)) {
        return res.status(400).json({
          success:
            false,

          error:
            "Invalid OTP format"
        });
      }

      const result =
        await supervisor.verifyOtp(
          application._id.toString(),
          code
        );

      return res.json({
        success:
          true,

        application:
          result,

        otp: {
          status:
            result.otp?.status ||
            null,

          verifiedAt:
            result.otp?.verifiedAt ||
            null
        }
      });
    } catch (error) {
      next(error);
    }
  }
);
  router.post(
    "/:id/resume",
    requireRole(
      "owner",
      "admin",
      "operator"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        const application =
          await Application.findOne({
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          });

        if (!application) {
          return res.status(404).json({
            success:
              false,

            error:
              "Application not found"
          });
        }

        if (
          application.status !==
          "requires_user"
        ) {
          return res.status(409).json({
            success:
              false,

            error:
              `Application cannot be resumed from status ${application.status}`
          });
        }

        const result =
          await supervisor.resumeApplication(
            application._id.toString()
          );

        return res.json({
          success:
            true,

          application:
            result.application,

          completed:
            result.completed === true,

          requiresUser:
            result.requiresUser === true,

          payment:
            result.payment ||
            null,

          confirmation:
            result.confirmation ||
            null,

          reason:
            result.reason ||
            null
        });
      } catch (error) {
        next(error);
      }
    }
  );
  router.post(
    "/:id/cancel",
    requireRole(
      "owner",
      "admin",
      "operator"
    ),
    async (
      req,
      res,
      next
    ) => {
      try {
        const application =
          await Application.findOneAndUpdate(
            {
              _id:
                req.params.id,

              accountId:
                req.user.accountId,

              status: {
                $nin: [
                  "completed",
                  "cancelled"
                ]
              }
            },
            {
              $set: {
                status:
                  "cancelled",

                "bot2.monitoring":
                  false,

                "radar.enabled":
                  false
              }
            },
            {
              new: true
            }
          );

        if (!application) {
          return res.status(404).json({
            success: false,
            error:
              "Application not found or cannot be cancelled"
          });
        }

        return res.json({
          success: true,
          application
        });

      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

module.exports =
  createApplicationRouter;
