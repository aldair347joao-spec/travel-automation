const express = require("express");

const Application =
  require("../models/application");

const ApplicationAdminControl =
  require("../models/application-admin-control");

const AuditLog =
  require("../models/audit-log");

const ApplicationService =
  require("../services/application/application-service");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");


const VISA_TYPES = [
  "SCHENGEN",
  "NACIONAL"
];


/*
 * ============================================================
 * ADMIN STATUS SANITIZADO
 * ============================================================
 */

function serializeAdminControl(
  control
) {
  if (!control) {
    return {
      status:
        "PENDING_REVIEW",

      released:
        false,

      credentialsConfigured:
        false,

      releasedAt:
        null
    };
  }


  const credentialsConfigured =
    Boolean(
      control.vfsCredentials &&
      control.vfsCredentials.emailEncrypted &&
      control.vfsCredentials.passwordEncrypted
    );


  return {
    status:
      control.status ||
      "PENDING_REVIEW",

    released:
      Boolean(
        control.release?.enabled
      ),

    credentialsConfigured,

    releasedAt:
      control.release?.releasedAt ||
      null
  };
}


/*
 * ============================================================
 * ANEXAR ESTADO ADMINISTRATIVO
 * ============================================================
 */

async function attachAdminStatus(
  applications
) {
  if (
    !Array.isArray(
      applications
    ) ||
    !applications.length
  ) {
    return applications;
  }


  const applicationIds =
    applications
      .map(
        application =>
          application?._id
      )
      .filter(Boolean);


  if (
    !applicationIds.length
  ) {
    return applications;
  }


  const controls =
    await ApplicationAdminControl.find(
      {
        applicationId: {
          $in:
            applicationIds
        }
      }
    )
      .select(
        [
          "applicationId",
          "status",
          "vfsCredentials.emailEncrypted",
          "vfsCredentials.passwordEncrypted",
          "release.enabled",
          "release.releasedAt"
        ].join(" ")
      )
      .lean();


  const controlsByApplication =
    new Map();


  controls.forEach(
    control => {
      controlsByApplication.set(
        String(
          control.applicationId
        ),
        control
      );
    }
  );


  applications.forEach(
    application => {
      const id =
        application?._id
          ? String(
              application._id
            )
          : null;


      const control =
        id
          ? controlsByApplication.get(
              id
            )
          : null;


      const admin =
        serializeAdminControl(
          control
        );


      application.admin =
        admin;
    }
  );


  return applications;
}


/*
 * ============================================================
 * PREPARED DATA
 * ============================================================
 */

function buildPreparedData(
  clients,
  travelPreferences
) {
  return {
    visaType:
      travelPreferences.visaType,

    visaCenter:
      travelPreferences.visaCenter,

    travelPurpose:
      travelPreferences.travelPurpose,

    serviceType:
      travelPreferences.serviceType ||
      null,

    appointmentMode:
      travelPreferences.appointmentMode ||
      "VFS_APPOINTMENT",

    preferredDates:
      travelPreferences.preferredDates,

    preferredTime:
      travelPreferences.preferredTime,

    preferredWeekdays:
      travelPreferences.preferredWeekdays,

    applicants:
      clients.map(
        client => ({
          clientId:
            client._id.toString(),

          fullName:
            client.fullName,

          email:
            client.email,

          phone:
            client.phone,

          dateOfBirth:
            client.dateOfBirth,

          nationality:
            client.nationality,

          gender:
            client.gender,

          passportNumber:
            client.passportNumber,

          passportIssueDate:
            client.passportIssueDate,

          passportExpiryDate:
            client.passportExpiryDate,

          passportCountry:
            client.passportCountry
        })
      )
  };
}


/*
 * ============================================================
 * ISOLAMENTO DAS CANDIDATURAS
 * ============================================================
 *
 * IMPORTANTE:
 *
 * Todos os colaboradores "client" podem pertencer à mesma
 * accountId administrativa.
 *
 * Por isso accountId sozinho NÃO é suficiente para separar
 * as candidaturas entre colaboradores.
 *
 * Para role "client":
 *
 *     accountId
 *     +
 *     createdBy
 *
 * Owner/admin/operator/viewer continuam a trabalhar sobre
 * todas as candidaturas da própria accountId.
 *
 * ============================================================
 */

