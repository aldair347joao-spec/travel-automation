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
 * HELPERS
 * =========================================================
 */

function createFingerprint(
  buffer
) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function normalizeText(
  value
) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompact(
  value
) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function createInternalEmail(
  passportNumber
) {
  const normalized =
    normalizeCompact(
      passportNumber
    );

  const safe =
    normalized ||
    crypto
      .createHash("sha256")
      .update(
        String(
          Date.now()
        )
      )
      .digest("hex")
      .slice(0, 20);

  return `passport-${safe.toLowerCase()}@travel-automation.local`;
}

function mapMrzSex(
  sex
) {
  const normalized =
    String(sex || "")
      .trim()
      .toUpperCase();

  if (normalized === "M") {
    return "male";
  }

  if (normalized === "F") {
    return "female";
  }

  return null;
}

function buildPassportValidation(
  {
    status,
    passportType,
    fingerprint,
    mrzPresent,
    mrzValid,
    ocrValid,
    clientMatch,
    expired,
    issues
  }
) {
  return {
    status,

    passportType:
      passportType || "unknown",

    mrzPresent:
      Boolean(mrzPresent),

    mrzValid:
      Boolean(mrzValid),

    ocrValid:
      Boolean(ocrValid),

    clientMatch:
      Boolean(clientMatch),

    expired:
      Boolean(expired),

    fingerprint:
      fingerprint || null,

    issues:
      Array.isArray(issues)
        ? issues
        : [],

    checkedAt:
      new Date()
  };
}

/**
 * O OCR já produz vários pares candidatos.
 *
 * Não confiamos simplesmente no primeiro par.
 * Cada candidato é passado pelo validador MRZ.
 */
function findValidMrz(
  ocrResult
) {
  const pairs =
    Array.isArray(
      ocrResult?.mrzPairs
    )
      ? ocrResult.mrzPairs
      : [];

  const validCandidates = [];

  for (
    const pair of pairs
  ) {
    if (
      !pair ||
      !pair.line1 ||
      !pair.line2
    ) {
      continue;
    }

    const result =
      validation.validateMrz({
        line1:
          pair.line1,

        line2:
          pair.line2
      });

    if (
      result.success &&
      result.passed &&
      result.data
    ) {
      validCandidates.push({
        pair,
        validation:
          result
      });
    }
  }

  if (
    validCandidates.length === 0
  ) {
    return null;
  }

  /*
   * O OCR já ordena os pares por score.
   * Entre pares que realmente passaram na
   * validação, usamos o score original.
   */
  validCandidates.sort(
    (a, b) =>
      Number(
        b.pair?.score || 0
      ) -
      Number(
        a.pair?.score || 0
      )
  );

  return (
    validCandidates[0]
  );
}

/**
 * Cria um novo Client a partir dos dados
 * efetivamente presentes no passaporte.
 *
 * O cliente não precisa preencher previamente
 * um perfil manual.
 */
async function createClientFromPassport(
  {
    accountId,
    createdBy,
    mrzData,
    passportType
  }
) {
  const passportNumber =
    normalizeText(
      mrzData.passportNumber
    );

  if (!passportNumber) {
    throw new Error(
      "Passport number could not be extracted"
    );
  }

  /*
   * Primeiro procuramos um cliente existente
   * pelo número do passaporte.
   */
  let client =
    await Client.findOne({
      accountId,

      passportNumber,

      active: true
    });

  const fullName =
    normalizeText(
      mrzData.fullName
    );

  if (!fullName) {
    throw new Error(
      "Full name could not be extracted from passport"
    );
  }

  const email =
    createInternalEmail(
      passportNumber
    );

  const gender =
    mapMrzSex(
      mrzData.sex
    );

  if (!client) {
    client =
      new Client({
        accountId,

        createdBy,

        fullName,

        email,

        phone:
          null,

        dateOfBirth:
          mrzData.dateOfBirth ||
          null,

        nationality:
          mrzData.nationality ||
          null,

        gender,

        passportNumber,

        passportIssueDate:
          null,

        passportExpiryDate:
          mrzData.passportExpiryDate ||
          null,

        passportCountry:
          mrzData.issuingCountry ||
          null,

        passportType:
          passportType || "unknown",

        passportValidation:
          {
            status:
              "pending",

            passportType:
              passportType ||
              "unknown",

            mrzPresent:
              true,

            mrzValid:
              true,

            ocrValid:
              false,

            clientMatch:
              true,

            expired:
              false,

            fingerprint:
              null,

            issues: [],

            checkedAt:
              new Date()
          },

        active:
          true
      });
  } else {
    /*
     * Atualizamos os dados documentais com
     * a fonte primária: o passaporte.
     */
    client.fullName =
      fullName;

    client.dateOfBirth =
      mrzData.dateOfBirth ||
      client.dateOfBirth ||
      null;

    client.nationality =
      mrzData.nationality ||
      client.nationality ||
      null;

    client.gender =
      gender ||
      client.gender ||
      null;

    client.passportNumber =
      passportNumber;

    client.passportExpiryDate =
      mrzData.passportExpiryDate ||
      client.passportExpiryDate ||
      null;

    client.passportCountry =
      mrzData.issuingCountry ||
      client.passportCountry ||
      null;

    client.passportType =
      passportType ||
      "unknown";
  }

  return client;
}

