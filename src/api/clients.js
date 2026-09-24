"use strict";

const crypto =
  require("crypto");

const express =
  require("express");

const multer =
  require("multer");

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

const LivenessVideoStorageService =
  require("../services/facial/liveness-video-storage-service");

const livenessVideoStorage =
  new LivenessVideoStorageService();

const router =
  express.Router();

const facial =
  new FacialService();

router.use(
  requireAuth
);


/*
 * =========================================================
 * LIVENESS VIDEO UPLOAD
 * =========================================================
 *
 * Recebe SOMENTE os segmentos das posições CORRETAS.
 *
 * O frontend envia:
 *
 * livenessVideo_1
 * livenessMeta_1
 *
 * ...
 *
 * livenessVideo_10
 * livenessMeta_10
 *
 * O backend nunca confia apenas no frontend.
 *
 * Antes de guardar:
 *
 * 1. confirma o cliente;
 * 2. confirma a sessão;
 * 3. confirma que a sessão passou;
 * 4. confirma que a posição existe;
 * 5. confirma que a posição foi verificada;
 * 6. confirma que existe exatamente uma posição correspondente;
 * 7. só então guarda o vídeo.
 *
 * Tentativas erradas não são armazenadas.
 * =========================================================
 */

const livenessVideoUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        Number(
          process.env.LIVENESS_VIDEO_MAX_SEGMENT_BYTES
        ) ||
        5 * 1024 * 1024,

      files:
        10,

      fields:
        25,

      fieldSize:
        128 * 1024,

      parts:
        40
    }
  });


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
 * RECEBER SEGMENTO REAL DE LIVENESS
 * =========================================================
 *
 * POST:
 *
 * /api/clients/:id/liveness-video
 *
 * Recebe um segmento correspondente a uma posição que já
 * foi validada pelo motor local.
 *
 * IMPORTANTE:
 *
 * O backend NÃO aceita:
 *
 * - posição não concluída;
 * - posição não verificada;
 * - posição fora de 1..10;
 * - sessão diferente da sessão persistida;
 * - vídeo sem sessão;
 * - vídeo sem metadata;
 * - vídeo de outro cliente.
 *
 * Apenas os segmentos aprovados chegam ao armazenamento.
 * =========================================================
 */

