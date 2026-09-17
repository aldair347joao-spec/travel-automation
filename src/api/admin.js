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
   * ADMIN DASHBOARD
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
            "_id status workflowState result bot1 bot2 paymentStatus"
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

        const controls =
          await ApplicationAdminControl.find({
            accountId
          })
          .lean();

        const clientIds =
          [];

        for (
          const application
          of applications
        ) {
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
                applicant.client
              ) {
                clientIds.push(
                  applicant.client
                );
              }
            }
          }

          if (
            application.client
          ) {
            clientIds.push(
              application.client
            );
          }
        }

        const clients =
          await Client.find({
            _id: {
              $in:
                clientIds
            }
          })
          .lean();

        const clientMap =
          new Map(
            clients.map(
              client => [
                String(
                  client._id
                ),
                client
              ]
            )
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
              const control =
                controlMap.get(
                  String(
                    application._id
                  )
                );

              let client =
                null;

              if (
                application.client
              ) {
                client =
                  clientMap.get(
                    String(
                      application.client
                    )
                  );
              }

              if (
                !client &&
                Array.isArray(
                  application.applicants
                ) &&
                application.applicants.length
              ) {
                client =
                  clientMap.get(
                    String(
                      application
                        .applicants[0]
                        .client
                    )
                  );
              }

              return {
                id:
                  application._id,

                client: client
                  ? {
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
                    }
                  : null,

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

                payment: {
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
                },

                admin: {
                  status:
                    control?.status ||
                    "PENDING_REVIEW",

                  credentialsConfigured:
                    Boolean(
                      control?.vfsCredentials
                        ?.emailEncrypted &&
                      control?.vfsCredentials
                        ?.passwordEncrypted
                    ),

                  released:
                    Boolean(
                      control?.release?.enabled
                    ),

                  releasedAt:
                    control?.release
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

        const control =
          await ApplicationAdminControl.findOne({
            applicationId:
              application._id
          })
          .lean();

        return res.json({
          success:
            true,

          application,

          admin:
            control
              ? AdminControlService.serialize(
                  control
                )
              : {
                  applicationId:
                    application._id,

                  status:
                    "PENDING_REVIEW",

                  vfsCredentials: {
                    configured:
                      false
                  },

                  release: {
                    enabled:
                      false
                  }
                },

          payment: {
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
          }
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
        const result =
          await AdminControlService
            .releaseForAutomation({
              applicationId:
                req.params.id,

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
        const result =
          await AdminControlService
            .pauseAutomation({
              applicationId:
                req.params.id,

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


  return router;
}


module.exports =
  createAdminRouter;
