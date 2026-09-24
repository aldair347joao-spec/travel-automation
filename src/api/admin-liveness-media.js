"use strict";

const express =
  require("express");

const mongoose =
  require("mongoose");

const Application =
  require("../models/application");

const ApplicationAdminControl =
  require("../models/application-admin-control");

const Client =
  require("../models/client");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const LivenessVideoStorageService =
  require("../services/facial/liveness-video-storage-service");


const livenessVideoStorage =
  new LivenessVideoStorageService();


const router =
  express.Router();


router.use(
  requireAuth
);


/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function isGlobalAdmin(
  req
) {
  return [
    "owner",
    "admin"
  ].includes(
    String(
      req.user?.role ||
      ""
    ).toLowerCase()
  );
}


function isAdministrativeUser(
  req
) {
  return [
    "owner",
    "admin",
    "operator",
    "viewer"
  ].includes(
    String(
      req.user?.role ||
      ""
    ).toLowerCase()
  );
}


function serializeSegment(
  segment
) {
  if (!segment) {
    return null;
  }

  return {
    videoId:
      segment.videoId ||
      null,

    position:
      Number(
        segment.position ||
        0
      ),

    sequence:
      Number(
        segment.sequence ||
        segment.position ||
        0
      ),

    label:
      segment.label ||
      null,

    instruction:
      segment.instruction ||
      null,

    score:
      Number.isFinite(
        Number(
          segment.score
        )
      )
        ? Number(
            segment.score
          )
        : null,

    positionScore:
      Number.isFinite(
        Number(
          segment.positionScore
        )
      )
        ? Number(
            segment.positionScore
          )
        : null,

    mimeType:
      segment.mimeType ||
      "video/webm",

    originalSize:
      Number(
        segment.originalSize ||
        0
      ),

    uploadedAt:
      segment.uploadedAt ||
      null,

    expiresAt:
      segment.expiresAt ||
      null
  };
}


/*
 * =========================================================
 * APPLICATION ACCESS
 * =========================================================
 *
 * Owner/Admin:
 *
 * - podem consultar candidaturas que entraram na
 *   Administração, independentemente da accountId.
 *
 * Operator/Viewer:
 *
 * - ficam limitados à própria accountId.
 *
 * =========================================================
 */

async function findAccessibleApplication(
  req,
  applicationId
) {
  if (
    !mongoose.isValidObjectId(
      applicationId
    )
  ) {
    return null;
  }


  let application =
    null;


  if (
    isGlobalAdmin(
      req
    )
  ) {

    application =
      await Application.findOne({
        _id:
          applicationId
      })
        .lean();


    if (
      !application
    ) {
      return null;
    }


    /*
     * Apenas candidaturas que efetivamente
     * entraram no fluxo administrativo.
     */

    const control =
      await ApplicationAdminControl.findOne({
        applicationId:
          application._id
      })
        .lean();


    if (
      !control
    ) {
      return null;
    }

  } else {

    application =
      await Application.findOne({
        _id:
          applicationId,

        accountId:
          req.user.accountId
      })
        .lean();
  }


  return application;
}


/*
 * =========================================================
 * RESOLVE CLIENT
 * =========================================================
 */

async function resolveClientFromApplication(
  application
) {
  if (
    application?.client &&
    mongoose.isValidObjectId(
      application.client
    )
  ) {

    const client =
      await Client.findOne({
        _id:
          application.client
      })
        .lean();


    if (
      client
    ) {
      return client;
    }
  }


  if (
    Array.isArray(
      application?.applicants
    )
  ) {

    for (
      const applicant
      of application.applicants
    ) {

      if (
        !applicant?.client ||
        !mongoose.isValidObjectId(
          applicant.client
        )
      ) {
        continue;
      }


      const client =
        await Client.findOne({
          _id:
            applicant.client
        })
          .lean();


      if (
        client
      ) {
        return client;
      }
    }
  }


  return null;
}


/*
 * =========================================================
 * VERIFY LIVENESS SESSION
 * =========================================================
 */

