const express =
  require("express");

const multer =
  require("multer");

const crypto =
  require("crypto");

const Client =
  require("../models/client");

const AuditLog =
  require("../models/audit-log");

const PassportOcrService =
  require("../services/passport/passport-ocr-service");

const PassportValidationService =
  require("../services/passport/passport-validation-service");

const PassportStorageService =
  require("../services/passport/passport-storage-service");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const router =
  express.Router();

const ocr =
  new PassportOcrService();

const validation =
  new PassportValidationService();

const storage =
  new PassportStorageService();

const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        6 * 1024 * 1024,

      files: 1
    },

    fileFilter(
      req,
      file,
      callback
    ) {
      if (
        ![
          "image/jpeg",
          "image/png"
        ].includes(
          file.mimetype
        )
      ) {
        return callback(
          new Error(
            "Only JPEG and PNG passport images are supported"
          )
        );
      }

      callback(
        null,
        true
      );
    }
  });

router.use(
  requireAuth
);

/*
 * =========================================================
 * UPLOAD + VALIDATE PASSPORT
 * =========================================================
 */

router.post(
  "/:clientId",
  requireRole(
    "owner",
    "admin",
    "operator"
  ),
  upload.single(
    "passport"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Passport image is required"
          });
      }

      const client =
        await Client.findOne({
          _id:
            req.params.clientId,

          accountId:
            req.user.accountId,

          active:
            true
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

      /*
       * =====================================================
       * 1. OCR
       * =====================================================
       */

      const ocrResult =
        await ocr.extract(
          req.file.buffer
        );

      if (
        !ocrResult.mrz
      ) {
        client.passportValidation = {
          status:
            "requires_user",

          passportType:
            "unknown",

          mrzPresent:
            false,

          mrzValid:
            false,

          ocrValid:
            false,

          clientMatch:
            false,

          expired:
            false,

          fingerprint:
            crypto
              .createHash("sha256")
              .update(
                req.file.buffer
              )
              .digest("hex"),

          issues: [
            "MRZ do passaporte não foi identificada com qualidade suficiente"
          ],

          checkedAt:
            new Date()
        };

        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Não foi possível ler a MRZ do passaporte. Envie uma fotografia mais nítida e completa.",

            passportValidation: {
              status:
                "requires_user",

              passportType:
                "unknown",

              mrzPresent:
                false,

              mrzValid:
                false,

              ocrValid:
                false,

              clientMatch:
                false,

              expired:
                false
            }
          });
      }

      /*
       * =====================================================
       * 2. MRZ
       * =====================================================
       */

      const mrzResult =
        validation.validateMrz({
          line1:
            ocrResult.mrz.line1,

          line2:
            ocrResult.mrz.line2
        });

      if (
        !mrzResult.passed
      ) {
        client.passportValidation = {
          status:
            "requires_user",

          passportType:
            "unknown",

          mrzPresent:
            true,

          mrzValid:
            false,

          ocrValid:
            Number(
              ocrResult.confidence
            ) >= 70,

          clientMatch:
            false,

          expired:
            false,

          fingerprint:
            crypto
              .createHash("sha256")
              .update(
                req.file.buffer
              )
              .digest("hex"),

          issues:
            mrzResult.errors,

          checkedAt:
            new Date()
        };

        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "A MRZ foi encontrada, mas não passou na validação de segurança.",

            passportValidation: {
              status:
                "requires_user",

              passportType:
                "unknown",

              mrzPresent:
                true,

              mrzValid:
                false,

              ocrValid:
                Number(
                  ocrResult.confidence
                ) >= 70,

              clientMatch:
                false,

              expired:
                false
            }
          });
      }

      const mrzData =
        mrzResult.data;

      /*
       * =====================================================
       * 3. COMPARAR COM O CLIENTE
       * =====================================================
       */

      const clientComparison =
        validation.compareWithClient(
          mrzData,
          client
        );

      /*
       * =====================================================
       * 4. VALIDAR VALIDADE
       * =====================================================
       */

      const expiry =
        validation.validateExpiry(
          mrzData
        );

      /*
       * =====================================================
       * 5. DETERMINAR TIPO
       * =====================================================
       *
       * Não fingimos detectar NFC apenas
       * olhando para uma fotografia.
       */

      const passportType =
        validation.detectPassportType({
          declaredType:
            client.passportType,

          ocrText:
            ocrResult.text,

          documentType:
            mrzData.documentType,

          issuingCountry:
            mrzData.issuingCountry
        });

      const fingerprint =
        crypto
          .createHash("sha256")
          .update(
            req.file.buffer
          )
          .digest("hex");

      const issues = [
        ...clientComparison.mismatches
      ];

      if (
        !expiry.passed
      ) {
        issues.push(
          "Passport expired"
        );
      }

      const passed =
        mrzResult.passed &&
        clientComparison.passed &&
        expiry.passed;

      /*
       * =====================================================
       * 6. ATUALIZAR CLIENTE
       * =====================================================
       */

      client.passportType =
        passportType.type;

      client.passportValidation = {
        status:
          passed
            ? "passed"
            : "requires_user",

        passportType:
          passportType.type,

        mrzPresent:
          true,

        mrzValid:
          mrzResult.passed,

        ocrValid:
          Number(
            ocrResult.confidence
          ) >= 70,

        clientMatch:
          clientComparison.passed,

        expired:
          expiry.expired,

        fingerprint,

        issues,

        checkedAt:
          new Date()
      };

      /*
       * Se a validação não passou,
       * não guardamos o documento como
       * documento utilizável pelo bot.
       */

      if (!passed) {
        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "O passaporte precisa de correção antes de poder ser utilizado pelo bot.",

            passportValidation: {
              status:
                "requires_user",

              passportType:
                passportType.type,

              mrzPresent:
                true,

              mrzValid:
                mrzResult.passed,

              ocrValid:
                Number(
                  ocrResult.confidence
                ) >= 70,

              clientMatch:
                clientComparison.passed,

              expired:
                expiry.expired,

              issues
            }
          });
      }

      /*
       * =====================================================
       * 7. GUARDAR DOCUMENTO CRIPTOGRAFADO
       * =====================================================
       */

      const stored =
        await storage.save({
          accountId:
            req.user.accountId,

          clientId:
            client._id,

          buffer:
            req.file.buffer,

          mimeType:
            req.file.mimetype,

          originalName:
            req.file.originalname,

          validationStatus:
            "passed"
        });

      await client.save();

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.passport_upload",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip,

        metadata: {
          documentId:
            stored.document._id.toString(),

          mimeType:
            req.file.mimetype,

          size:
            req.file.size,

          validation:
            "passed",

          duplicate:
            stored.duplicate
        }
      });

      /*
       * =====================================================
       * RESPOSTA
       * =====================================================
       */

      return res.json({
        success: true,

        status:
          "passed",

        clientId:
          client._id,

        passport: {
          ready:
            true,

          passportType:
            passportType.type,

          mrzValid:
            true,

          clientMatch:
            true,

          expired:
            false,

          documentStored:
            true,

          documentId:
            stored.document._id
        }
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
 * GET PASSPORT STATUS
 * =========================================================
 */

router.get(
  "/:clientId/status",
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
            req.params.clientId,

          accountId:
            req.user.accountId,

          active:
            true
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

        passportValidation:
          client.passportValidation,

        passportType:
          client.passportType
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
