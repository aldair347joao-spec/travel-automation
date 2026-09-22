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

      try {
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
      } catch (
        auditError
      ) {
        console.error(
          "[CLIENTS] AuditLog client.create failed:",
          auditError
        );
      }

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

      try {
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
      } catch (
        auditError
      ) {
        console.error(
          "[CLIENTS] AuditLog client.update failed:",
          auditError
        );
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
 * SAVE OFFICIAL FACIAL PROFILE
 * =========================================================
 *
 * ESTE ENDPOINT É MANTIDO POR COMPATIBILIDADE.
 *
 * O fluxo novo de liveness utiliza:
 *
 * POST /:id/facial-preflight
 *
 * Este endpoint antigo NÃO é utilizado pelo novo fluxo.
 *
 * IMPORTANTE:
 *
 * A liveness nova não guarda fotografias.
 * =========================================================
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


      /*
       * Localizar primeiro o cliente.
       */

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


      /*
       * Consentimento explícito ou já guardado.
       */

      const storedConsent =
        client?.facialConsent
          ?.accepted === true;

      const validConsent =
        consentAccepted === true ||
        storedConsent;

      if (!validConsent) {
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
       * Este endpoint antigo continua pertencendo
       * ao fluxo oficial de perfil facial.
       */

      facial.validatePositions(
        positions
      );


      /*
       * O perfil facial antigo exige referências
       * de armazenamento seguras.
       *
       * Não permitimos data URLs.
       */

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
            client
              .facialConsent
              ?.acceptedAt ||
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


      try {
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
      } catch (
        auditError
      ) {
        console.error(
          "[CLIENTS] AuditLog client.facial_profile failed:",
          auditError
        );
      }


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
 * verified
 * smileDetected
 * ...
 *
 * O preflight-service utiliza qualityScore.
 *
 * Fazemos somente a normalização dos dados existentes.
 *
 * NÃO criamos imagens.
 * NÃO criamos evidências.
 * NÃO simulamos movimentos.
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
 * A sessão precisa representar exatamente
 * as dez posições do fluxo.
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


    /*
     * A posição precisa ter sido efetivamente
     * validada pelo motor de liveness.
     */

    if (
      position?.verified !==
      true
    ) {

      issues.push(
        `Position ${number} was not verified`
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


    /*
     * O score continua sendo obrigatório como
     * dado técnico da posição, mas NÃO há
     * um valor mínimo usado como barreira.
     */

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


    /*
     * A décima posição precisa confirmar sorriso.
     */

    if (
      number === 10 &&
      position?.smileDetected !==
        true
    ) {

      issues.push(
        "Position 10 requires a natural smile"
      );
    }
  }


  /*
   * Confirmar todas as posições.
   */

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
 * FACIAL PREFLIGHT
 * =========================================================
 *
 * Endpoint utilizado pelo frontend quando as 10 posições
 * terminam.
 *
 * POST /api/clients/:id/facial-preflight
 *
 * RESULTADO:
 *
 * 10 posições corretas
 *        ↓
 * liveness aprovada
 *        ↓
 * sessão guardada
 *        ↓
 * cliente pronto para Administração
 *
 * Não há captura de fotografia.
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

      /*
       * =====================================================
       * CLIENTE
       * =====================================================
       */

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
       * =====================================================
       * CONSENTIMENTO
       * =====================================================
       *
       * O frontend atual envia consentAccepted=true.
       *
       * Também aceitamos um consentimento que já tenha
       * sido guardado no cliente.
       */

      const storedConsent =
        client?.facialConsent
          ?.accepted === true;


      const validConsent =
        consentAccepted === true ||
        storedConsent;


      if (!validConsent) {
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
       * =====================================================
       * POSIÇÕES
       * =====================================================
       */

      const normalizedPositions =
        normalizeLivenessPositions(
          positions
        );


      /*
       * =====================================================
       * VALIDAR ESTRUTURA
       * =====================================================
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
       * =====================================================
       * AVALIAÇÃO
       * =====================================================
       *
       * O preflight-service determina:
       *
       * 10 posições completas
       * + posições verificadas
       * + uma face
       * + sorriso
       *
       * = passed
       */

      const result =
        preflight.evaluate({
          positions:
            normalizedPositions,

          passportMatch,

          consentAccepted:
            validConsent
        });


      /*
       * O frontend pode enviar facialResult para
       * compatibilidade, mas não confiamos nesse campo
       * para fabricar uma aprovação.
       */

      void facialResult;


      /*
       * =====================================================
       * SESSION ID
       * =====================================================
       */

      const sessionId =
        crypto.randomUUID();


      const completedAt =
        result.passed
          ? new Date()
          : null;


      /*
       * =====================================================
       * STARTED AT
       * =====================================================
       */

      const completionDates =
        normalizedPositions
          .map(
            position => {

              if (
                !position?.completedAt
              ) {
                return null;
              }

              const date =
                new Date(
                  position.completedAt
                );

              if (
                Number.isNaN(
                  date.getTime()
                )
              ) {
                return null;
              }

              return date;
            }
          )
          .filter(
            date =>
              date !== null
          )
          .sort(
            (
              first,
              second
            ) =>
              first.getTime() -
              second.getTime()
          );


      const startedAt =
        completionDates[0] ||
        null;


      /*
       * =====================================================
       * LIVENESS SESSION
       * =====================================================
       *
       * Nenhuma fotografia é guardada aqui.
       *
       * Apenas os eventos da prova de vida.
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

          startedAt,

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
       * =====================================================
       * CONSENTIMENTO DO CLIENTE
       * =====================================================
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
       * =====================================================
       * PREFLIGHT
       * =====================================================
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
              .facialConsent
              ?.acceptedAt ||
            new Date()
        };


      /*
       * =====================================================
       * GUARDAR CLIENTE
       * =====================================================
       *
       * Este save acontece ANTES do AuditLog.
       *
       * Portanto, se a auditoria falhar, a liveness
       * continua guardada.
       */

      await client.save();


      /*
       * =====================================================
       * AUDITORIA
       * =====================================================
       *
       * A falha da auditoria não pode transformar
       * uma liveness já guardada numa falsa falha
       * apresentada ao cliente.
       */

      try {

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

      } catch (
        auditError
      ) {

        console.error(
          "[CLIENTS] AuditLog facial preflight failed:",
          auditError
        );
      }


      /*
       * =====================================================
       * RESPOSTA
       * =====================================================
       */

      return res.json({

        success:
          true,

        /*
         * Campo explícito para o frontend.
         */

        livenessPassed:
          result.passed,

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
         * A prova de vida local foi concluída.
         *
         * VFS é uma etapa externa e diferente.
         */

        vfsVerification:
          "not_completed"
      });

    } catch (
      error
    ) {

      console.error(
        "[CLIENTS] Facial preflight error:",
        error
      );

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


      try {

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

      } catch (
        auditError
      ) {

        console.error(
          "[CLIENTS] AuditLog client.deactivate failed:",
          auditError
        );
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