function getApplicationScope(
  req
) {
  const scope = {
    accountId:
      req.user.accountId
  };


  if (
    req.user.role ===
    "client"
  ) {
    scope.createdBy =
      req.user._id;
  }


  return scope;
}


/*
 * ============================================================
 * ERROR STATUS
 * ============================================================
 */

function getErrorStatus(
  error
) {
  if (
    !error
  ) {
    return 500;
  }


  if (
    error.code ===
    "APPLICATION_NOT_FOUND"
  ) {
    return 404;
  }


  if (
    error.code ===
      "INVALID_PREFERENCES" ||
    error.code ===
      "INVALID_WORKFLOW_TRANSITION" ||
    error.code ===
      "RADAR_NOT_READY" ||
    error.code ===
      "BOOKING_NOT_READY" ||
    error.code ===
      "APPLICATION_NOT_PREPARABLE"
  ) {
    return 409;
  }


  if (
    error.code ===
      "PASSPORT_NOT_READY" ||
    error.code ===
      "IDENTITY_NOT_READY" ||
    error.code ===
      "PREFERENCES_NOT_READY"
  ) {
    return 409;
  }


  if (
    error.code ===
    "NO_APPLICANTS"
  ) {
    return 400;
  }


  if (
    error.name ===
    "ValidationError"
  ) {
    return 400;
  }


  if (
    error.code ===
      11000 ||
    error.code ===
      "DUPLICATE_KEY"
  ) {
    return 409;
  }


  return 500;
}


/*
 * ============================================================
 * SEND ERROR
 * ============================================================
 */

function sendError(
  res,
  error
) {
  const status =
    getErrorStatus(
      error
    );


  return res.status(
    status
  ).json({
    success: false,

    error:
      error.message ||
      "Internal server error",

    code:
      error.code ||
      "INTERNAL_ERROR",

    details:
      error.details ||
      undefined
  });
}


/*
 * ============================================================
 * ROUTER
 * ============================================================
 */

