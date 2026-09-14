const express =
  require("express");

const Client =
  require("../models/client");

const AuditLog =
  require("../models/audit-log");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const FacialService =
  require("../services/facial/facial-service");

const PreflightService =
  require("../services/facial/preflight-service");

const router =
  express.Router();

const facial =
  new FacialService();

const preflight =
  new PreflightService();

router.use(
  requireAuth
);

/*
 * =========================================================
 * CREATE CLIENT
 * =========================================================
 */

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
        fullName,
        email,
        phone,
        dateOfBirth,
        nationality,
        gender,
        passportNumber,
        passportIssueDate,
        passportExpiryDate,
        passportCountry
      } = req.body;

      if (
        !fullName ||
        !email
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Full name and email are required"
          });
      }

      const client =
        await Client.create({
          accountId:
            req.user.accountId,

          createdBy:
            req.user._id,

          fullName:
            String(
              fullName
            )
              .trim()
              .slice(
                0,
                160
              ),

          email:
            String(
              email
            )
              .trim()
              .toLowerCase(),

          phone:
            phone ||
            null,

          dateOfBirth:
            dateOfBirth ||
            null,

          nationality:
            nationality ||
            null,

          gender:
            gender ||
            null,

          passportNumber:
            passportNumber ||
            null,

          passportIssueDate:
            passportIssueDate ||
            null,

          passportExpiryDate:
            passportExpiryDate ||
            null,

          passportCountry:
            passportCountry ||
            null
        });

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.create",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip
      });

      return res
        .status(201)
        .json({
          success: true,

          client
        });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * LIST CLIENTS
 * =========================================================
 */

