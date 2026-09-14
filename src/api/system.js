"use strict";

const express =
  require("express");

const mongoose =
  require("mongoose");

const Application =
  require("../models/application");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");

const config =
  require("../config/environment");

function sanitizeDomInspection(
  inspection
) {
  if (!inspection) {
    return null;
  }

  const elements =
    Array.isArray(
      inspection.elements
    )
      ? inspection.elements
      : [];

  /*
   * Nunca devolver ao frontend:
   *
   * - value
   * - bodyText
   * - HTML completo
   *
   * Esses campos podem conter
   * dados pessoais do candidato.
   */

  const sanitizeElement =
    element => ({
      tag:
        element.tag ||
        null,

      type:
        element.type ||
        null,

      id:
        element.id ||
        null,

      name:
        element.name ||
        null,

      role:
        element.role ||
        null,

      ariaLabel:
        element.ariaLabel ||
        null,

      placeholder:
        element.placeholder ||
        null,

      autocomplete:
        element.autocomplete ||
        null,

      accept:
        element.accept ||
        null,

      required:
        Boolean(
          element.required
        ),

      disabled:
        Boolean(
          element.disabled
        ),

      readonly:
        Boolean(
          element.readonly
        ),

      visible:
        Boolean(
          element.visible
        ),

      label:
        element.label ||
        null,

      text:
        element.text ||
        null,

      attributes:
        element.attributes ||
        {}
    });

  const sanitizeFileInput =
    element => ({
      tag:
        element.tag ||
        null,

      type:
        element.type ||
        null,

      id:
        element.id ||
        null,

      name:
        element.name ||
        null,

      accept:
        element.accept ||
        null,

      required:
        Boolean(
          element.required
        ),

      disabled:
        Boolean(
          element.disabled
        ),

      visible:
        Boolean(
          element.visible
        ),

      label:
        element.label ||
        null,

      attributes:
        element.attributes ||
        {}
    });

  return {
    success:
      Boolean(
        inspection.success
      ),

    applicationId:
      inspection.applicationId ||
      null,

    inspectedAt:
      inspection.inspectedAt ||
      null,

    url:
      inspection.url ||
      null,

    title:
      inspection.title ||
      null,

    stateHint:
      inspection.stateHint ||
      null,

    summary:
      inspection.summary ||
      null,

    elements:
      elements.map(
        sanitizeElement
      ),

    fileInputs:
      Array.isArray(
        inspection.fileInputs
      )
        ? inspection.fileInputs.map(
            sanitizeFileInput
          )
        : [],

    passportElements:
      Array.isArray(
        inspection.passportElements
      )
        ? inspection.passportElements.map(
            sanitizeElement
          )
        : [],

    cameraElements:
      Array.isArray(
        inspection.cameraElements
      )
        ? inspection.cameraElements.map(
            sanitizeElement
          )
        : [],

    otpElements:
      Array.isArray(
        inspection.otpElements
      )
        ? inspection.otpElements.map(
            sanitizeElement
          )
        : [],

    buttons:
      Array.isArray(
        inspection.buttons
      )
        ? inspection.buttons.map(
            sanitizeElement
          )
        : [],

    selects:
      Array.isArray(
        inspection.selects
      )
        ? inspection.selects.map(
            sanitizeElement
          )
        : [],

    iframes:
      Array.isArray(
        inspection.iframes
      )
        ? inspection.iframes.map(
            iframe => ({
              src:
                iframe.src ||
                null,

              title:
                iframe.title ||
                null,

              name:
                iframe.name ||
                null,

              visible:
                Boolean(
                  iframe.visible
                )
            })
          )
        : [],

    videos:
      Array.isArray(
        inspection.videos
      )
        ? inspection.videos.map(
            video => ({
              id:
                video.id ||
                null,

              autoplay:
                Boolean(
                  video.autoplay
                ),

              playsInline:
                Boolean(
                  video.playsInline
                ),

              muted:
                Boolean(
                  video.muted
                ),

              width:
                video.width ||
                null,

              height:
                video.height ||
                null
            })
          )
        : [],

    canvases:
      Array.isArray(
        inspection.canvases
      )
        ? inspection.canvases.map(
            canvas => ({
              id:
                canvas.id ||
                null,

              width:
                canvas.width ||
                null,

              height:
                canvas.height ||
                null
            })
          )
        : []
  };
}

