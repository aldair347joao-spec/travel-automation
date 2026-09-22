"use strict";

const crypto =
  require("crypto");

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

const PassportStorageService =
  require("../services/passport/passport-storage-service");

const passportStorage =
  new PassportStorageService();

const FacialService =
  require("../services/facial/facial-service");

const preflight =
  require("../services/facial/preflight-service");

const router =
  express.Router();

const facial =
  new FacialService();

router.use(
  requireAuth
);


/*
 * =========================================================
 * ACCESS HELPERS
 * =========================================================
 */

function isClientUser(req) {
  return (
    req.user &&
    req.user.role ===
      "client"
  );
}


function isAdministrativeUser(req) {
  return (
    req.user &&
    [
      "owner",
      "admin",
      "operator",
      "viewer"
    ].includes(
      req.user.role
    )
  );
}


function clientOwnershipQuery(
  req
) {
  const query = {
    accountId:
      req.user.accountId
  };

  if (
    isClientUser(req)
  ) {
    query.createdBy =
      req.user._id;
  }

  return query;
}


async function findAccessibleClient(
  req,
  clientId,
  options = {}
) {
  const query = {
    _id:
      clientId,

    ...clientOwnershipQuery(
      req
    )
  };

  if (
    options.activeOnly
  ) {
    query.active =
      true;
  }

  return Client.findOne(
    query
  );
}


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
    "operator",
    "client"
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
        passportCountry,
        passportType
      } =
        req.body;

      if (
        !fullName ||
        !String(
          fullName
        ).trim()
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Full name is required"
          });
      }

      if (
        !email ||
        !String(
          email
        ).trim()
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Email is required"
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
              .toLowerCase()
              .slice(
                0,
                254
              ),

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
            null,

          passportType:
            [
              "legacy",
              "electronic",
              "unknown"
            ].includes(
              passportType
            )
              ? passportType
              : "unknown"
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
          success:
            true,

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
      const query =
        clientOwnershipQuery(
          req
        );

      query.active =
        true;

      const clients =
        await Client.find(
          query
        )
          .sort({
            createdAt:
              -1
          })
          .limit(200);

      return res.json({
        success:
          true,

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
        await findAccessibleClient(
          req,
          req.params.id
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
          true,

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
    "operator",
    "client"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      const allowed =
        [
          "fullName",
          "email",
          "phone",
          "dateOfBirth",
          "nationality",
          "gender",
          "passportNumber",
          "passportIssueDate",
          "passportExpiryDate",
          "passportCountry",
          "passportType"
        ];

      const update =
        {};

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
            .toLowerCase()
            .slice(
              0,
              254
            );
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

      if (
        update.passportType !==
        undefined
      ) {
        if (
          ![
            "legacy",
            "electronic",
            "unknown"
          ].includes(
            update.passportType
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid passport type"
            });
        }
      }

      delete update.accountId;
      delete update.createdBy;
      delete update.active;

      const client =
        await Client.findOneAndUpdate(
          {
            _id:
              req.params.id,

            ...clientOwnershipQuery(
              req
            )
          },

          {
            $set:
              update
          },

          {
            new:
              true,

            runValidators:
              true
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

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.update",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip
      });

      return res.json({
        success:
          true,

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
 * ESTE ENDPOINT É MANTIDO POR COMPATIBILIDADE.
 *
 * O fluxo novo de liveness utiliza:
 *
 * POST /:id/facial-preflight
 *
 * Portanto não removemos este endpoint para não quebrar
 * funcionalidades existentes.
 */

router.post(
  "/:id/facial-profile",
  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
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
      } =
        req.body;

      if (
        consentAccepted !==
        true
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Biometric consent is required"
          });
      }

      if (
        !Array.isArray(
          positions
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Facial positions are required"
          });
      }

      /*
       * Este endpoint continua pertencendo ao fluxo
       * oficial de perfil facial e, por isso, mantém
       * a validação de referências seguras.
       */

      facial.validatePositions(
        positions
      );

      if (
        positions.some(
          position =>
            !position ||
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
            success:
              false,

            error:
              "Facial media must use secure storage references"
          });
      }

      const client =
        await findAccessibleClient(
          req,
          req.params.id,
          {
            activeOnly:
              true
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

      const profile =
        await facial.createProfile({
          clientId:
            client._id,

          positions,

          videoReference
        });

      client.facialConsent =
        {
          accepted:
            true,

          acceptedAt:
            new Date()
        };

      client.facialProfile =
        {
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

        ip:
          req.ip,

        metadata: {
          positions:
            positions.length
        }
      });

      return res.json({
        success:
          true,

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
 * GET PASSPORT IMAGE FOR LOCAL FACIAL MATCH
 * =========================================================
 */

router.get(
  "/:id/facial-preflight/passport-image",
  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      const client =
        await findAccessibleClient(
          req,
          req.params.id,
          {
            activeOnly:
              true
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

      const document =
        await passportStorage.getForBot({
          accountId:
            req.user.accountId,

          clientId:
            client._id
        });

      if (!document) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "No validated passport image is available for this client"
          });
      }

      const allowedMimeTypes =
        [
          "image/jpeg",
          "image/png"
        ];

      const mimeType =
        allowedMimeTypes.includes(
          document.mimeType
        )
          ? document.mimeType
          : "image/jpeg";

      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, private"
      );

      res.setHeader(
        "Pragma",
        "no-cache"
      );

      res.setHeader(
        "Expires",
        "0"
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      res.setHeader(
        "Content-Type",
        mimeType
      );

      res.setHeader(
        "Content-Disposition",
        "inline"
      );

      return res.end(
        document.buffer
      );
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
    "operator",
    "client"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      const client =
        await findAccessibleClient(
          req,
          req.params.id,
          {
            activeOnly:
              true
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
 * NORMALIZE LIVENESS POSITIONS
 * =========================================================
 *
 * O frontend envia:
 *
 * score
 * positionScore
 * faceDetected
 * singleFace
 * ...
 *
 * O preflight-service usa qualityScore.
 *
 * Fazemos essa adaptação aqui para que os dois módulos
 * falem a mesma linguagem.
 *
 * IMPORTANTE:
 *
 * Não criamos qualquer evidência artificial.
 * Apenas normalizamos valores que já foram produzidos
 * pelo motor facial.
 */

function normalizeLivenessPositions(
  positions
) {
  if (
    !Array.isArray(
      positions
    )
  ) {
    return [];
  }

  return positions.map(
    position => {
      const score =
        Number(
          position?.score
        );

      const positionScore =
        Number(
          position?.positionScore
        );

      const qualityScore =
        Number.isFinite(
          positionScore
        )
          ? positionScore
          : Number.isFinite(
              score
            )
            ? score
            : 0;

      return {
        ...position,

        position:
          Number(
            position?.position
          ),

        sequence:
          Number(
            position?.sequence
          ),

        score:
          Number.isFinite(
            score
          )
            ? score
            : qualityScore,

        positionScore:
          Number.isFinite(
            positionScore
          )
            ? positionScore
            : qualityScore,

        /*
         * Campo exigido pelo preflight-service.
         */
        qualityScore:
          Math.max(
            0,
            Math.min(
              1,
              qualityScore
            )
          ),

        faceDetected:
          position
            ?.faceDetected ===
          true,

        singleFace:
          position
            ?.singleFace ===
          true,

        smileDetected:
          position
            ?.smileDetected ===
          true,

        verified:
          position
            ?.verified ===
          true
      };
    }
  );
}


/*
 * =========================================================
 * VALIDATE LIVENESS EVENT SHAPE
 * =========================================================
 *
 * Não aceitamos uma lista arbitrária de objetos.
 *
 * A sessão precisa representar as dez posições do fluxo.
 */

function validateLivenessEventShape(
  positions
) {
  const issues =
    [];

  if (
    !Array.isArray(
      positions
    )
  ) {
    return {
      valid:
        false,

      issues: [
        "Liveness positions must be an array"
      ]
    };
  }

  if (
    positions.length !==
    10
  ) {
    issues.push(
      "A complete liveness session must contain exactly 10 positions"
    );
  }

  const seen =
    new Set();

  for (
    const position
    of positions
  ) {
    const number =
      Number(
        position?.position
      );

    if (
      !Number.isInteger(
        number
      ) ||
      number < 1 ||
      number > 10
    ) {
      issues.push(
        `Invalid liveness position: ${position?.position}`
      );

      continue;
    }

    if (
      seen.has(
        number
      )
    ) {
      issues.push(
        `Duplicate liveness position: ${number}`
      );

      continue;
    }

    seen.add(
      number
    );

    if (
      !position?.completedAt
    ) {
      issues.push(
        `Position ${number} has no completion timestamp`
      );
    }

    if (
      position?.faceDetected !==
      true
    ) {
      issues.push(
        `Position ${number} has no confirmed face`
      );
    }

    if (
      position?.singleFace !==
      true
    ) {
      issues.push(
        `Position ${number} does not contain exactly one face`
      );
    }

    if (
      !Number.isFinite(
        Number(
          position?.qualityScore
        )
      )
    ) {
      issues.push(
        `Position ${number} has no valid quality score`
      );
    }
  }

  for (
    let number = 1;
    number <= 10;
    number += 1
  ) {
    if (
      !seen.has(
        number
      )
    ) {
      issues.push(
        `Missing liveness position ${number}`
      );
    }
  }

  return {
    valid:
      issues.length === 0,

    issues
  };
}


/*
 * =========================================================
 * FACIAL PREFLIGHT EVALUATION
 * =========================================================
 *
 * ESTE É O ENDPOINT QUE O frontend chama quando termina
 * as dez posições.
 *
 * Agora ele guarda uma sessão de LIVENESS, não fotografias.
 */

router.post(
  "/:id/facial-preflight",
  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
  ),
  async (
    req,
    res,
    next
  ) => {
    try {
      const client =
        await findAccessibleClient(
          req,
          req.params.id,
          {
            activeOnly:
              true
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

      const {
        consentAccepted,
        positions,
        passportMatch,
        facialResult
      } =
        req.body;

      /*
       * ======================================================
       * CONSENT
       * ======================================================
       */

      if (
        consentAccepted !==
        true
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Biometric consent is required"
          });
      }

      /*
       * ======================================================
       * NORMALIZAÇÃO
       * ======================================================
       */

      const normalizedPositions =
        normalizeLivenessPositions(
          positions
        );

      /*
       * ======================================================
       * FORMATO DA SESSÃO
       * ======================================================
       */

      const eventShape =
        validateLivenessEventShape(
          normalizedPositions
        );

      if (
        !eventShape.valid
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Invalid liveness session",

            issues:
              eventShape.issues
          });
      }

      /*
       * ======================================================
       * AVALIAÇÃO OFICIAL DO PREFLIGHT
       * ======================================================
       */

      const result =
        preflight.evaluate({
          positions:
            normalizedPositions,

          passportMatch,

          consentAccepted
        });

      /*
       * ======================================================
       * SESSION ID
       * ======================================================
       */

      const sessionId =
        crypto.randomUUID();

      const completedAt =
        result.passed
          ? new Date()
          : null;

      /*
       * ======================================================
       * LIVENESS SESSION
       * ======================================================
       *
       * Esta estrutura não contém imagens.
       *
       * Contém somente eventos de liveness.
       */

      const livenessSession =
        {
          sessionId,

          status:
            result.passed
              ? "passed"
              : "requires_user",

          source:
            "local_liveness",

          startedAt:
            normalizedPositions
              .map(
                position =>
                  position.completedAt
                    ? new Date(
                        position.completedAt
                      )
                    : null
              )
              .filter(
                value =>
                  value instanceof Date &&
                  !Number.isNaN(
                    value.getTime()
                  )
              )
              .sort(
                (
                  a,
                  b
                ) =>
                  a.getTime() -
                  b.getTime()
              )[0] ||
            null,

          completedAt,

          score:
            result.score,

          completedCount:
            result.positionsCompleted,

          total:
            result.positionsRequired,

          verified:
            result.passed,

          positions:
            normalizedPositions
        };

      /*
       * ======================================================
       * CONSENT
       * ======================================================
       */

      client.facialConsent =
        {
          accepted:
            true,

          acceptedAt:
            client
              .facialConsent
              ?.acceptedAt ||
            new Date()
        };

      /*
       * ======================================================
       * PREFLIGHT
       * ======================================================
       */

      client.facialPreflight =
        {
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
                passportMatch
                  ?.name ??
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

          livenessSession,

          issues:
            result.issues,

          checkedAt:
            result.checkedAt,

          consentAcceptedAt:
            client
              .facialPreflight
              ?.consentAcceptedAt ||
            new Date()
        };

      /*
       * ======================================================
       * SALVAR
       * ======================================================
       */

      await client.save();

      /*
       * ======================================================
       * AUDITORIA
       * ======================================================
       */

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

          sessionId,

          liveness:
            true,

          issues:
            result.issues
        }
      });

      /*
       * ======================================================
       * RESPOSTA
       * ======================================================
       */

      return res.json({
        success:
          true,

        clientId:
          client._id,

        preflight:
          result,

        livenessSession: {
          sessionId,

          status:
            livenessSession.status,

          verified:
            livenessSession.verified,

          score:
            livenessSession.score,

          completedCount:
            livenessSession.completedCount,

          total:
            livenessSession.total,

          completedAt:
            livenessSession.completedAt
        },

        /*
         * Mantemos isto explícito:
         *
         * liveness concluído NÃO significa que uma
         * verificação VFS externa foi executada.
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
            new:
              true
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

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.deactivate",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip
      });

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