/*
 * =========================================================
 * IMPORTAÇÃO AUTOMÁTICA DO PASSAPORTE
 *
 * Fluxo:
 *
 * fotografia
 *    ↓
 * OCR
 *    ↓
 * candidatos MRZ
 *    ↓
 * validação MRZ
 *    ↓
 * validade do passaporte
 *    ↓
 * criação/atualização automática do Client
 *    ↓
 * armazenamento privado
 *    ↓
 * resposta com clientId
 *
 * IMPORTANTE:
 * Esta rota vem ANTES de /:clientId.
 * =========================================================
 */

router.post(
  "/import",
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

            status:
              "requires_user",

            error:
              "Passport image is required"
          });
      }

      const fingerprint =
        createFingerprint(
          req.file.buffer
        );

      /*
       * =====================================================
       * 1. OCR
       * =====================================================
       */

      const ocrResult =
        await ocr.extract(
          req.file.buffer
        );

      /*
       * =====================================================
       * 2. ENCONTRAR UM PAR MRZ REALMENTE VÁLIDO
       * =====================================================
       */

      const validMrz =
        findValidMrz(
          ocrResult
        );

      if (!validMrz) {
        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Não foi possível validar o passaporte. Fotografe o documento completo, sem reflexos e com a zona inferior perfeitamente visível.",

            passportValidation:
              buildPassportValidation({
                status:
                  "requires_user",

                passportType:
                  "unknown",

                fingerprint,

                mrzPresent:
                  Array.isArray(
                    ocrResult?.mrzPairs
                  ) &&
                  ocrResult.mrzPairs.length >
                    0,

                mrzValid:
                  false,

                ocrValid:
                  Number(
                    ocrResult?.confidence
                  ) >= 70,

                clientMatch:
                  false,

                expired:
                  false,

                issues: [
                  "Nenhum par MRZ passou na validação de segurança"
                ]
              })
          });
      }

      const mrzResult =
        validMrz.validation;

      const mrzData =
        mrzResult.data;

      /*
       * =====================================================
       * 3. VALIDAR EXPIRAÇÃO
       * =====================================================
       */

      const expiry =
        validation.validateExpiry(
          mrzData
        );

      if (!expiry.passed) {
        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "O passaporte está expirado ou a data de validade não pôde ser confirmada.",

            passportValidation:
              buildPassportValidation({
                status:
                  "requires_user",

                passportType:
                  "unknown",

                fingerprint,

                mrzPresent:
                  true,

                mrzValid:
                  true,

                ocrValid:
                  Number(
                    ocrResult?.confidence
                  ) >= 70,

                clientMatch:
                  false,

                expired:
                  true,

                issues: [
                  expiry.reason ||
                    "Passport expiry validation failed"
                ]
              })
          });
      }

      /*
       * =====================================================
       * 4. DETECTAR TIPO
       * =====================================================
       *
       * Não alegamos que NFC foi validado.
       */

      const passportType =
        validation.detectPassportType({
          declaredType:
            null,

          ocrText:
            ocrResult.text,

          documentType:
            mrzData.documentType,

          issuingCountry:
            mrzData.issuingCountry
        });

      /*
       * =====================================================
       * 5. CRIAR/ATUALIZAR CLIENTE AUTOMATICAMENTE
       * =====================================================
       */

      const client =
        await createClientFromPassport({
          accountId:
            req.user.accountId,

          createdBy:
            req.user._id,

          mrzData,

          passportType:
            passportType.type
        });

      /*
       * =====================================================
       * 6. VALIDAR O DOCUMENTO CONTRA O PERFIL
       * =====================================================
       *
       * Para um cliente recém-criado os dados foram
       * originados do próprio MRZ.
       *
       * Para um cliente existente fazemos uma nova
       * comparação antes de aceitar o documento.
       */

      const clientComparison =
        validation.compareWithClient(
          mrzData,
          client
        );

      if (
        !clientComparison.passed
      ) {
        client.passportValidation =
          buildPassportValidation({
            status:
              "requires_user",

            passportType:
              passportType.type,

            fingerprint,

            mrzPresent:
              true,

            mrzValid:
              true,

            ocrValid:
              Number(
                ocrResult?.confidence
              ) >= 70,

            clientMatch:
              false,

            expired:
              false,

            issues:
              clientComparison.mismatches.map(
                field =>
                  `Client/MRZ mismatch: ${field}`
              )
          });

        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Os dados do passaporte não coincidem com o perfil existente.",

            clientId:
              client._id,

            passportValidation:
              client.passportValidation
          });
      }

      /*
       * =====================================================
       * 7. MARCAR O PASSAPORTE COMO VALIDADO
       * =====================================================
       */

      client.passportType =
        passportType.type;

      client.passportValidation =
        buildPassportValidation({
          status:
            "passed",

          passportType:
            passportType.type,

          fingerprint,

          mrzPresent:
            true,

          mrzValid:
            true,

          ocrValid:
            Number(
              ocrResult?.confidence
            ) >= 70,

          clientMatch:
            true,

          expired:
            false,

          issues: []
        });

      /*
       * =====================================================
       * 8. GUARDAR DOCUMENTO PRIVADO E CRIPTOGRAFADO
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

      /*
       * =====================================================
       * 9. AUDITORIA
       * =====================================================
       */

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.passport_import",

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
            stored.duplicate,

          fingerprint,

          passportType:
            passportType.type
        }
      });

      /*
       * =====================================================
       * 10. RESPOSTA PARA O FRONTEND
       * =====================================================
       *
       * O frontend recebe o clientId e pode imediatamente
       * iniciar o reconhecimento facial.
       */

      return res.json({
        success: true,

        status:
          "passed",

        next:
          "facial_preflight",

        clientId:
          client._id,

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

          email:
            client.email,

          dateOfBirth:
            client.dateOfBirth,

          nationality:
            client.nationality,

          gender:
            client.gender,

          passportNumber:
            client.passportNumber,

          passportExpiryDate:
            client.passportExpiryDate,

          passportCountry:
            client.passportCountry,

          passportType:
            client.passportType
        },

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
            stored.document._id,

          duplicate:
            stored.duplicate
        },

        passportValidation:
          client.passportValidation
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
 * UPLOAD + VALIDATE PASSPORT PARA CLIENTE EXISTENTE
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

      const fingerprint =
        createFingerprint(
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

          fingerprint,

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

            passportValidation:
              client.passportValidation
          });
      }

      /*
       * =====================================================
       * 2. ENCONTRAR MRZ VALIDADA
       * =====================================================
       */

      const validMrz =
        findValidMrz(
          ocrResult
        );

      if (!validMrz) {
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

          fingerprint,

          issues: [
            "A MRZ foi encontrada, mas não passou na validação de segurança."
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
              "A MRZ foi encontrada, mas não passou na validação de segurança.",

            passportValidation:
              client.passportValidation
          });
      }

      const mrzResult =
        validMrz.validation;

      const mrzData =
        mrzResult.data;

      /*
       * =====================================================
       * 3. COMPARAR COM CLIENTE
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

            passportValidation:
              client.passportValidation
          });
      }

      /*
       * =====================================================
       * 7. GUARDAR DOCUMENTO
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

      /*
       * =====================================================
       * 8. AUDITORIA
       * =====================================================
       */

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
       * 9. RESPOSTA
       * =====================================================
       */

      return res.json({
        success: true,

        status:
          "passed",

        clientId:
          client._id,

        next:
          "facial_preflight",

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
        },

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

          dateOfBirth:
            client.dateOfBirth,

          nationality:
            client.nationality,

          gender:
            client.gender,

          passportNumber:
            client.passportNumber,

          passportExpiryDate:
            client.passportExpiryDate,

          passportCountry:
            client.passportCountry,

          passportType:
            client.passportType
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

        clientId:
          client._id,

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

          email:
            client.email,

          dateOfBirth:
            client.dateOfBirth,

          nationality:
            client.nationality,

          gender:
            client.gender,

          passportNumber:
            client.passportNumber,

          passportExpiryDate:
            client.passportExpiryDate,

          passportCountry:
            client.passportCountry,

          passportType:
            client.passportType
        },

        passportValidation:
          client.passportValidation,

        passportType:
          client.passportType,

        facialPreflight:
          client.facialPreflight,

        facialProfile:
          client.facialProfile
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
