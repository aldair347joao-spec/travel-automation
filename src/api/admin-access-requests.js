const express =
  require("express");

const bcrypt =
  require("bcrypt");

const crypto =
  require("crypto");

const AccessRequest =
  require("../models/access-request");

const User =
  require("../models/user");

const AuditLog =
  require("../models/audit-log");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");


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
 * HELPERS
 * =========================================================
 */

function normalizeEmail(
  email
) {
  return String(
    email || ""
  )
    .trim()
    .toLowerCase();
}


function cleanText(
  value,
  maxLength
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return null;
  }

  const text =
    String(value)
      .trim();

  if (!text) {
    return null;
  }

  return text.slice(
    0,
    maxLength
  );
}


function serializeRequest(
  request
) {
  return {
    id:
      request._id,

    accountId:
      request.accountId,

    name:
      request.name,

    email:
      request.email,

    phone:
      request.phone ||
      null,

    company:
      request.company ||
      null,

    reason:
      request.reason ||
      null,

    status:
      request.status,

    reviewedBy:
      request.reviewedBy
        ? {
            id:
              request.reviewedBy._id ||
              request.reviewedBy,

            name:
              request.reviewedBy.name ||
              null,

            email:
              request.reviewedBy.email ||
              null
          }
        : null,

    reviewedAt:
      request.reviewedAt ||
      null,

    reviewNote:
      request.reviewNote ||
      null,

    createdUserId:
      request.createdUserId ||
      null,

    createdAt:
      request.createdAt,

    updatedAt:
      request.updatedAt
  };
}


/*
 * =========================================================
 * TEMPORARY PASSWORD
 * =========================================================
 *
 * A palavra-passe temporária:
 *
 * - não é previsível;
 * - não usa o nome;
 * - não usa o email;
 * - contém maiúsculas;
 * - contém minúsculas;
 * - contém números;
 * - contém caracteres especiais.
 *
 * Ela é devolvida SOMENTE na resposta da aprovação,
 * para que o administrador possa entregá-la ao colaborador.
 * =========================================================
 */

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  const special =
    "!@#$%&*+-_=";

  let password =
    "";

  for (
    let index = 0;
    index < 16;
    index++
  ) {
    const randomIndex =
      crypto.randomInt(
        0,
        alphabet.length
      );

    password +=
      alphabet[
        randomIndex
      ];
  }

  password +=
    special[
      crypto.randomInt(
        0,
        special.length
      )
    ];

  /*
   * Mistura novamente os caracteres.
   */

  return password
    .split("")
    .sort(
      () =>
        crypto.randomInt(
          -1,
          2
        )
    )
    .join("");
}


/*
 * =========================================================
 * LIST ACCESS REQUESTS
 * =========================================================
 *
 * GET
 * /api/admin/access-requests
 *
 * owner/admin/operator/viewer
 *
 * O accountId nunca vem do navegador.
 * Ele vem da sessão autenticada.
 * =========================================================
 */

router.get(
  "/",
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

      const status =
        String(
          req.query.status ||
            "all"
        )
          .trim()
          .toLowerCase();

      const limitValue =
        Number(
          req.query.limit
        );

      const limit =
        Number.isFinite(
          limitValue
        )
          ? Math.min(
              Math.max(
                Math.floor(
                  limitValue
                ),
                1
              ),
              100
            )
          : 50;

      const query = {
        accountId
      };

      if (
        [
          "pending",
          "approved",
          "rejected"
        ].includes(
          status
        )
      ) {
        query.status =
          status;
      }

      const requests =
        await AccessRequest.find(
          query
        )
          .populate(
            "reviewedBy",
            "name email role"
          )
          .sort({
            createdAt:
              -1
          })
          .limit(
            limit
          )
          .lean();

      return res.json({
        success:
          true,

        requests:
          requests.map(
            serializeRequest
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
 * ACCESS REQUEST STATS
 * =========================================================
 *
 * GET
 * /api/admin/access-requests/stats
 *
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

      const result =
        await AccessRequest.aggregate([
          {
            $match: {
              accountId
            }
          },
          {
            $group: {
              _id:
                "$status",

              count: {
                $sum:
                  1
              }
            }
          }
        ]);

      const stats = {
        total:
          0,

        pending:
          0,

        approved:
          0,

        rejected:
          0
      };

      for (
        const item
        of result
      ) {
        const count =
          Number(
            item.count
          ) || 0;

        stats.total +=
          count;

        if (
          Object.prototype.hasOwnProperty.call(
            stats,
            item._id
          )
        ) {
          stats[
            item._id
          ] =
            count;
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
 * ACCESS REQUEST DETAIL
 * =========================================================
 *
 * GET
 * /api/admin/access-requests/:id
 * =========================================================
 */

router.get(
  "/:id",
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
      const request =
        await AccessRequest.findOne({
          _id:
            req.params.id,

          accountId:
            req.user.accountId
        })
          .populate(
            "reviewedBy",
            "name email role"
          )
          .lean();

      if (!request) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Access request not found"
          });
      }

      return res.json({
        success:
          true,

        request:
          serializeRequest(
            request
          )
      });
    } catch (
      error
    ) {
      if (
        error?.name ===
        "CastError"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Invalid access request ID"
          });
      }

      return next(
        error
      );
    }
  }
);


