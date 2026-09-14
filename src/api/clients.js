const express =
  require("express");

const Client =
  require("../models/client");

const AuditLog =
  require("../models/audit-log");

const {
  requireAuth,
  requireRole
} = require("../middleware/auth");

const FacialService =
  require("../services/facial/facial-service");

const router =
  express.Router();

const facial =
  new FacialService();

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
        return res.status(400).json({
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
            String(fullName)
              .trim()
              .slice(0, 160),

          email:
            String(email)
              .trim()
              .toLowerCase(),

          phone:
            phone || null,

          dateOfBirth:
            dateOfBirth || null,

          nationality:
            nationality || null,

          gender:
            gender || null,

          passportNumber:
            passportNumber || null,

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
        ip: req.ip
      });

      return res.status(201).json({
        success: true,
        client
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
      const clients =
        await Client.find({
          accountId:
            req.user.accountId,
          active: true
        })
          .sort({
            createdAt: -1
          })
          .limit(200);

      return res.json({
        success: true,
        clients
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
      const client =
        await Client.findOne({
          _id: req.params.id,
          accountId:
            req.user.accountId
        });

      if (!client) {
        return res.status(404).json({
          success: false,
          error:
            "Client not found"
        });
      }

      return res.json({
        success: true,
        client
      });
    } catch (error) {
      next(error);
    }
  }
);

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
        const field of allowed
      ) {
        if (
          req.body[field] !==
          undefined
        ) {
          update[field] =
            req.body[field];
        }
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
            $set: update
          },
          {
            new: true,
            runValidators: true
          }
        );

      if (!client) {
        return res.status(404).json({
          success: false,
          error:
            "Client not found"
        });
      }

      return res.json({
        success: true,
        client
      });
    } catch (error) {
      next(error);
    }
  }
);

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
        consentAccepted !== true
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Biometric consent is required"
        });
      }

      facial.validatePositions(
        positions
      );

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
        return res.status(400).json({
          success: false,
          error:
            "Facial media must use secure storage references"
        });
      }

      const profile =
        await facial.createProfile({
          clientId:
            req.params.id,
          positions,
          videoReference
        });

      const client =
        await Client.findOne({
          _id:
            req.params.id,
          accountId:
            req.user.accountId
        });

      if (!client) {
        return res.status(404).json({
          success: false,
          error:
            "Client not found"
        });
      }

      client.facialConsent = {
        accepted: true,
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
        ip: req.ip,
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
    } catch (error) {
      next(error);
    }
  }
);
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
        return res.status(404).json({
          success:
            false,

          error:
            "Client not found"
        });
      }

      const PreflightService =
        require(
          "../services/facial/preflight-service"
        );

      const preflight =
        new PreflightService();

      return res.json({
        success:
          true,

        clientId:
          client._id,

        instructions:
          preflight.getInstructions()
      });
    } catch (error) {
      next(error);
    }
  }
);

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
        return res.status(404).json({
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
      } =
        req.body;

      const PreflightService =
        require(
          "../services/facial/preflight-service"
        );

      const preflight =
        new PreflightService();

      const result =
        preflight.evaluate({
          positions,

          passportMatch,

          consentAccepted
        });

      client.facialConsent = {
        accepted:
          consentAccepted ===
          true,

        acceptedAt:
          consentAccepted ===
          true
            ? new Date()
            : null
      };

      if (
        result.passed
      ) {
        client.facialProfile.verificationStatus =
          "pending";
      } else {
        client.facialProfile.verificationStatus =
          "failed";
      }

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
         * This means our preparation passed.
         * It does NOT mean that VFS's official
         * facial verification has been completed.
         */
        vfsVerification:
          "not_completed"
      });
    } catch (error) {
      next(error);
    }
  }
);
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
              active: false
            }
          },
          {
            new: true
          }
        );

      if (!client) {
        return res.status(404).json({
          success: false,
          error:
            "Client not found"
        });
      }

      return res.json({
        success: true
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