function createSystemRouter({
  supervisor
}) {
  const router =
    express.Router();

  /*
   * ============================================================
   * HEALTH
   * ============================================================
   */

  router.get(
    "/health",
    async (
      req,
      res
    ) => {
      const dbReady =
        mongoose.connection
          .readyState === 1;

      return res.status(
        dbReady
          ? 200
          : 503
      ).json({
        success:
          dbReady,

        service:
          config.appName,

        database:
          dbReady
            ? "connected"
            : "disconnected",

        authentication:
          config.authEnabled
            ? "enabled"
            : "disabled",

        timestamp:
          new Date().toISOString()
      });
    }
  );

  /*
   * Todas as rotas abaixo exigem
   * autenticação.
   */

  router.use(
    requireAuth
  );

  /*
   * ============================================================
   * PLATFORM STATUS
   * ============================================================
   */

  router.get(
    "/status",
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
        const accountId =
          req.user.accountId;

        const [
          total,
          waiting,
          processing,
          completed,
          errors,
          cancelled
        ] =
          await Promise.all([
            Application.countDocuments({
              accountId
            }),

            Application.countDocuments({
              accountId,

              status:
                "waiting_for_slot"
            }),

            Application.countDocuments({
              accountId,

              status: {
                $in: [
                  "preparing",
                  "otp_required",
                  "identity_verification",
                  "calendar",
                  "slot_received",
                  "continuing"
                ]
              }
            }),

            Application.countDocuments({
              accountId,

              status:
                "completed"
            }),

            Application.countDocuments({
              accountId,

              status:
                "error"
            }),

            Application.countDocuments({
              accountId,

              status:
                "cancelled"
            })
          ]);

        const databaseConnected =
          mongoose.connection
            .readyState === 1;

        return res.json({
          success:
            true,

          platform: {
            name:
              config.appName,

            mode:
              config.authEnabled
                ? "authenticated"
                : "development",

            authentication:
              config.authEnabled
                ? "enabled"
                : "disabled"
          },

          database: {
            connected:
              databaseConnected,

            state:
              mongoose.connection
                .readyState
          },

          applications: {
            total,
            waiting,
            processing,
            completed,
            errors,
            cancelled
          },

          supervisor:
            supervisor.status(),

          timestamp:
            new Date().toISOString()
        });

      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  /*
   * ============================================================
   * VFS DOM DIAGNOSTIC
   * ============================================================
   *
   * GET
   * /api/system/vfs/:applicationId/dom
   *
   * O objetivo desta rota é descobrir
   * a estrutura REAL apresentada pelo
   * VFS durante uma sessão.
   *
   * Ela NÃO:
   * - faz upload;
   * - clica automaticamente;
   * - envia OTP;
   * - simula webcam;
   * - tenta contornar segurança.
   */

  router.get(
    "/vfs/:applicationId/dom",
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
        const {
          applicationId
        } = req.params;

        if (
          !applicationId ||
          !mongoose.Types.ObjectId.isValid(
            applicationId
          )
        ) {
          return res.status(
            400
          ).json({
            success:
              false,

            error:
              "Invalid applicationId"
          });
        }

        /*
         * Segurança importante:
         *
         * a aplicação precisa pertencer
         * à conta do utilizador autenticado.
         */
        const application =
          await Application.findOne({
            _id:
              applicationId,

            accountId:
              req.user.accountId
          });

        if (!application) {
          return res.status(
            404
          ).json({
            success:
              false,

            error:
              "Application not found"
          });
        }

        if (
          !supervisor ||
          typeof supervisor.getAdapter !==
            "function"
        ) {
          return res.status(
            503
          ).json({
            success:
              false,

            error:
              "Supervisor is not available"
          });
        }

        const adapter =
          await supervisor.getAdapter(
            applicationId
          );

        if (
          !adapter ||
          typeof adapter.getCurrentDomInspection !==
            "function"
        ) {
          return res.status(
            503
          ).json({
            success:
              false,

            error:
              "VFS DOM inspector is not available"
          });
        }

        /*
         * Se ainda não houver inspeção,
         * executa uma agora.
         *
         * Caso já exista, o adapter
         * devolve a última inspeção.
         */
        const inspection =
          await adapter.getCurrentDomInspection();

        const sanitized =
          sanitizeDomInspection(
            inspection
          );

        return res.json({
          success:
            true,

          application: {
            id:
              application._id.toString(),

            status:
              application.status
          },

          vfs: sanitized,

          inspectedAt:
            new Date().toISOString()
        });

      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  /*
   * ============================================================
   * VFS DOM REFRESH
   * ============================================================
   *
   * Força uma nova leitura do DOM
   * da página atual.
   */

  router.post(
    "/vfs/:applicationId/dom/refresh",
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
        const {
          applicationId
        } = req.params;

        if (
          !applicationId ||
          !mongoose.Types.ObjectId.isValid(
            applicationId
          )
        ) {
          return res.status(
            400
          ).json({
            success:
              false,

            error:
              "Invalid applicationId"
          });
        }

        const application =
          await Application.findOne({
            _id:
              applicationId,

            accountId:
              req.user.accountId
          });

        if (!application) {
          return res.status(
            404
          ).json({
            success:
              false,

            error:
              "Application not found"
          });
        }

        if (
          !supervisor ||
          typeof supervisor.getAdapter !==
            "function"
        ) {
          return res.status(
            503
          ).json({
            success:
              false,

            error:
              "Supervisor is not available"
          });
        }

        const adapter =
          await supervisor.getAdapter(
            applicationId
          );

        if (
          !adapter ||
          typeof adapter.inspectCurrentDom !==
            "function"
        ) {
          return res.status(
            503
          ).json({
            success:
              false,

            error:
              "VFS DOM inspector is not available"
          });
        }

        const inspection =
          await adapter.inspectCurrentDom({
            /*
             * Nunca solicitar HTML completo
             * através da API.
             */
            includeHtml:
              false
          });

        const sanitized =
          sanitizeDomInspection(
            inspection
          );

        return res.json({
          success:
            true,

          application: {
            id:
              application._id.toString(),

            status:
              application.status
          },

          vfs:
            sanitized,

          refreshedAt:
            new Date().toISOString()
        });

      } catch (error) {
        return next(
          error
        );
      }
    }
  );

  return router;
}

module.exports =
  createSystemRouter;