function getLivenessSession(
  client
) {
  return (
    client
      ?.facialPreflight
      ?.livenessSession ||
    null
  );
}


function isPassedLiveness(
  session
) {
  return (
    session &&
    session.status ===
      "passed" &&
    session.verified ===
      true
  );
}


/*
 * =========================================================
 * LIST LIVENESS SEGMENTS
 * =========================================================
 *
 * GET:
 *
 * /api/admin/liveness/:applicationId
 *
 * Retorna somente metadata.
 *
 * Os bytes do vídeo nunca são colocados dentro do JSON.
 * =========================================================
 */

router.get(
  "/:applicationId",
  requireRole(
    "owner",
    "admin",
    "operator",
    "viewer"
  ),
  async (
    req,
    res,
    next
  ) => {

    try {

      if (
        !isAdministrativeUser(
          req
        )
      ) {
        return res
          .status(403)
          .json({
            success:
              false,

            error:
              "Administrative access required"
          });
      }


      /*
       * -----------------------------------------------------
       * APPLICATION
       * -----------------------------------------------------
       */

      const application =
        await findAccessibleApplication(
          req,
          req.params.applicationId
        );


      if (
        !application
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Application not found"
          });
      }


      /*
       * -----------------------------------------------------
       * CLIENT
       * -----------------------------------------------------
       */

      const client =
        await resolveClientFromApplication(
          application
        );


      if (
        !client
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Client associated with application was not found"
          });
      }


      /*
       * -----------------------------------------------------
       * ACCOUNT SECURITY
       * -----------------------------------------------------
       */

      if (
        !isGlobalAdmin(
          req
        ) &&
        String(
          client.accountId
        ) !==
          String(
            req.user.accountId
          )
      ) {
        return res
          .status(403)
          .json({
            success:
              false,

            error:
              "Access denied"
          });
      }


      /*
       * -----------------------------------------------------
       * LIVENESS SESSION
       * -----------------------------------------------------
       */

      const session =
        getLivenessSession(
          client
        );


      if (
        !session
      ) {
        return res.json({
          success:
            true,

          available:
            false,

          clientId:
            String(
              client._id
            ),

          sessionId:
            null,

          status:
            "not_started",

          verified:
            false,

          segments:
            []
        });
      }


      if (
        !isPassedLiveness(
          session
        )
      ) {
        return res.json({
          success:
            true,

          available:
            false,

          clientId:
            String(
              client._id
            ),

          sessionId:
            session.sessionId ||
            null,

          status:
            session.status ||
            "requires_user",

          verified:
            session.verified ===
            true,

          segments:
            []
        });
      }


      /*
       * -----------------------------------------------------
       * GRIDFS
       * -----------------------------------------------------
       */

      const segments =
        await livenessVideoStorage.findAll({
          accountId:
            client.accountId,

          clientId:
            client._id.toString(),

          sessionId:
            session.sessionId
        });


      const serializedSegments =
        segments
          .map(
            file => ({
              videoId:
                file?._id
                  ? String(
                      file._id
                    )
                  : null,

              position:
                Number(
                  file?.metadata
                    ?.position ||
                  0
                ),

              sequence:
                Number(
                  file?.metadata
                    ?.sequence ||
                  file?.metadata
                    ?.position ||
                  0
                ),

              label:
                file?.metadata
                  ?.label ||
                null,

              instruction:
                file?.metadata
                  ?.instruction ||
                null,

              score:
                Number.isFinite(
                  Number(
                    file?.metadata
                      ?.score
                  )
                )
                  ? Number(
                      file.metadata
                        .score
                    )
                  : null,

              positionScore:
                Number.isFinite(
                  Number(
                    file?.metadata
                      ?.positionScore
                  )
                )
                  ? Number(
                      file.metadata
                        .positionScore
                    )
                  : null,

              mimeType:
                file?.metadata
                  ?.originalMimeType ||
                "video/webm",

              originalSize:
                Number(
                  file?.metadata
                    ?.originalSize ||
                  0
                ),

              uploadedAt:
                file?.uploadDate ||
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
       * MAPA DAS POSIÇÕES
       * -----------------------------------------------------
       *
       * Isto permite à Administração saber exatamente
       * quais das 10 posições possuem vídeo real.
       */

      const positions =
        Array.isArray(
          session.positions
        )
          ? session.positions
              .map(
                position => ({
                  position:
                    Number(
                      position?.position ||
                      position?.sequence ||
                      0
                    ),

                  sequence:
                    Number(
                      position?.sequence ||
                      position?.position ||
                      0
                    ),

                  label:
                    position?.label ||
                    null,

                  instruction:
                    position?.instruction ||
                    null,

                  verified:
                    position?.verified ===
                    true,

                  completedAt:
                    position?.completedAt ||
                    null,

                  video:
                    serializedSegments.some(
                      segment =>
                        Number(
                          segment.position
                        ) ===
                        Number(
                          position?.position ||
                          position?.sequence
                        )
                    )
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
              )
          : [];


      return res.json({

        success:
          true,

        available:
          serializedSegments.length >
          0,

        clientId:
          String(
            client._id
          ),

        applicationId:
          String(
            application._id
          ),

        sessionId:
          session.sessionId ||
          null,

        status:
          session.status,

        verified:
          session.verified ===
          true,

        score:
          Number.isFinite(
            Number(
              session.score
            )
          )
            ? Number(
                session.score
              )
            : null,

        completedCount:
          Number(
            session.completedCount ||
            0
          ),

        total:
          Number(
            session.total ||
            10
          ),

        startedAt:
          session.startedAt ||
          null,

        completedAt:
          session.completedAt ||
          null,

        positions,

        segments:
          serializedSegments
      });

    } catch (
      error
    ) {

      console.error(
        "[ADMIN-LIVENESS] List error:",
        error
      );

      next(error);
    }
  }
);


/*
 * =========================================================
 * STREAM ONE LIVENESS SEGMENT
 * =========================================================
 *
 * GET:
 *
 * /api/admin/liveness/:applicationId/:position
 *
 * A resposta é o vídeo real.
 *
 * Exemplo:
 *
 * /api/admin/liveness/ABC/1
 *
 * /api/admin/liveness/ABC/2
 *
 * ...
 *
 * /api/admin/liveness/ABC/10
 * =========================================================
 */

router.get(
  "/:applicationId/:position",
  requireRole(
    "owner",
    "admin",
    "operator",
    "viewer"
  ),
  async (
    req,
    res,
    next
  ) => {

    try {

      if (
        !isAdministrativeUser(
          req
        )
      ) {
        return res
          .status(403)
          .json({
            success:
              false,

            error:
              "Administrative access required"
          });
      }


      /*
       * -----------------------------------------------------
       * POSIÇÃO
       * -----------------------------------------------------
       */

      const position =
        Number(
          req.params.position
        );


      if (
        !Number.isInteger(
          position
        ) ||
        position < 1 ||
        position > 10
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Liveness position must be between 1 and 10"
          });
      }


      /*
       * -----------------------------------------------------
       * APPLICATION
       * -----------------------------------------------------
       */

      const application =
        await findAccessibleApplication(
          req,
          req.params.applicationId
        );


      if (
        !application
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Application not found"
          });
      }


      /*
       * -----------------------------------------------------
       * CLIENT
       * -----------------------------------------------------
       */

      const client =
        await resolveClientFromApplication(
          application
        );


      if (
        !client
      ) {
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
       * ACCOUNT SECURITY
       * -----------------------------------------------------
       */

      if (
        !isGlobalAdmin(
          req
        ) &&
        String(
          client.accountId
        ) !==
          String(
            req.user.accountId
          )
      ) {
        return res
          .status(403)
          .json({
            success:
              false,

            error:
              "Access denied"
          });
      }


      /*
       * -----------------------------------------------------
       * LIVENESS
       * -----------------------------------------------------
       */

      const session =
        getLivenessSession(
          client
        );


      if (
        !session
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Liveness session not found"
          });
      }


      if (
        !isPassedLiveness(
          session
        )
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "Liveness session is not approved"
          });
      }


      /*
       * -----------------------------------------------------
       * CONFIRMAR POSIÇÃO
       * -----------------------------------------------------
       */

      const approvedPosition =
        Array.isArray(
          session.positions
        )
          ? session.positions.find(
              item =>
                Number(
                  item?.position ||
                  item?.sequence
                ) ===
                position
            )
          : null;


      if (
        !approvedPosition ||
        approvedPosition.verified !==
          true
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "This liveness position was not approved"
          });
      }


      /*
       * -----------------------------------------------------
       * VIDEO
       * -----------------------------------------------------
       */

      const video =
        await livenessVideoStorage.get({
          accountId:
            client.accountId,

          clientId:
            client._id.toString(),

          sessionId:
            session.sessionId,

          position
        });


      if (
        !video
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Video segment not found"
          });
      }


      /*
       * -----------------------------------------------------
       * HEADERS
       * -----------------------------------------------------
       */

      const mimeType =
        [
          "video/webm",
          "video/mp4",
          "video/quicktime"
        ].includes(
          video.mimeType
        )
          ? video.mimeType
          : "video/webm";


      res.setHeader(
        "Content-Type",
        mimeType
      );


      res.setHeader(
        "Content-Length",
        String(
          video.buffer.length
        )
      );


      res.setHeader(
        "Content-Disposition",
        `inline; filename="${video.filename}"`
      );


      res.setHeader(
        "Cache-Control",
        "private, no-store, max-age=0"
      );


      res.setHeader(
        "Pragma",
        "no-cache"
      );


      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );


      res.setHeader(
        "X-Liveness-Position",
        String(
          position
        )
      );


      res.setHeader(
        "X-Liveness-Session",
        String(
          session.sessionId
        )
      );


      /*
       * -----------------------------------------------------
       * RANGE
       * -----------------------------------------------------
       *
       * O elemento <video> pode pedir apenas uma parte
       * do ficheiro.
       *
       * Como o vídeo está desencriptado apenas em memória
       * nesta camada, suportamos Range depois da leitura.
       */

      const range =
        req.headers.range;


      if (
        range
      ) {

        const match =
          /^bytes=(\d*)-(\d*)$/.exec(
            range
          );


        if (
          match
        ) {

          const total =
            video.buffer.length;


          let start =
            match[1]
              ? Number(
                  match[1]
                )
              : 0;


          let end =
            match[2]
              ? Number(
                  match[2]
                )
              : total - 1;


          if (
            Number.isNaN(
              start
            )
          ) {
            start =
              0;
          }


          if (
            Number.isNaN(
              end
            )
          ) {
            end =
              total - 1;
          }


          if (
            start < 0
          ) {
            start =
              0;
          }


          if (
            end >= total
          ) {
            end =
              total - 1;
          }


          if (
            start > end ||
            start >= total
          ) {

            res.status(
              416
            );


            res.setHeader(
              "Content-Range",
              `bytes */${total}`
            );


            return res.end();
          }


          const chunk =
            video.buffer.subarray(
              start,
              end + 1
            );


          res.status(
            206
          );


          res.setHeader(
            "Content-Range",
            `bytes ${start}-${end}/${total}`
          );


          res.setHeader(
            "Accept-Ranges",
            "bytes"
          );


          res.setHeader(
            "Content-Length",
            String(
              chunk.length
            )
          );


          return res.end(
            chunk
          );
        }
      }


      res.setHeader(
        "Accept-Ranges",
        "bytes"
      );


      return res.end(
        video.buffer
      );

    } catch (
      error
    ) {

      console.error(
        "[ADMIN-LIVENESS] Stream error:",
        error
      );

      next(error);
    }
  }
);


module.exports =
  router;