/*
 * =========================================================
 * APPROVE ACCESS REQUEST
 * =========================================================
 *
 * POST
 * /api/admin/access-requests/:id/approve
 *
 * Somente:
 *
 * owner
 * admin
 *
 * A aprovação:
 *
 * 1. localiza o pedido dentro da conta;
 * 2. confirma que ainda está pending;
 * 3. verifica se o email já pertence a um User;
 * 4. cria User com role client;
 * 5. NÃO define clientId;
 * 6. marca o pedido como approved;
 * 7. guarda createdUserId;
 * 8. guarda reviewedBy/reviewedAt;
 * 9. devolve a palavra-passe temporária UMA vez.
 *
 * =========================================================
 */

router.post(
  "/:id/approve",
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

      /*
       * Primeiro obtemos o pedido.
       */

      const accessRequest =
        await AccessRequest.findOne({
          _id:
            req.params.id,

          accountId,

          status:
            "pending"
        });

      if (
        !accessRequest
      ) {
        /*
         * Pode significar:
         *
         * - pedido inexistente;
         * - outra conta;
         * - já aprovado;
         * - já rejeitado.
         */

        const existing =
          await AccessRequest.findOne({
            _id:
              req.params.id,

            accountId
          })
            .select(
              "status"
            )
            .lean();

        if (!existing) {
          return res
            .status(404)
            .json({
              success:
                false,

              error:
                "Access request not found"
            });
        }

        return res
          .status(409)
          .json({
            success:
              false,

            error:
              `Access request is already ${existing.status}`
          });
      }

      const email =
        normalizeEmail(
          accessRequest.email
        );

      /*
       * Verificar se já existe uma conta
       * com este email.
       */

      const existingUser =
        await User.findOne({
          email
        })
          .select(
            "_id accountId email role active"
          )
          .lean();

      if (
        existingUser
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "A user account with this email already exists"
          });
      }

      /*
       * Criamos uma palavra-passe temporária.
       */

      const temporaryPassword =
        generateTemporaryPassword();

      const passwordHash =
        await bcrypt.hash(
          temporaryPassword,
          12
        );

      /*
       * Criamos o colaborador.
       *
       * IMPORTANTE:
       *
       * clientId permanece null.
       *
       * Este User poderá posteriormente
       * criar vários Client viajantes.
       */

      let user;

      try {
        user =
          await User.create({
            accountId,

            clientId:
              null,

            name:
              accessRequest.name,

            email,

            passwordHash,

            role:
              "client",

            active:
              true,

            failedLoginAttempts:
              0,

            lockedUntil:
              null,

            sessionVersion:
              0,

            lastLoginAt:
              null
          });
      } catch (
        error
      ) {
        /*
         * Race condition:
         *
         * outro processo pode ter criado
         * a mesma conta depois da nossa
         * verificação.
         */

        if (
          error?.code ===
          11000
        ) {
          return res
            .status(409)
            .json({
              success:
                false,

              error:
                "A user account with this email already exists"
            });
        }

        throw error;
      }

      /*
       * Agora marcamos o pedido como aprovado.
       *
       * Usamos novamente accountId + status=pending
       * para evitar alteração cruzada.
       */

      let updatedRequest;

      try {
        updatedRequest =
          await AccessRequest.findOneAndUpdate(
            {
              _id:
                accessRequest._id,

              accountId,

              status:
                "pending"
            },
            {
              $set: {
                status:
                  "approved",

                reviewedBy:
                  req.user._id,

                reviewedAt:
                  new Date(),

                reviewNote:
                  cleanText(
                    req.body?.reviewNote,
                    1000
                  ),

                createdUserId:
                  user._id
              }
            },
            {
              new:
                true
            }
          )
            .populate(
              "reviewedBy",
              "name email role"
            );
      } catch (
        error
      ) {
        /*
         * Se a atualização do pedido falhar,
         * tentamos não deixar uma conta órfã.
         */

        try {
          await User.deleteOne({
            _id:
              user._id,

            accountId,

            role:
              "client"
          });
        } catch (
          cleanupError
        ) {
          console.error(
            "[ACCESS REQUEST] Failed to cleanup created user:",
            cleanupError.message
          );
        }

        throw error;
      }

      /*
       * Se outro administrador ganhou a corrida
       * e o pedido já não estiver pending,
       * removemos a conta criada neste processo.
       */

      if (
        !updatedRequest
      ) {
        try {
          await User.deleteOne({
            _id:
              user._id,

            accountId
          });
        } catch (
          cleanupError
        ) {
          console.error(
            "[ACCESS REQUEST] Failed to cleanup race-created user:",
            cleanupError.message
          );
        }

        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "This access request has already been processed"
          });
      }

      /*
       * Auditoria.
       */

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "access_request.approve",

        resource:
          "access_request",

        resourceId:
          accessRequest._id.toString(),

        ip:
          req.ip,

        metadata: {
          accountId,

          createdUserId:
            user._id.toString(),

          email,

          role:
            "client"
        }
      });

      /*
       * Resposta.
       *
       * A palavra-passe temporária é enviada somente
       * neste momento.
       */

      return res.json({
        success:
          true,

        message:
          "Access request approved and collaborator account created",

        request:
          serializeRequest(
            updatedRequest
          ),

        user: {
          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,

          accountId:
            user.accountId
        },

        temporaryPassword
      });
    } catch (
      error
    ) {
      if (
        error?.name ===
        "CastError"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Invalid access request ID"
          });
      }

      return next(
        error
      );
    }
  }
);


