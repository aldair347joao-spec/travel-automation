const express =
  require("express");

const mongoose =
  require("mongoose");

const Application =
  require("../models/application");

const Client =
  require("../models/client");
const adminLivenessMedia =
  require("./admin-liveness-media");

const ApplicationAdminControl =
  require("../models/application-admin-control");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const AdminControlService =
  require("../services/admin/admin-control-service");


function createAdminRouter() {
  const router =
    express.Router();


  /*
   * =========================================================
   * AUTHENTICATION
   * =========================================================
   */

  router.use(
    requireAuth
  );


  /*
   * =========================================================
   * HELPER — ADMIN GLOBAL
   * =========================================================
   *
   * Owner/Admin possuem visão global da Administração.
   *
   * A candidatura continua pertencendo à accountId original
   * do colaborador.
   *
   * Não alteramos Application.accountId.
   *
   * Operator/Viewer continuam isolados pela própria conta.
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


  /*
   * =========================================================
   * HELPER — CLIENTE
   * =========================================================
   *
   * A aplicação guarda um snapshot do cliente em
   * applicants[].personalData e applicants[].passport.
   *
   * O Client continua a ser a fonte principal.
   * O snapshot da Application funciona como fallback.
   *
   * Isto garante que o administrador recebe os dados
   * existentes no momento em que o cliente enviou o processo.
   * =========================================================
   */

  function serializeClient(
    client,
    applicant = null
  ) {
    const personalData =
      applicant?.personalData ||
      {};

    const passport =
      applicant?.passport ||
      {};

    const identityStatus =
      applicant?.identityStatus ||
      applicant?.facialStatus ||
      null;

    const clientId =
      client?._id ||
      applicant?.client ||
      null;

    const name =
      client?.name ||
      client?.fullName ||
      personalData.fullName ||
      personalData.name ||
      passport.fullName ||
      passport.name ||
      "Cliente";

    const fullName =
      client?.fullName ||
      client?.name ||
      personalData.fullName ||
      personalData.name ||
      passport.fullName ||
      passport.name ||
      null;

    const email =
      client?.email ||
      personalData.email ||
      null;

    const phone =
      client?.phone ||
      client?.mobile ||
      personalData.phone ||
      personalData.mobile ||
      null;

    const dateOfBirth =
      client?.dateOfBirth ||
      personalData.dateOfBirth ||
      personalData.birthDate ||
      null;

    const gender =
      client?.gender ||
      personalData.gender ||
      null;

    const nationality =
      client?.nationality ||
      personalData.nationality ||
      passport.nationality ||
      null;

    const passportNumber =
      client?.passportNumber ||
      passport.number ||
      passport.passportNumber ||
      null;

    const passportExpiryDate =
      client?.passportExpiryDate ||
      passport.expiryDate ||
      passport.passportExpiryDate ||
      null;

    const passportIssueDate =
      client?.passportIssueDate ||
      passport.issueDate ||
      passport.passportIssueDate ||
      null;

    const passportValidationStatus =
      client?.passportValidation?.status ||
      passport.validationStatus ||
      passport.status ||
      "not_started";

    const facialStatus =
      client?.facialPreflight?.status ||
      identityStatus ||
      "pending";

    return {
      id:
        clientId,

      name,

      fullName,

      email,

      phone,

      dateOfBirth,

      gender,

      nationality,

      passportNumber,

      passportExpiryDate,

      passportIssueDate,

      passportValidationStatus,

      passportVerified:
        passportValidationStatus ===
        "passed" ||
        Boolean(
          passport.verified ||
          passport.validated
        ),

      facialStatus,

      facialVerified:
        facialStatus ===
        "passed",

      accountId:
        client?.accountId ||
        null,

      active:
        client?.active !== false
    };
  }


  /*
   * =========================================================
   * HELPER — ENCONTRAR SNAPSHOT DO CLIENTE
   * =========================================================
   */

  function resolveApplicant(
    application,
    clientId
  ) {
    if (
      !Array.isArray(
        application?.applicants
      )
    ) {
      return null;
    }

    const targetId =
      clientId
        ? String(clientId)
        : null;

    return (
      application.applicants.find(
        applicant =>
          applicant?.client &&
          String(
            applicant.client
          ) === targetId
      ) ||
      application.applicants[0] ||
      null
    );
  }


  /*
   * =========================================================
   * HELPER — PAYMENT
   * =========================================================
   */

  function serializePayment(
    application
  ) {
    return {
      status:
        application.paymentStatus ||
        null,

      reference:
        application.result?.reference ||
        null,

      entity:
        application.result?.entity ||
        null,

      amount:
        application.result?.paymentAmount ||
        null,

      currency:
        application.result?.paymentCurrency ||
        null,

      deadline:
        application.result?.paymentDeadline ||
        null,

      transactionId:
        application.result?.transactionId ||
        null,

      confirmationUrl:
        application.result?.confirmationUrl ||
        null
    };
  }


  /*
   * =========================================================
   * HELPER — ADMIN CONTROL
   * =========================================================
   */

  function serializeAdmin(
    control
  ) {
    if (!control) {
      return {
        status:
          "PENDING_REVIEW",

        vfsCredentials: {
          configured:
            false
        },

        release: {
          enabled:
            false
        },

        notes:
          ""
      };
    }

    return AdminControlService.serialize(
      control
    );
  }


  /*
   * =========================================================
   * HELPER — CLIENT IDS
   * =========================================================
   */

  function collectClientIds(
    applications
  ) {
    const ids = [];

    for (
      const application
      of applications
    ) {
      if (
        application.client
      ) {
        ids.push(
          application.client
        );
      }

      if (
        Array.isArray(
          application.applicants
        )
      ) {
        for (
          const applicant
          of application.applicants
        ) {
          if (
            applicant?.client
          ) {
            ids.push(
              applicant.client
            );
          }
        }
      }
    }

    return [
      ...new Set(
        ids.map(
          id =>
            String(id)
        )
      )
    ]
      .filter(
        id =>
          mongoose.isValidObjectId(
            id
          )
      );
  }


  /*
   * =========================================================
   * HELPER — CLIENT MAP
   * =========================================================
   */

  async function loadClientMap(
    applications
  ) {
    const clientIds =
      collectClientIds(
        applications
      );

    if (!clientIds.length) {
      return new Map();
    }

    const clients =
      await Client.find({
        _id: {
          $in:
            clientIds
        }
      }).lean();

    return new Map(
      clients.map(
        client => [
          String(
            client._id
          ),
          client
        ]
      )
    );
  }


  /*
   * =========================================================
   * HELPER — OBTER CLIENTE DE UMA APPLICATION
   * =========================================================
   */

  function resolveApplicationClient(
    application,
    clientMap
  ) {
    if (
      application.client
    ) {
      const client =
        clientMap.get(
          String(
            application.client
          )
        );

      if (client) {
        return client;
      }
    }

    if (
      Array.isArray(
        application.applicants
      )
    ) {
      for (
        const applicant
        of application.applicants
      ) {
        if (
          !applicant?.client
        ) {
          continue;
        }

        const client =
          clientMap.get(
            String(
              applicant.client
            )
          );

        if (client) {
          return client;
        }
      }
    }

    return null;
  }


  /*
   * =========================================================
   * HELPER — SERIALIZAR LIVENESS
   * =========================================================
   *
   * A liveness NÃO depende de imagens.
   *
   * O que chega à Administração é:
   *
   * - sessão
   * - estado
   * - score
   * - quantidade de posições
   * - verificação
   * - timestamps
   * - resultado individual das 10 posições
   *
   * Pode existir liveness no snapshot da Application
   * ou ainda no Client. O snapshot da Application tem
   * prioridade porque representa o estado enviado no processo.
   * =========================================================
   */

  function serializeLiveness(
    application,
    client,
    applicant
  ) {
    const applicantLiveness =
      applicant?.liveness ||
      null;

    const clientLiveness =
      client?.facialPreflight
        ?.livenessSession ||
      null;

    const liveness =
      applicantLiveness ||
      clientLiveness ||
      null;

    if (!liveness) {
      return null;
    }

    const positions =
      Array.isArray(
        liveness.positions
      )
        ? liveness.positions
        : [];

    return {
      sessionId:
        liveness.sessionId ||
        null,

      status:
        liveness.status ||
        "not_started",

      source:
        liveness.source ||
        "local_liveness",

      score:
        Number.isFinite(
          Number(
            liveness.score
          )
        )
          ? Number(
              liveness.score
            )
          : null,

      completedCount:
        Number(
          liveness.completedCount ||
          positions.length ||
          0
        ),

      total:
        Number(
          liveness.total ||
          10
        ),

      verified:
        liveness.verified ===
        true,

      startedAt:
        liveness.startedAt ||
        null,

      completedAt:
        liveness.completedAt ||
        null,

      positions:
        positions.map(
          position => ({
            position:
              Number(
                position?.position
              ),

            label:
              position?.label ||
              null,

            instruction:
              position?.instruction ||
              null,

            sequence:
              Number(
                position?.sequence
              ) ||
              Number(
                position?.position
              ) ||
              null,

            score:
              Number.isFinite(
                Number(
                  position?.score
                )
              )
                ? Number(
                    position.score
                  )
                : 0,

            positionScore:
              Number.isFinite(
                Number(
                  position?.positionScore
                )
              )
                ? Number(
                    position.positionScore
                  )
                : 0,

            faceDetected:
              position?.faceDetected ===
              true,

            singleFace:
              position?.singleFace ===
              true,

            faceCount:
              Number(
                position?.faceCount ||
                0
              ),

            faceArea:
              Number(
                position?.faceArea ||
                0
              ),

            detectionScore:
              Number.isFinite(
                Number(
                  position?.detectionScore
                )
              )
                ? Number(
                    position.detectionScore
                  )
                : 0,

            pose:
              position?.pose
                ? {
                    yaw:
                      Number(
                        position.pose.yaw ||
                        0
                      ),

                    pitch:
                      Number(
                        position.pose.pitch ||
                        0
                      ),

                    roll:
                      Number(
                        position.pose.roll ||
                        0
                      )
                  }
                : null,

            quality:
              position?.quality
                ? {
                    brightness:
                      Number(
                        position.quality
                          .brightness ||
                        0
                      ),

                    brightnessScore:
                      Number.isFinite(
                        Number(
                          position.quality
                            .brightnessScore
                        )
                      )
                        ? Number(
                            position.quality
                              .brightnessScore
                          )
                        : 0,

                    sharpnessScore:
                      Number.isFinite(
                        Number(
                          position.quality
                            .sharpnessScore
                        )
                      )
                        ? Number(
                            position.quality
                              .sharpnessScore
                          )
                        : 0,

                    faceSizeScore:
                      Number.isFinite(
                        Number(
                          position.quality
                            .faceSizeScore
                        )
                      )
                        ? Number(
                            position.quality
                              .faceSizeScore
                        )
                        : 0,

                    detectionScore:
                      Number.isFinite(
                        Number(
                          position.quality
                            .detectionScore
                        )
                      )
                        ? Number(
                            position.quality
                              .detectionScore
                        )
                        : 0
                  }
                : null,

            smileDetected:
              position?.smileDetected ===
              true,

            smileScore:
              Number.isFinite(
                Number(
                  position?.smileScore
                )
              )
                ? Number(
                    position.smileScore
                  )
                : 0,

            verified:
              position?.verified ===
              true,

            completedAt:
              position?.completedAt ||
              null
          })
        )
    };
  }


  /*
   * =========================================================
   * HELPER — SANITIZAR APPLICATION
   * =========================================================
   *
   * Nunca devolvemos:
   *
   * - preparedDataEncrypted
   * - VFS credentials
   * - passwords
   * - tokens
   * - dados secretos internos
   *
   * O administrador recebe os dados necessários
   * para gerir o processo.
   * =========================================================
   */

  function serializeApplication(
    application,
    clientMap
  ) {
    const client =
      resolveApplicationClient(
        application,
        clientMap
      );

    const applicant =
      resolveApplicant(
        application,
        client?._id ||
        application.client
      );

    const serializedClient =
      serializeClient(
        client,
        applicant
      );

    const payment =
      serializePayment(
        application
      );

    const result =
      application.result ||
      {};

    const passport =
      application.passport ||
      application.passportData ||
      null;

    const applicants =
      Array.isArray(
        application.applicants
      )
        ? application.applicants
        : [];

    const liveness =
      serializeLiveness(
        application,
        client,
        applicant
      );

    const legacyFacial =
      application.facial ||
      application.identity ||
      application.identityVerification ||
      null;

    return {
      id:
        application._id,

      client:
        serializedClient,

      clients:
        applicants.map(
          applicantItem => {
            const applicantClient =
              clientMap.get(
                String(
                  applicantItem?.client
                )
              );

            return serializeClient(
              applicantClient,
              applicantItem
            );
          }
        ),

      status:
        application.status ||
        null,

      workflowState:
        application.workflowState ||
        null,

      workflow:
        application.workflow
          ? {
              previousState:
                application.workflow
                  .previousState ||
                null,

              stateChangedAt:
                application.workflow
                  .stateChangedAt ||
                null,

              lastEvent:
                application.workflow
                  .lastEvent ||
                null,

              lastReason:
                application.workflow
                  .lastReason ||
                null,

              transitionCount:
                application.workflow
                  .transitionCount ||
                0
            }
          : null,

      visaType:
        application.visaType ||
        null,

      visaCenter:
        application.visaCenter ||
        null,

      travelPurpose:
        application.travelPurpose ||
        null,

      serviceType:
        application.serviceType ||
        null,

      appointmentMode:
        application.appointmentMode ||
        null,

      bookingMode:
        application.bookingMode ||
        null,

      preferredDates:
        application.preferredDates ||
        null,

      preferredTime:
        application.preferredTime ||
        null,

      preferredWeekdays:
        application.preferredWeekdays ||
        [],

      applicants:
        applicants.map(
          applicantItem => {
            const applicantLiveness =
              applicantItem?.liveness ||
              null;

            return {
              client:
                applicantItem?.client ||
                null,

              status:
                applicantItem?.status ||
                null,

              passport:
                applicantItem?.passport
                  ? {
                      number:
                        applicantItem
                          .passport
                          .number ||
                        applicantItem
                          .passport
                          .passportNumber ||
                        null,

                      nationality:
                        applicantItem
                          .passport
                          .nationality ||
                        null,

                      expiryDate:
                        applicantItem
                          .passport
                          .expiryDate ||
                        applicantItem
                          .passport
                          .passportExpiryDate ||
                        null,

                      issueDate:
                        applicantItem
                          .passport
                          .issueDate ||
                        applicantItem
                          .passport
                          .passportIssueDate ||
                        null,

                      validationStatus:
                        applicantItem
                          .passport
                          .validationStatus ||
                        applicantItem
                          .passport
                          .status ||
                        null
                    }
                  : null,

              personalData:
                applicantItem?.personalData
                  ? {
                      fullName:
                        applicantItem
                          .personalData
                          .fullName ||
                        null,

                      dateOfBirth:
                        applicantItem
                          .personalData
                          .dateOfBirth ||
                        null,

                      gender:
                        applicantItem
                          .personalData
                          .gender ||
                        null,

                      nationality:
                        applicantItem
                          .personalData
                          .nationality ||
                        null,

                      email:
                        applicantItem
                          .personalData
                          .email ||
                        null,

                      phone:
                        applicantItem
                          .personalData
                          .phone ||
                        null
                    }
                  : null,

              identityStatus:
                applicantItem
                  ?.identityStatus ||
                null,

              liveness:
                applicantLiveness
                  ? serializeLiveness(
                      {
                        applicants: [
                          applicantItem
                        ]
                      },
                      null,
                      applicantItem
                    )
                  : null
            };
          }
        ),

      passport:
        passport
          ? {
              status:
                passport.status ||
                passport.validationStatus ||
                null,

              verified:
                Boolean(
                  passport.verified ||
                  passport.validated
                ),

              number:
                passport.number ||
                passport.passportNumber ||
                serializedClient
                  .passportNumber ||
                null,

              name:
                passport.name ||
                passport.fullName ||
                serializedClient
                  .fullName ||
                null,

              nationality:
                passport.nationality ||
                serializedClient
                  .nationality ||
                null,

              issueDate:
                passport.issueDate ||
                passport.passportIssueDate ||
                serializedClient
                  .passportIssueDate ||
                null,

              expiryDate:
                passport.expiryDate ||
                passport.passportExpiryDate ||
                serializedClient
                  .passportExpiryDate ||
                null
            }
          : {
              status:
                serializedClient
                  .passportValidationStatus ||
                null,

              verified:
                serializedClient
                  .passportVerified ||
                false,

              number:
                serializedClient
                  .passportNumber ||
                null,

              name:
                serializedClient
                  .fullName ||
                null,

              nationality:
                serializedClient
                  .nationality ||
                null,

              issueDate:
                serializedClient
                  .passportIssueDate ||
                null,

              expiryDate:
                serializedClient
                  .passportExpiryDate ||
                null
            },

      identity: {
        status:
          liveness?.status ||
          legacyFacial?.status ||
          serializedClient.facialStatus ||
          "not_started",

        verified:
          liveness?.verified === true ||
          Boolean(
            legacyFacial?.verified ||
            legacyFacial?.completed ||
            serializedClient.facialVerified
          ),

        positionCount:
          Array.isArray(
            liveness?.positions
          )
            ? liveness.positions.length
            : Number(
                liveness?.completedCount ||
                legacyFacial?.positionCount ||
                legacyFacial?.positionsCount ||
                0
              ),

        liveness:
          liveness
            ? {
                sessionId:
                  liveness.sessionId ||
                  null,

                status:
                  liveness.status ||
                  "not_started",

                source:
                  liveness.source ||
                  "local_liveness",

                score:
                  liveness.score,

                completedCount:
                  liveness.completedCount,

                total:
                  liveness.total,

                verified:
                  liveness.verified,

                startedAt:
                  liveness.startedAt,

                completedAt:
                  liveness.completedAt,

                positions:
                  liveness.positions
              }
            : null
      },

      bot1:
        application.bot1 ||
        null,

      bot2:
        application.bot2 ||
        null,

      radar:
        application.radar
          ? {
              enabled:
                Boolean(
                  application.radar
                    .enabled
                ),

              riskLevel:
                application.radar
                  .riskLevel ||
                null,

              lastCheckedAt:
                application.radar
                  .lastCheckedAt ||
                null,

              lastError:
                application.radar
                  .lastError ||
                null
            }
          : null,

      payment,

      error:
        application.error
          ? {
              code:
                application.error.code ||
                null,

              message:
                application.error.message ||
                null,

              at:
                application.error.at ||
                null,

              attempts:
                application.error.attempts ||
                0
            }
          : null,

      createdAt:
        application.createdAt,

      updatedAt:
        application.updatedAt
    };
  }


  /*
   * =========================================================
   * STATS
   * =========================================================
   */

  router.get(
    "/stats",
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
        const accountId =
          req.user.accountId;

        const applications =
          await Application.find({
            accountId
          })
          .select(
            "_id status workflowState paymentStatus result bot1 bot2"
          )
          .lean();

        const controls =
          await ApplicationAdminControl.find({
            accountId
          })
          .select(
            "applicationId status release"
          )
          .lean();

        const controlMap =
          new Map(
            controls.map(
              item => [
                String(
                  item.applicationId
                ),
                item
              ]
            )
          );

        const stats = {
          total:
            applications.length,

          pendingAdmin:
            0,

          readyForAutomation:
            0,

          automationActive:
            0,

          slotFound:
            0,

          appointmentBooked:
            0,

          paymentPending:
            0,

          paymentConfirmed:
            0,

          completed:
            0,

          errors:
            0
        };

        for (
          const application
          of applications
        ) {
          const control =
            controlMap.get(
              String(
                application._id
              )
            );

          if (
            !control ||
            control.status ===
              "PENDING_REVIEW"
          ) {
            stats.pendingAdmin++;
          }

          if (
            control?.status ===
            "READY_FOR_AUTOMATION"
          ) {
            stats.readyForAutomation++;
          }

          if (
            control?.status ===
            "AUTOMATION_ACTIVE"
          ) {
            stats.automationActive++;
          }

          if (
            application.workflowState ===
              "SLOT_FOUND" ||
            application.status ===
              "slot_received"
          ) {
            stats.slotFound++;
          }

          if (
            application.workflowState ===
            "APPOINTMENT_BOOKED"
          ) {
            stats.appointmentBooked++;
          }

          if (
            application.workflowState ===
              "PAYMENT_PENDING" ||
            application.paymentStatus ===
              "pending"
          ) {
            stats.paymentPending++;
          }

          if (
            application.workflowState ===
              "PAYMENT_CONFIRMED" ||
            application.paymentStatus ===
              "confirmed"
          ) {
            stats.paymentConfirmed++;
          }

          if (
            application.workflowState ===
              "COMPLETED" ||
            application.status ===
              "completed"
          ) {
            stats.completed++;
          }

          if (
            application.workflowState ===
              "ERROR" ||
            application.status ===
              "error"
          ) {
            stats.errors++;
          }
        }

        return res.json({
          success:
            true,

          stats
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * LIST APPLICATIONS
   * =========================================================
   */

  router.get(
    "/applications",
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
        const globalAdmin =
          isGlobalAdmin(
            req
          );

        let applications;
        let controls;

        if (
          globalAdmin
        ) {
          /*
           * Owner/Admin têm visão global da Administração.
           *
           * A Application mantém o accountId original
           * do colaborador.
           *
           * ApplicationAdminControl identifica as
           * candidaturas que entraram no fluxo administrativo.
           */
          controls =
            await ApplicationAdminControl.find({})
              .lean();

          const applicationIds =
            controls
              .map(
                control =>
                  control?.applicationId
              )
              .filter(
                Boolean
              );

          applications =
            applicationIds.length
              ? await Application.find({
                  _id: {
                    $in:
                      applicationIds
                  }
                })
                  .sort({
                    createdAt:
                      -1
                  })
                  .lean()
              : [];
        } else {
          /*
           * Operator/Viewer continuam limitados
           * à própria conta.
           */
          const accountId =
            req.user.accountId;

          applications =
            await Application.find({
              accountId
            })
              .sort({
                createdAt:
                  -1
              })
              .lean();

          controls =
            await ApplicationAdminControl.find({
              accountId
            })
              .lean();
        }

        const clientMap =
          await loadClientMap(
            applications
          );

        const controlMap =
          new Map(
            controls.map(
              control => [
                String(
                  control.applicationId
                ),
                control
              ]
            )
          );

        const result =
          applications.map(
            application => {
              const serializedApplication =
                serializeApplication(
                  application,
                  clientMap
                );

              const control =
                controlMap.get(
                  String(
                    application._id
                  )
                );

              return {
                ...serializedApplication,

                admin: {
                  status:
                    control?.status ||
                    "PENDING_REVIEW",

                  credentialsConfigured:
                    Boolean(
                      control
                        ?.vfsCredentials
                        ?.emailEncrypted &&
                      control
                        ?.vfsCredentials
                        ?.passwordEncrypted
                    ),

                  released:
                    Boolean(
                      control
                        ?.release
                        ?.enabled
                    ),

                  releasedAt:
                    control
                      ?.release
                      ?.releasedAt ||
                    null
                }
              };
            }
          );

        return res.json({
          success:
            true,

          applications:
            result
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * APPLICATION DETAIL
   * =========================================================
   */

  router.get(
    "/applications/:id",
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
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid application ID"
            });
        }

        let application;

        if (
          isGlobalAdmin(
            req
          )
        ) {
          /*
           * Owner/Admin podem abrir qualquer
           * candidatura que tenha entrado no
           * fluxo administrativo.
           */
          application =
            await Application.findOne({
              _id:
                req.params.id
            })
              .lean();

          if (
            application
          ) {
            const control =
              await ApplicationAdminControl.findOne({
                applicationId:
                  application._id
              })
                .lean();

            if (
              !control
            ) {
              application =
                null;
            }
          }
        } else {
          /*
           * Operator/Viewer continuam isolados
           * pela própria conta.
           */
          application =
            await Application.findOne({
              _id:
                req.params.id,

              accountId:
                req.user.accountId
            })
              .lean();
        }

        if (!application) {
          return res
            .status(404)
            .json({
              success:
                false,

              error:
                "Application not found"
            });
        }

        const clientMap =
          await loadClientMap([
            application
          ]);

        const control =
          await ApplicationAdminControl.findOne({
            applicationId:
              application._id
          })
            .lean();

        return res.json({
          success:
            true,

          application:
            serializeApplication(
              application,
              clientMap
            ),

          admin:
            serializeAdmin(
              control
            ),

          payment:
            serializePayment(
              application
            )
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * CONFIGURE VFS CREDENTIALS
   * =========================================================
   */

  router.post(
    "/applications/:id/vfs-credentials",
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
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid application ID"
            });
        }

        await AdminControlService
          .assertApplicationAccount(
            req.params.id,
            req.user.accountId
          )
          .catch(
            () => {
              const error =
                new Error(
                  "Application not found"
                );

              error.statusCode =
                404;

              throw error;
            }
          );

        const result =
          await AdminControlService
            .configureVfsCredentials({
              applicationId:
                req.params.id,

              email:
                req.body?.email,

              password:
                req.body?.password,

              actorId:
                req.user._id
            });

        return res.json({
          success:
            true,

          message:
            "VFS credentials saved securely",

          admin:
            result
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * RELEASE
   * =========================================================
   */

  router.post(
    "/applications/:id/release",
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
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid application ID"
            });
        }

        const result =
          await AdminControlService
            .releaseForAutomation({
              applicationId:
                req.params.id,

              accountId:
                req.user.accountId,

              actorId:
                req.user._id
            });

        return res.json({
          success:
            true,

          message:
            "Application released for automation",

          admin:
            result
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * PAUSE
   * =========================================================
   */

  router.post(
    "/applications/:id/pause",
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
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid application ID"
            });
        }

        const result =
          await AdminControlService
            .pauseAutomation({
              applicationId:
                req.params.id,

              accountId:
                req.user.accountId,

              actorId:
                req.user._id
            });

        return res.json({
          success:
            true,

          message:
            "Automation paused",

          admin:
            result
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );


  /*
   * =========================================================
   * ADMIN NOTES
   * =========================================================
   */

  router.patch(
    "/applications/:id/notes",
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
        if (
          !mongoose.isValidObjectId(
            req.params.id
          )
        ) {
          return res
            .status(400)
            .json({
              success:
                false,

              error:
                "Invalid application ID"
            });
        }

        const result =
          await AdminControlService
            .updateNotes({
              applicationId:
                req.params.id,

              accountId:
                req.user.accountId,

              notes:
                req.body?.notes,

              actorId:
                req.user._id
            });

        return res.json({
          success:
            true,

          message:
            "Administrative notes saved",

          admin:
            result
        });
      } catch (
        error
      ) {
        return next(
          error
        );
      }
    }
  );
  /*
   * =========================================================
   * LIVENESS MEDIA — ADMINISTRAÇÃO
   * =========================================================
   *
   * Permite à Administração consultar e reproduzir
   * os segmentos reais de vídeo das 10 posições
   * aprovadas na sessão de liveness.
   * =========================================================
   */

  router.use(
    "/liveness",
    adminLivenessMedia
  );

  return router;
}


module.exports =
  createAdminRouter;
