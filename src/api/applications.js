const express =
  require("express");

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
        const {
          clientId,
          preferredDates,
          preferredTime
        } = req.body;

        if (!clientId) {
          return res.status(400).json({
            success: false,
            error:
              "clientId is required"
          });
        }

        const client =
          await Client.findOne({
            _id: clientId,
            accountId:
              req.user.accountId,
            active: true
          });

        if (!client) {
          return res.status(404).json({
            success: false,
            error:
              "Client not found"
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

        const preparedData = {
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
        };

        const application =
          await Application.create({
            accountId:
              req.user.accountId,

            createdBy:
              req.user._id,

            client:
              client._id,

            idempotencyKey,

            preferredDates:
              preferredDates || {
                start: null,
                end: null
              },

            preferredTime:
              preferredTime ||
              null,

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
          ip: req.ip
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
          }).populate(
            "client"
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
