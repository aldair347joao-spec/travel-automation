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
 * O frontend envia todos os segmentos aprovados numa única
 * requisição multipart:
 *
 * livenessVideo_0
 * livenessMeta_0
 *
 * livenessVideo_1
 * livenessMeta_1
 *
 * ...
 *
 * livenessVideo_9
 * livenessMeta_9
 *
 * Apenas posições que já foram aprovadas pela sessão de
 * liveness são guardadas.
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

function isClientUser(
  req
) {
  return (
    req.user &&
    req.user.role ===
      "client"
  );
}


function isAdministrativeUser(
  req
) {
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
 * GET PASSPORT IMAGE
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
 * RECEBER SEGMENTOS REAIS DE LIVENESS
 * =========================================================
 *
 * O frontend envia até 10 segmentos numa única requisição.
 *
 * Exemplo:
 *
 * livenessVideo_0
 * livenessMeta_0
 * livenessVideo_1
 * livenessMeta_1
 * ...
 *
 * O backend:
 *
 * 1. encontra o cliente;
 * 2. encontra a sessão;
 * 3. confirma o mesmo sessionId;
 * 4. confirma que a sessão passou;
 * 5. valida todos os segmentos;
 * 6. confirma cada posição;
 * 7. guarda somente as posições aprovadas;
 * 8. disponibiliza os vídeos no GridFS para Administração.
 *
 * Tentativas erradas nunca são guardadas.
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
       * FICHEIROS
       * -----------------------------------------------------
       */

      const files =
        Array.isArray(
          req.files
        )
          ? req.files
          : [];

      if (
        !files.length
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

      if (
        files.length >
        10
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "A sessão pode conter no máximo 10 segmentos de vídeo."
          });
      }


      /*
       * -----------------------------------------------------
       * SESSION ID
       * -----------------------------------------------------
       *
       * O sessionId vem do frontend e também é persistido
       * pelo endpoint facial-preflight.
       */

      const sessionId =
        String(
          req.body?.sessionId ||
          ""
        ).trim();

      if (
        !sessionId ||
        sessionId.length >
          128
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "sessionId é obrigatório para guardar os segmentos de liveness."
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
              "O vídeo pertence a uma sessão de liveness diferente."
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
       * MAPEAR OS FICHEIROS
       * -----------------------------------------------------
       */

      const entries =
        [];

      const usedPositions =
        new Set();

      for (
        const file
        of files
      ) {

        const match =
          String(
            file.fieldname ||
            ""
          ).match(
            /^livenessVideo_(\d+)$/
          );

        if (
          !match
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `Campo de vídeo inválido: ${file.fieldname}`
            });
        }

        const index =
          Number(
            match[1]
          );

        const metadataField =
          `livenessMeta_${index}`;

        const rawMetadata =
          req.body?.[
            metadataField
          ];

        if (
          rawMetadata ===
            undefined ||
          rawMetadata ===
            null
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `Metadata ausente para o segmento ${index}.`
            });
        }

        let metadata;

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
                `A metadata do segmento ${index} é inválida.`
            });
        }

        if (
          !metadata ||
          typeof metadata !==
            "object"
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `A metadata do segmento ${index} é inválida.`
            });
        }

        if (
          !Buffer.isBuffer(
            file.buffer
          ) ||
          !file.buffer.length
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `O segmento ${index} está vazio.`
            });
        }

        const requestedPosition =
          Number(
            metadata.position ||
            metadata.sequence
          );

        if (
          !Number.isInteger(
            requestedPosition
          ) ||
          requestedPosition <
            1 ||
          requestedPosition >
            10
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `A posição do segmento ${index} deve estar entre 1 e 10.`
            });
        }

        if (
          usedPositions.has(
            requestedPosition
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                `A posição ${requestedPosition} foi enviada mais de uma vez.`
            });
        }

        usedPositions.add(
          requestedPosition
        );

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

        const mimeType =
          String(
            file.mimetype ||
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
                `Formato de vídeo não suportado no segmento ${index}.`
            });
        }

        entries.push({
          index,

          file,

          metadata,

          position:
            requestedPosition,

          approvedPosition,

          mimeType
        });
      }


      /*
       * -----------------------------------------------------
       * GUARDAR TODOS OS SEGMENTOS
       * -----------------------------------------------------
       *
       * Fazemos a validação de TODOS primeiro.
       * Só depois começamos a gravar.
       *
       * Isto impede que uma posição inválida deixe metade
       * da sessão armazenada.
       */

      const storedSegments =
        [];

      try {

        for (
          const entry
          of entries
        ) {

          const {
            file,
            metadata,
            position,
            approvedPosition,
            mimeType
          } =
            entry;

          const stored =
            await livenessVideoStorage.save({
              accountId:
                req.user.accountId,

              clientId:
                client._id.toString(),

              sessionId,

              position,

              sequence:
                Number(
                  metadata.sequence ||
                  approvedPosition.sequence ||
                  position
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
                file.buffer,

              mimeType,

              startedAt:
                metadata.startedAt ||
                null,

              completedAt:
                metadata.completedAt ||
                approvedPosition.completedAt ||
                null
            });

          storedSegments.push(
            {
              stored,

              position
            }
          );
        }

      } catch (
        storageError
      ) {

        console.error(
          "[CLIENTS] Liveness video batch storage error:",
          storageError
        );

        /*
         * Remover apenas as posições desta requisição.
         *
         * Se o mesmo segmento já existia, o serviço de storage
         * trata a substituição conforme a sua política atual.
         */

        for (
          const item
          of storedSegments
        ) {
          try {

            await livenessVideoStorage.delete({
              accountId:
                req.user.accountId,

              clientId:
                client._id.toString(),

              sessionId,

              position:
                item.position
            });

          } catch (
            cleanupError
          ) {

            console.error(
              "[CLIENTS] Falha ao limpar segmento após erro de batch:",
              cleanupError
            );
          }
        }

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Não foi possível guardar todos os segmentos de liveness."
          });
      }


      /*
       * -----------------------------------------------------
       * SEGMENTOS EXISTENTES
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


      /*
       * -----------------------------------------------------
       * ATUALIZAR METADATA DA SESSÃO
       * -----------------------------------------------------
       */

      const lastStored =
        storedSegments[
          storedSegments.length -
            1
        ]?.stored ||
        null;

      const videoUpdate =
        {
          "facialPreflight.livenessSession.video.available":
            storedFiles.length >
            0,

          "facialPreflight.livenessSession.video.storage":
            "gridfs"
        };

      if (
        lastStored
      ) {

        videoUpdate[
          "facialPreflight.livenessSession.video.videoId"
        ] =
          lastStored.videoId;

        videoUpdate[
          "facialPreflight.livenessSession.video.mimeType"
        ] =
          lastStored.mimeType;

        videoUpdate[
          "facialPreflight.livenessSession.video.originalSize"
        ] =
          lastStored.originalSize;

        videoUpdate[
          "facialPreflight.livenessSession.video.uploadedAt"
        ] =
          lastStored.uploadedAt;

        videoUpdate[
          "facialPreflight.livenessSession.video.expiresAt"
        ] =
          lastStored.expiresAt;
      }

      const videoUpdateResult =
        await Client.updateOne(
          {
            _id:
              client._id,

            accountId:
              req.user.accountId
          },

          {
            $set:
              videoUpdate
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

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Os vídeos foram recebidos, mas não foi possível atualizar a sessão de liveness."
          });
      }


      /*
       * -----------------------------------------------------
       * SERIALIZAÇÃO
       * -----------------------------------------------------
       */

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
            "client.liveness_video_segments",

          resource:
            "client",

          resourceId:
            client._id.toString(),

          ip:
            req.ip,

          metadata: {
            sessionId,

            segmentsReceived:
              entries.length,

            segmentsStored:
              segments.length,

            positions:
              entries.map(
                entry =>
                  entry.position
              )
          }
        });

      } catch (
        auditError
      ) {

        console.error(
          "[CLIENTS] AuditLog liveness video batch failed:",
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

        segmentsReceived:
          entries.length,

        segmentsStored:
          segments.length,

        video: {
          available:
            segments.length >
            0,

          storage:
            "gridfs"
        },

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


      /*
       * =====================================================
       * SESSION ID
       * =====================================================
       *
       * IMPORTANTE:
       *
       * O frontend já criou esta sessão.
       * Não podemos criar outro ID aqui.
       *
       * O mesmo sessionId será usado pelo upload dos vídeos
       * e pela Administração para localizar os segmentos.
       */

      const requestedSessionId =
        String(
          req.body?.sessionId ||
          ""
        ).trim();

      if (
        requestedSessionId &&
        requestedSessionId.length >
          128
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            livenessPassed:
              false,

            error:
              "sessionId inválido."
          });
      }

      const sessionId =
        requestedSessionId ||
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
       * GUARDAR LIVENESS
       * =====================================================
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
              updateResult?.n ||
              0
            );


      if (
        matchedCount !==
        1
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
       * CONFIRMAR PERSISTÊNCIA
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
        ) !==
          10 ||
        Number(
          savedSession.total
        ) !==
          10 ||
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