function createApplicationRouter({
  supervisor
}) {
  const router =
    express.Router();


  router.use(
    requireAuth
  );


  /*
   * ==========================================================
   * CREATE APPLICATION
   * ==========================================================
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

        const visaType =
          String(
            req.body.visaType ||
            ""
          )
            .trim()
            .toUpperCase();


        if (
          !VISA_TYPES.includes(
            visaType
          )
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "Selecione um tipo de visto válido: SCHENGEN ou NACIONAL",

            code:
              "INVALID_VISA_TYPE"
          });
        }


        /*
         * ------------------------------------------------------
         * CLIENT IDS
         * ------------------------------------------------------
         */

        let clientIds = [];


        if (
          Array.isArray(
            req.body.clientIds
          )
        ) {
          clientIds =
            req.body.clientIds;
        }


        if (
          req.body.clientId &&
          !clientIds.includes(
            req.body.clientId
          )
        ) {
          clientIds.push(
            req.body.clientId
          );
        }


        if (
          !clientIds.length
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "clientId or clientIds is required",

            code:
              "CLIENT_REQUIRED"
          });
        }


        const uniqueClientIds =
          [
            ...new Set(
              clientIds.map(
                String
              )
            )
          ];


        if (
          uniqueClientIds.length >
          20
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "Maximum of 20 applicants per application",

            code:
              "MAX_APPLICANTS_EXCEEDED"
          });
        }


        /*
         * ------------------------------------------------------
         * BOOKING MODE
         * ------------------------------------------------------
         */

        const bookingMode =
          String(
            req.body.bookingMode ||
            (
              uniqueClientIds.length > 1
                ? "GROUP_REQUIRED"
                : "SINGLE"
            )
          )
            .trim()
            .toUpperCase();


        const allowedModes = [
          "SINGLE",
          "GROUP_REQUIRED",
          "PARTIAL_ALLOWED"
        ];


        if (
          !allowedModes.includes(
            bookingMode
          )
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "Invalid bookingMode",

            code:
              "INVALID_BOOKING_MODE"
          });
        }


        if (
          bookingMode ===
            "SINGLE" &&
          uniqueClientIds.length > 1
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "SINGLE mode accepts only one applicant",

            code:
              "INVALID_BOOKING_MODE"
          });
        }


        /*
         * ------------------------------------------------------
         * PREFERÊNCIAS
         * ------------------------------------------------------
         */

        const preferredDates =
          req.body.preferredDates &&
          typeof req.body.preferredDates ===
            "object"
            ? {
                start:
                  req.body.preferredDates.start ||
                  null,

                end:
                  req.body.preferredDates.end ||
                  null
              }
            : {
                start: null,
                end: null
              };


        const preferredTime =
          req.body.preferredTime ||
          "ANY";


        const preferredWeekdays =
          Array.isArray(
            req.body.preferredWeekdays
          )
            ? req.body.preferredWeekdays
            : [];


        const visaCenter =
          typeof req.body.visaCenter ===
            "string"
            ? req.body.visaCenter.trim()
            : null;


        const travelPurpose =
          typeof req.body.travelPurpose ===
            "string"
            ? req.body.travelPurpose.trim()
            : null;


        const serviceType =
          typeof req.body.serviceType ===
            "string"
            ? req.body.serviceType.trim()
            : null;


        const appointmentMode =
          typeof req.body.appointmentMode ===
            "string"
            ? req.body.appointmentMode.trim()
            : "VFS_APPOINTMENT";


        /*
         * ------------------------------------------------------
         * IDEMPOTENCY
         * ------------------------------------------------------
         *
         * A chave continua a impedir apenas duplicações
         * acidentais da mesma submissão.
         *
         * Ela NÃO impede uma nova candidatura.
         */

        const idempotencyKey =
          req.get(
            "Idempotency-Key"
          ) ||
          req.body.idempotencyKey ||
          null;


        if (
          idempotencyKey
        ) {

          const existing =
            await Application.findOne({
              ...getApplicationScope(
                req
              ),

              idempotencyKey
            });


          if (
            existing
          ) {

            await attachAdminStatus([
              existing
            ]);


            return res.status(
              200
            ).json({
              success: true,

              existing: true,

              application:
                existing
            });
          }
        }


        /*
         * ------------------------------------------------------
         * CLIENTES
         * ------------------------------------------------------
         *
         * Para role client:
         *
         * - accountId deve coincidir;
         * - createdBy deve ser o próprio colaborador.
         *
         * Assim um colaborador não consegue criar uma
         * candidatura usando o viajante de outro colaborador.
         */

        const clientQuery = {
          _id: {
            $in:
              uniqueClientIds
          },

          accountId:
            req.user.accountId,

          active:
            true
        };


        if (
          req.user.role ===
          "client"
        ) {
          clientQuery.createdBy =
            req.user._id;
        }


        const clients =
          await require(
            "../models/client"
          ).find(
            clientQuery
          );


        if (
          clients.length !==
          uniqueClientIds.length
        ) {
          return res.status(
            404
          ).json({
            success: false,

            error:
              "One or more clients were not found",

            code:
              "CLIENT_NOT_FOUND"
          });
        }


        const groupId =
          clients.length > 1
            ? (
                req.body.groupId ||
                `GRP-${Date.now()}`
              )
            : null;


        const travelPreferences = {
          visaType,

          visaCenter,

          travelPurpose,

          serviceType,

          appointmentMode,

          preferredDates,

          preferredTime,

          preferredWeekdays
        };


        /*
         * ------------------------------------------------------
         * APPLICATION SERVICE
         * ------------------------------------------------------
         */

        const application =
          await ApplicationService.create({
            accountId:
              req.user.accountId,

            createdBy:
              req.user._id,

            clientIds:
              uniqueClientIds,

            bookingMode,

            ...travelPreferences
          });


        /*
         * ------------------------------------------------------
         * LEGACY DATA
         * ------------------------------------------------------
         */

        application.groupId =
          groupId;

        application.idempotencyKey =
          idempotencyKey;


        const preparedData =
          buildPreparedData(
            clients,
            travelPreferences
          );


        const {
          encryptJson
        } =
          require(
            "../utils/crypto"
          );


        application.preparedDataEncrypted =
          encryptJson(
            preparedData
          );


        /*
         * ------------------------------------------------------
         * NOVO FLUXO
         * ------------------------------------------------------
         */

        await application.save();


        await ApplicationAdminControl.findOneAndUpdate(
          {
            applicationId:
              application._id
          },
          {
            $setOnInsert: {
              accountId:
                application.accountId,

              applicationId:
                application._id,

              status:
                "PENDING_REVIEW",

              "release.enabled":
                false
            }
          },
          {
            upsert: true,

            new: true,

            setDefaultsOnInsert:
              true
          }
        );


        /*
         * ------------------------------------------------------
         * AUDIT
         * ------------------------------------------------------
         */

        await AuditLog.create({
          actorId:
            req.user._id,

          action:
            "application.create",

          resource:
            "application",

          resourceId:
            application._id.toString(),

          ip:
            req.ip
        });


        /*
         * ------------------------------------------------------
         * ESTADO ADMINISTRATIVO
         * ------------------------------------------------------
         */

        const adminControl =
          await ApplicationAdminControl.findOne({
            applicationId:
              application._id
          });


        application.admin =
          serializeAdminControl(
            adminControl
          );


        return res.status(
          201
        ).json({
          success: true,

          application
        });


      } catch (
        error
      ) {

        if (
          error.code ===
            11000 ||
          error.code ===
            "DUPLICATE_KEY"
        ) {
          return res.status(
            409
          ).json({
            success: false,

            error:
              "Já existe uma aplicação com os mesmos dados de idempotência.",

            code:
              "DUPLICATE_APPLICATION"
          });
        }


        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * LIST APPLICATIONS
   * ==========================================================
   *
   * CLIENT:
   * somente candidaturas criadas pelo próprio colaborador.
   *
   * ADMIN:
   * candidaturas da account administrativa.
   * ==========================================================
   */

  router.get(
    "/",

    async (
      req,
      res,
      next
    ) => {

      try {

        const applications =
          await Application.find(
            getApplicationScope(
              req
            )
          )
            .populate(
              "client",
              "fullName email passportNumber"
            )
            .populate(
              "applicants.client",
              "fullName email passportNumber"
            )
            .sort({
              createdAt: -1
            })
            .limit(200);


        await attachAdminStatus(
          applications
        );


        return res.json({
          success: true,

          applications
        });


      } catch (
        error
      ) {

        next(error);
      }
    }
  );


  /*
   * ==========================================================
   * GET ONE
   * ==========================================================
   *
   * O mesmo isolamento usado na lista é aplicado aqui.
   *
   * Isto impede que um colaborador tente abrir directamente
   * uma candidatura de outro colaborador através do ID.
   * ==========================================================
   */

  router.get(
    "/:id",

    async (
      req,
      res,
      next
    ) => {

      try {

        const application =
          await Application.findOne({
            _id:
              req.params.id,

            ...getApplicationScope(
              req
            )
          });


        if (
          !application
        ) {
          const error =
            new Error(
              "Aplicação não encontrada."
            );

          error.code =
            "APPLICATION_NOT_FOUND";

          throw error;
        }


        await application.populate(
          [
            {
              path:
                "client"
            },
            {
              path:
                "applicants.client"
            }
          ]
        );


        /*
         * Estado administrativo sanitizado.
         */

        const adminControl =
          await ApplicationAdminControl.findOne({
            applicationId:
              application._id
          });


        application.admin =
          serializeAdminControl(
            adminControl
          );


        return res.json({
          success: true,

          application
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * PREPARE
   * ==========================================================
   */

  router.post(
    "/:id/prepare",

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

        const result =
          await ApplicationService.prepare(
            req.params.id,
            req.user.accountId
          );


        return res.json({
          success: true,

          ready:
            result.ready ===
            true,

          application:
            result.application,

          code:
            result.code ||
            null,

          message:
            result.message ||
            null,

          passportErrors:
            result.passportErrors ||
            [],

          facialErrors:
            result.facialErrors ||
            [],

          preferenceErrors:
            result.preferenceErrors ||
            []
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * CONTINUE
   * ==========================================================
   */

  router.post(
    "/:id/continue",

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

        const application =
          await ApplicationService.getById(
            req.params.id,
            req.user.accountId
          );


        if (
          !supervisor
        ) {
          return res.status(
            503
          ).json({
            success: false,

            error:
              "Supervisor de automação não está disponível.",

            code:
              "SUPERVISOR_UNAVAILABLE"
          });
        }


        const result =
          await supervisor.continueAfterVerification(
            application._id.toString()
          );


        return res.json({
          success: true,

          application:
            result
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * OTP VERIFY
   * ==========================================================
   */

  router.post(
    "/:id/otp/verify",

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

        const code =
          typeof req.body.code ===
            "string"
            ? req.body.code.trim()
            : "";


        if (
          !/^\d{4,8}$/.test(
            code
          )
        ) {
          return res.status(
            400
          ).json({
            success: false,

            error:
              "Invalid OTP format",

            code:
              "INVALID_OTP_FORMAT"
          });
        }


        const application =
          await ApplicationService.getById(
            req.params.id,
            req.user.accountId
          );


        if (
          !supervisor
        ) {
          return res.status(
            503
          ).json({
            success: false,

            error:
              "Supervisor de automação não está disponível.",

            code:
              "SUPERVISOR_UNAVAILABLE"
          });
        }


        const result =
          await supervisor.verifyOtp(
            application._id.toString(),
            code
          );


        return res.json({
          success: true,

          application:
            result,

          otp: {
            status:
              result?.otp?.status ||
              null,

            verifiedAt:
              result?.otp?.verifiedAt ||
              null
          }
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * RESUME
   * ==========================================================
   */

  router.post(
    "/:id/resume",

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

        const application =
          await ApplicationService.getById(
            req.params.id,
            req.user.accountId
          );


        const workflowState =
          application.getWorkflowState();


        const paymentPending =
          workflowState ===
            "PAYMENT_PENDING" ||
          (
            application.status ===
              "requires_user" &&
            application.result?.paymentStatus ===
              "pending"
          );


        if (
          !paymentPending
        ) {
          return res.status(
            409
          ).json({
            success: false,

            error:
              `Application cannot be resumed from workflow state ${workflowState}`,

            code:
              "PAYMENT_NOT_PENDING",

            workflowState
          });
        }


        if (
          !supervisor
        ) {
          return res.status(
            503
          ).json({
            success: false,

            error:
              "Supervisor de automação não está disponível.",

            code:
              "SUPERVISOR_UNAVAILABLE"
          });
        }


        const result =
          await supervisor.resumeApplication(
            application._id.toString()
          );


        return res.json({
          success: true,

          application:
            result.application,

          completed:
            result.completed ===
            true,

          requiresUser:
            result.requiresUser ===
            true,

          paymentPending:
            result.paymentPending ===
            true,

          payment:
            result.payment ||
            null,

          confirmation:
            result.confirmation ||
            null,

          reason:
            result.reason ||
            null
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  /*
   * ==========================================================
   * CANCEL
   * ==========================================================
   */

  router.post(
    "/:id/cancel",

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

        const application =
          await ApplicationService.cancel(
            req.params.id,
            req.user.accountId,
            req.body.reason ||
              "Application cancelled by operator"
          );


        return res.json({
          success: true,

          application
        });


      } catch (
        error
      ) {

        return sendError(
          res,
          error
        );
      }
    }
  );


  return router;
}


module.exports =
  createApplicationRouter;