router.post(
  "/:id/liveness-video",
  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
  ),
  livenessVideoUpload.any(),
  async (
    req,
    res,
    next
  ) => {
    try {

      /*
       * -----------------------------------------------------
       * CLIENTE
       * -----------------------------------------------------
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
       * -----------------------------------------------------
       * FICHEIRO
       * -----------------------------------------------------
       */

      if (
        !req.file ||
        !Buffer.isBuffer(
          req.file.buffer
        ) ||
        !req.file.buffer.length
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Nenhum segmento de vídeo de liveness foi recebido."
          });
      }


      /*
       * -----------------------------------------------------
       * METADATA
       * -----------------------------------------------------
       *
       * Aceitamos os formatos:
       *
       * livenessMeta
       * metadata
       * meta
       *
       * para manter compatibilidade entre versões do frontend.
       */

      let metadata =
        null;


      const rawMetadata =
        req.body?.livenessMeta ||
        req.body?.metadata ||
        req.body?.meta ||
        null;


      if (
        rawMetadata
      ) {
        try {

          metadata =
            typeof rawMetadata ===
            "string"
              ? JSON.parse(
                  rawMetadata
                )
              : rawMetadata;

        } catch (
          metadataError
        ) {

          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "A metadata do segmento de liveness é inválida."
            });
        }
      }


      if (
        !metadata ||
        typeof metadata !==
          "object"
      ) {
        metadata =
          {};
      }


      /*
       * -----------------------------------------------------
       * SESSION ID
       * -----------------------------------------------------
       */

      const sessionId =
        String(
          metadata.sessionId ||
          req.body?.sessionId ||
          ""
        ).trim();


      if (
        !sessionId
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "sessionId é obrigatório para guardar o segmento de liveness."
          });
      }


      /*
       * -----------------------------------------------------
       * SESSÃO PERSISTIDA
       * -----------------------------------------------------
       */

      const savedSession =
        client
          ?.facialPreflight
          ?.livenessSession;


      if (
        !savedSession
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "A sessão de liveness ainda não existe."
          });
      }


      if (
        String(
          savedSession.sessionId
        ) !==
        sessionId
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "O segmento de vídeo pertence a uma sessão de liveness diferente."
          });
      }


      if (
        savedSession.status !==
          "passed" ||
        savedSession.verified !==
          true
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "A sessão de liveness ainda não foi aprovada."
          });
      }


      /*
       * -----------------------------------------------------
       * POSIÇÃO
       * -----------------------------------------------------
       */

      const requestedPosition =
        Number(
          metadata.position ||
          metadata.sequence ||
          req.body?.position ||
          req.body?.sequence
        );


      if (
        !Number.isInteger(
          requestedPosition
        ) ||
        requestedPosition < 1 ||
        requestedPosition > 10
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "A posição de liveness deve estar entre 1 e 10."
          });
      }


      /*
       * -----------------------------------------------------
       * LOCALIZAR A POSIÇÃO APROVADA
       * -----------------------------------------------------
       */

      const approvedPosition =
        Array.isArray(
          savedSession.positions
        )
          ? savedSession.positions.find(
              position =>
                Number(
                  position?.position
                ) ===
                  requestedPosition ||
                Number(
                  position?.sequence
                ) ===
                  requestedPosition
            )
          : null;


      if (
        !approvedPosition
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              `A posição ${requestedPosition} não pertence à sessão de liveness.`
          });
      }


      /*
       * -----------------------------------------------------
       * GARANTIA FUNDAMENTAL
       * -----------------------------------------------------
       *
       * Só guardamos posições que o backend já confirmou
       * como verificadas.
       */

      if (
        approvedPosition.verified !==
        true
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              `A posição ${requestedPosition} não foi validada pelo motor de liveness.`
          });
      }


      if (
        approvedPosition.faceDetected !==
        true
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              `A posição ${requestedPosition} não possui rosto confirmado.`
          });
      }


      if (
        approvedPosition.singleFace !==
        true
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              `A posição ${requestedPosition} não possui exatamente um rosto confirmado.`
          });
      }


      if (
        !approvedPosition.completedAt
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              `A posição ${requestedPosition} não possui conclusão válida.`
          });
      }


      /*
       * -----------------------------------------------------
       * MIME
       * -----------------------------------------------------
       */

      const mimeType =
        String(
          req.file.mimetype ||
          metadata.mimeType ||
          ""
        )
          .split(";")[0]
          .trim()
          .toLowerCase();


      if (
        ![
          "video/webm",
          "video/mp4",
          "video/quicktime"
        ].includes(
          mimeType
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Formato de vídeo de liveness não suportado."
          });
      }


      /*
       * -----------------------------------------------------
       * GUARDAR NO GRIDFS
       * -----------------------------------------------------
       */

      const stored =
        await livenessVideoStorage.save({
          accountId:
            req.user.accountId,

          clientId:
            client._id.toString(),

          sessionId,

          position:
            requestedPosition,

          sequence:
            Number(
              metadata.sequence ||
              approvedPosition.sequence ||
              requestedPosition
            ),

          label:
            metadata.label ||
            approvedPosition.label ||
            null,

          instruction:
            metadata.instruction ||
            approvedPosition.instruction ||
            null,

          score:
            metadata.score ??
            approvedPosition.score ??
            null,

          positionScore:
            metadata.positionScore ??
            approvedPosition.positionScore ??
            null,

          buffer:
            req.file.buffer,

          mimeType,

          startedAt:
            metadata.startedAt ||
            null,

          completedAt:
            metadata.completedAt ||
            approvedPosition.completedAt ||
            null
        });


      /*
       * -----------------------------------------------------
       * ATUALIZAR METADATA DA SESSÃO
       * -----------------------------------------------------
       *
       * O Client não recebe o vídeo.
       *
       * Apenas fica marcado que existe vídeo e qual foi o
       * último segmento guardado.
       *
       * Todos os segmentos continuam no GridFS e podem ser
       * recuperados através do mesmo clientId + sessionId.
       */

      const videoUpdateResult =
        await Client.updateOne(
          {
            _id:
              client._id,

            accountId:
              req.user.accountId
          },

          {
            $set: {
              "facialPreflight.livenessSession.video.available":
                true,

              "facialPreflight.livenessSession.video.storage":
                "gridfs",

              "facialPreflight.livenessSession.video.videoId":
                stored.videoId,

              "facialPreflight.livenessSession.video.mimeType":
                stored.mimeType,

              "facialPreflight.livenessSession.video.originalSize":
                stored.originalSize,

              "facialPreflight.livenessSession.video.uploadedAt":
                stored.uploadedAt,

              "facialPreflight.livenessSession.video.expiresAt":
                stored.expiresAt
            }
          }
        );


      const matchedCount =
        Number.isFinite(
          Number(
            videoUpdateResult?.matchedCount
          )
        )
          ? Number(
              videoUpdateResult.matchedCount
            )
          : Number(
              videoUpdateResult?.n ||
              0
            );


      if (
        matchedCount !==
        1
      ) {

        /*
         * Se o Client não pôde ser atualizado depois de guardar
         * o vídeo, removemos o segmento recém-criado para não
         * deixar armazenamento órfão.
         */

        try {

          await livenessVideoStorage.delete({
            accountId:
              req.user.accountId,

            clientId:
              client._id.toString(),

            sessionId,

            position:
              requestedPosition
          });

        } catch (
          cleanupError
        ) {

          console.error(
            "[CLIENTS] Falha ao remover segmento órfão:",
            cleanupError
          );
        }


        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "O segmento foi recebido mas não foi possível atualizar a sessão de liveness."
          });
      }


      /*
       * -----------------------------------------------------
       * CONTAR SEGMENTOS EXISTENTES
       * -----------------------------------------------------
       */

      const storedFiles =
        await livenessVideoStorage.findAll({
          accountId:
            req.user.accountId,

          clientId:
            client._id.toString(),

          sessionId
        });


      const segments =
        storedFiles
          .map(
            file => ({
              videoId:
                String(
                  file._id
                ),

              position:
                Number(
                  file?.metadata
                    ?.position
                ),

              sequence:
                Number(
                  file?.metadata
                    ?.sequence
                ),

              label:
                file?.metadata
                  ?.label ||
                null,

              instruction:
                file?.metadata
                  ?.instruction ||
                null,

              mimeType:
                file?.metadata
                  ?.originalMimeType ||
                null,

              originalSize:
                Number(
                  file?.metadata
                    ?.originalSize ||
                  0
                ),

              uploadedAt:
                file.uploadDate ||
                null,

              expiresAt:
                file?.metadata
                  ?.expiresAt ||
                null
            })
          )
          .sort(
            (
              first,
              second
            ) =>
              Number(
                first.position
              ) -
              Number(
                second.position
              )
          );


      /*
       * -----------------------------------------------------
       * AUDITORIA
       * -----------------------------------------------------
       */

      try {

        await AuditLog.create({
          actorId:
            req.user._id,

          action:
            "client.liveness_video_segment",

          resource:
            "client",

          resourceId:
            client._id.toString(),

          ip:
            req.ip,

          metadata: {
            sessionId,

            position:
              requestedPosition,

            videoId:
              stored.videoId,

            originalSize:
              stored.originalSize,

            segmentsStored:
              segments.length
          }
        });

      } catch (
        auditError
      ) {

        console.error(
          "[CLIENTS] AuditLog liveness video failed:",
          auditError
        );
      }


      /*
       * -----------------------------------------------------
       * RESPOSTA
       * -----------------------------------------------------
       */

      return res.json({
        success:
          true,

        clientId:
          client._id,

        sessionId,

        livenessPassed:
          true,

        position:
          requestedPosition,

        video: {
          available:
            true,

          storage:
            "gridfs",

          videoId:
            stored.videoId,

          mimeType:
            stored.mimeType,

          originalSize:
            stored.originalSize,

          uploadedAt:
            stored.uploadedAt,

          expiresAt:
            stored.expiresAt
        },

        segmentsStored:
          segments.length,

        segments
      });

    } catch (
      error
    ) {

      console.error(
        "[CLIENTS] Liveness video upload error:",
        error
      );

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


      const normalizedPositions =
        normalizeLivenessPositions(
          positions
        );


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


      const result =
        preflight.evaluate({
          positions:
            normalizedPositions,

          passportMatch,

          consentAccepted:
            validConsent
        });


      void facialResult;


      const sessionId =
        crypto.randomUUID();


      const completedAt =
        result.passed
          ? new Date()
          : null;


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
       * Nenhuma fotografia é guardada.
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
       * GUARDAR LIVENESS SEM VALIDAR O DOCUMENTO INTEIRO
       * =====================================================
       *
       * Não usamos client.save() nesta operação.
       *
       * A liveness deve ser persistida isoladamente porque
       * o documento Client pode conter campos antigos ou
       * outros campos obrigatórios que não pertencem a esta
       * operação.
       *
       * Nenhuma fotografia é criada ou guardada.
       */

      const updateResult =
        await Client.updateOne(
          {
            _id:
              client._id,

            accountId:
              req.user.accountId
          },

          {
            $set: {
              facialConsent:
                client.facialConsent,

              facialPreflight:
                client.facialPreflight
            }
          }
        );


      const matchedCount =
        Number.isFinite(
          Number(
            updateResult?.matchedCount
          )
        )
          ? Number(
              updateResult.matchedCount
            )
          : Number(
              updateResult?.n || 0
            );


      if (
        matchedCount !== 1
      ) {
        return res
          .status(500)
          .json({
            success:
              false,

            livenessPassed:
              false,

            error:
              "Não foi possível localizar o cliente para guardar a liveness.",

            issues: [
              "MongoDB não encontrou o cliente durante a persistência da sessão."
            ]
          });
      }


      /*
       * =====================================================
       * CONFIRMAR A PERSISTÊNCIA REAL
       * =====================================================
       */

      const savedClient =
        await Client.findOne(
          {
            _id:
              client._id,

            accountId:
              req.user.accountId
          }
        )
          .select(
            "facialConsent facialPreflight"
          )
          .lean();


      const savedSession =
        savedClient
          ?.facialPreflight
          ?.livenessSession;


      if (
        !savedSession ||
        savedSession.status !==
          "passed" ||
        savedSession.verified !==
          true ||
        Number(
          savedSession.completedCount
        ) !== 10 ||
        Number(
          savedSession.total
        ) !== 10 ||
        !Array.isArray(
          savedSession.positions
        ) ||
        savedSession.positions.length !==
          10
      ) {
        return res
          .status(500)
          .json({
            success:
              false,

            livenessPassed:
              false,

            error:
              "A sessão de liveness não foi persistida corretamente.",

            issues: [
              "MongoDB não confirmou uma sessão de liveness aprovada com as 10 posições."
            ]
          });
      }


      /*
       * =====================================================
       * AUDITORIA
       * =====================================================
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

        livenessPassed:
          true,

        clientId:
          client._id,

        preflight:
          result,

        livenessSession: {

          sessionId:
            savedSession.sessionId,

          status:
            savedSession.status,

          verified:
            savedSession.verified,

          score:
            savedSession.score,

          completedCount:
            savedSession.completedCount,

          total:
            savedSession.total,

          completedAt:
            savedSession.completedAt
        },

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