router.get(
  "/",
  async (
    req,
    res,
    next
  ) => {
    try {
      const clients =
        await Client.find({
          accountId:
            req.user.accountId,

          active:
            true
        })
          .sort({
            createdAt:
              -1
          })
          .limit(200);

      return res.json({
        success: true,

        clients
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * GET CLIENT
 * =========================================================
 */

router.get(
  "/:id",
  async (
    req,
    res,
    next
  ) => {
    try {
      const client =
        await Client.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId
        });

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "Client not found"
          });
      }

      return res.json({
        success: true,

        client
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * UPDATE CLIENT
 * =========================================================
 */

router.patch(
  "/:id",
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
      const allowed = [
        "fullName",
        "email",
        "phone",
        "dateOfBirth",
        "nationality",
        "gender",
        "passportNumber",
        "passportIssueDate",
        "passportExpiryDate",
        "passportCountry"
      ];

      const update = {};

      for (
        const field
        of allowed
      ) {
        if (
          req.body[field] !==
          undefined
        ) {
          update[field] =
            req.body[field];
        }
      }

      if (
        update.email !==
        undefined
      ) {
        update.email =
          String(
            update.email
          )
            .trim()
            .toLowerCase();
      }

      if (
        update.fullName !==
        undefined
      ) {
        update.fullName =
          String(
            update.fullName
          )
            .trim()
            .slice(
              0,
              160
            );
      }

      const client =
        await Client.findOneAndUpdate(
          {
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          },

          {
            $set:
              update
          },

          {
            new: true,

            runValidators:
              true
          }
        );

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "Client not found"
          });
      }

      return res.json({
        success: true,

        client
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * SAVE OFFICIAL FACIAL PROFILE
 * =========================================================
 *
 * This route remains separate from the internal
 * facial preflight.
 */

router.post(
  "/:id/facial-profile",
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
        consentAccepted,
        positions,
        videoReference,
        templateReference
      } = req.body;

      if (
        consentAccepted !==
        true
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Biometric consent is required"
          });
      }

      facial.validatePositions(
        positions
      );

      if (
        !Array.isArray(
          positions
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Facial positions are required"
          });
      }

      if (
        positions.some(
          position =>
            !position.storageReference ||
            String(
              position.storageReference
            ).startsWith(
              "data:"
            )
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Facial media must use secure storage references"
          });
      }

      const client =
        await Client.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId
        });

      if (!client) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "Client not found"
          });
      }

      const profile =
        await facial.createProfile({
          clientId:
            req.params.id,

          positions,

          videoReference
        });

      client.facialConsent = {
        accepted:
          true,

        acceptedAt:
          new Date()
      };

      client.facialProfile = {
        provider:
          profile.provider,

        templateReference:
          templateReference ||
          null,

        positions,

        videoReference:
          videoReference ||
          null,

        /*
         * This is the official profile state.
         * It remains independent from preflight.
         */
        verificationStatus:
          "pending"
      };

      await client.save();

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.facial_profile",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip,

        metadata: {
          positions:
            positions.length
        }
      });

      return res.json({
        success: true,

        status:
          "pending",

        positions:
          positions.length
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * FACIAL PREFLIGHT INSTRUCTIONS
 * =========================================================
 */

router.get(
  "/:id/facial-preflight/instructions",
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
      const client =
        await Client.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId,

          active:
            true
        });

      if (!client) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Client not found"
          });
      }

      return res.json({
        success:
          true,

        clientId:
          client._id,

        instructions:
          preflight.getInstructions(),

        preflightStatus:
          client
            .facialPreflight
            ?.status ||
          "not_started"
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * FACIAL PREFLIGHT EVALUATION
 * =========================================================
 *
 * This endpoint evaluates preparation quality.
 *
 * It does NOT mark VFS facial verification as completed.
 */

router.post(
  "/:id/facial-preflight",
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
      const client =
        await Client.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId,

          active:
            true
        });

      if (!client) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Client not found"
          });
      }

      const {
        consentAccepted,
        positions,
        passportMatch
      } = req.body;

      /*
       * Evaluate the complete
       * 10-position sequence.
       */
      const result =
        preflight.evaluate({
          positions,

          passportMatch,

          consentAccepted
        });

      /*
       * Persist only the internal
       * preflight state.
       */
      client.facialConsent = {
        accepted:
          consentAccepted ===
          true,

        acceptedAt:
          consentAccepted ===
          true
            ? new Date()
            : client
                .facialConsent
                ?.acceptedAt ||
              null
      };

      client.facialPreflight = {
        status:
          result.passed
            ? "passed"
            : "requires_user",

        score:
          result.score,

        minimumScore:
          result.minimumScore,

        minimumPositionScore:
          result.minimumPositionScore,

        positionsCompleted:
          result.positionsCompleted,

        positionsRequired:
          result.positionsRequired,

        smileDetected:
          result.smileDetected,

        passportMatch:
          {
            name:
              passportMatch?.name ??
              null,

            dateOfBirth:
              passportMatch
                ?.dateOfBirth ??
              null,

            passportNumber:
              passportMatch
                ?.passportNumber ??
              null,

            nationality:
              passportMatch
                ?.nationality ??
              null
          },

        issues:
          result.issues,

        checkedAt:
          result.checkedAt,

        consentAcceptedAt:
          consentAccepted ===
          true
            ? new Date()
            : client
                .facialPreflight
                ?.consentAcceptedAt ||
              null
      };

      /*
       * IMPORTANT:
       *
       * Never change:
       *
       * client.facialProfile.verificationStatus
       *
       * here.
       *
       * The preflight is not the official
       * VFS facial verification.
       */

      await client.save();

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.facial_preflight",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip,

        metadata: {
          passed:
            result.passed,

          score:
            result.score,

          positionsCompleted:
            result.positionsCompleted,

          positionsRequired:
            result.positionsRequired,

          smileDetected:
            result.smileDetected,

          issues:
            result.issues
        }
      });

      return res.json({
        success:
          true,

        clientId:
          client._id,

        preflight:
          result,

        /*
         * Explicitly state that
         * VFS has not been verified.
         */
        vfsVerification:
          "not_completed"
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

/*
 * =========================================================
 * DELETE / DEACTIVATE CLIENT
 * =========================================================
 */

router.delete(
  "/:id",
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
      const client =
        await Client.findOneAndUpdate(
          {
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          },

          {
            $set: {
              active:
                false
            }
          },

          {
            new: true
          }
        );

      if (!client) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Client not found"
          });
      }

      return res.json({
        success:
          true
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);

module.exports =
  router;