/*
 * =========================================================
 * REJECT ACCESS REQUEST
 * =========================================================
 *
 * POST
 * /api/admin/access-requests/:id/reject
 *
 * Somente:
 *
 * owner
 * admin
 *
 * =========================================================
 */

router.post(
  "/:id/reject",
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

      const reviewNote =
        cleanText(
          req.body?.reviewNote,
          1000
        );

      const updatedRequest =
        await AccessRequest.findOneAndUpdate(
          {
            _id:
              req.params.id,

            accountId,

            status:
              "pending"
          },
          {
            $set: {
              status:
                "rejected",

              reviewedBy:
                req.user._id,

              reviewedAt:
                new Date(),

              reviewNote:
                reviewNote
            }
          },
          {
            new:
              true
          }
        )
          .populate(
            "reviewedBy",
            "name email role"
          );

      if (
        !updatedRequest
      ) {
        const existing =
          await AccessRequest.findOne({
            _id:
              req.params.id,

            accountId
          })
            .select(
              "status"
            )
            .lean();

        if (!existing) {
          return res
            .status(404)
            .json({
              success:
                false,

              error:
                "Access request not found"
            });
        }

        return res
          .status(409)
          .json({
            success:
              false,

            error:
              `Access request is already ${existing.status}`
          });
      }

      /*
       * Auditoria.
       */

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "access_request.reject",

        resource:
          "access_request",

        resourceId:
          updatedRequest._id.toString(),

        ip:
          req.ip,

        metadata: {
          accountId,

          email:
            updatedRequest.email
        }
      });

      return res.json({
        success:
          true,

        message:
          "Access request rejected",

        request:
          serializeRequest(
            updatedRequest
          )
      });
    } catch (
      error
    ) {
      if (
        error?.name ===
        "CastError"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Invalid access request ID"
          });
      }

      return next(
        error
      );
    }
  }
);


/*
 * =========================================================
 * EXPORT
 * =========================================================
 */

module.exports =
  router;
