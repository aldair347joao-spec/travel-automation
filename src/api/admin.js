const express =
  require("express");

const mongoose =
  require("mongoose");

const Application =
  require("../models/application");

const Client =
  require("../models/client");

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
   * HELPER — CLIENTE
   * =========================================================
   */

  function serializeClient(
    client
  ) {
    if (!client) {
      return null;
    }

    return {
      id:
        client._id,

      name:
        client.name ||
        client.fullName ||
        "Cliente",

      email:
        client.email ||
        null,

      phone:
        client.phone ||
        client.mobile ||
        null
    };
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
   * HELPER — SANITIZAR APPLICATION
   * =========================================================
   *
   * Nunca devolvemos:
   *
   * preparedDataEncrypted
   * VFS credentials
   * password
   * tokens
   * dados internos desnecessários.
   *
   * O administrador recebe apenas os dados necessários
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

    const payment =
      serializePayment(
        application
      );

    const result =
      application.result || {};

    const passport =
      application.passport ||
      application.passportData ||
      null;

    const facial =
      application.facial ||
      application.identity ||
      application.identityVerification ||
      null;

    const applicants =
      Array.isArray(
        application.applicants
      )
        ? application.applicants
        : [];

    return {
      id:
        application._id,

      client:
        serializeClient(
          client
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

      applicants: applicants.map(
        applicant => ({
          client:
            applicant?.client ||
            null,

          status:
            applicant?.status ||
            null
        })
      ),

      passport: passport
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
              null,

            name:
              passport.name ||
              passport.fullName ||
              null
          }
        : null,

      identity: facial
        ? {
            status:
              facial.status ||
              null,

            verified:
              Boolean(
                facial.verified ||
                facial.completed
              ),

            positionCount:
              Array.isArray(
                facial.positions
              )
                ? facial.positions.length
                : (
                    facial.positionCount ||
                    facial.positionsCount ||
                    0
                  )
          }
        : null,

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
        const accountId =
          req.user.accountId;

        const applications =
          await Application.find({
            accountId
          })
          .sort({
            createdAt:
              -1
          })
          .lean();

        const clientMap =
          await loadClientMap(
            applications
          );

        const controls =
          await ApplicationAdminControl.find({
            accountId
          })
          .lean();

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
              const client =
                resolveApplicationClient(
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
                id:
                  application._id,

                client:
                  serializeClient(
                    client
                  ),

                status:
                  application.status ||
                  null,

                workflowState:
                  application.workflowState ||
                  null,

                visaType:
                  application.visaType ||
                  null,

                visaCenter:
                  application.visaCenter ||
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

                serviceType:
                  application.serviceType ||
                  null,

                appointmentMode:
                  application.appointmentMode ||
                  null,

                bot1:
                  application.bot1 ||
                  null,

                bot2:
                  application.bot2 ||
                  null,

                payment:
                  serializePayment(
                    application
                  ),

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
                },

                createdAt:
                  application.createdAt,

                updatedAt:
                  application.updatedAt
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

        const application =
          await Application.findOne({
            _id:
              req.params.id,

            accountId:
              req.user.accountId
          })
          .lean();

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
              application._id,

            accountId:
              req.user.accountId
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

        /*
         * Verificar account ANTES
         * de alterar qualquer dado.
         */

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


  return router;
}


module.exports =
  createAdminRouter;
