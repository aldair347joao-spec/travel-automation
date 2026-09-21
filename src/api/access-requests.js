const express =
  require("express");

const mongoose =
  require("mongoose");

const AccessRequest =
  require("../models/access-request");

const User =
  require("../models/user");

const {
  authLimiter
} =
  require("../middleware/rate-limit");

const router =
  express.Router();


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
  const text =
    String(
      value || ""
    )
      .trim();

  return text
    .slice(
      0,
      maxLength
    );
}


function validEmail(
  email
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(email);
}


/*
 * =========================================================
 * REQUEST ACCESS
 * =========================================================
 *
 * Este endpoint é público.
 *
 * A pessoa ainda NÃO possui User.
 *
 * O pedido será criado como:
 *
 *     status = pending
 *
 * O User só será criado depois da aprovação administrativa.
 * =========================================================
 */

router.post(
  "/",
  authLimiter,
  async (
    req,
    res,
    next
  ) => {
    try {

      /*
       * =====================================================
       * INPUT
       * =====================================================
       */

      const name =
        cleanText(
          req.body?.name,
          120
        );


      const email =
        normalizeEmail(
          req.body?.email
        );


      const phone =
        cleanText(
          req.body?.phone,
          40
        );


      const company =
        cleanText(
          req.body?.company,
          160
        );


      const reason =
        cleanText(
          req.body?.reason,
          1000
        );


      /*
       * =====================================================
       * VALIDATION
       * =====================================================
       */

      if (
        !name ||
        name.length < 2
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "O nome completo é obrigatório."
          });
      }


      if (
        !email ||
        !validEmail(
          email
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Introduza um email válido."
          });
      }


      /*
       * =====================================================
       * FIND PLATFORM ACCOUNT
       * =====================================================
       *
       * O pedido público é direcionado para a conta que
       * possui o owner inicial.
       *
       * Não aceitamos accountId enviado pelo navegador.
       *
       * Isto impede que alguém tente criar pedidos em
       * contas de terceiros.
       * =====================================================
       */

      const owner =
        await User.findOne({
          role:
            "owner",

          active:
            true
        })
          .select(
            "_id accountId"
          )
          .sort({
            createdAt:
              1
          });


      if (
        !owner
      ) {
        return res
          .status(503)
          .json({
            success:
              false,

            error:
              "O sistema ainda não está preparado para receber pedidos de acesso."
          });
      }


      const accountId =
        owner.accountId;


      /*
       * =====================================================
       * CHECK EXISTING USER
       * =====================================================
       *
       * Se já existe uma conta nessa organização, não faz
       * sentido criar outro pedido de acesso.
       * =====================================================
       */

      const existingUser =
        await User.findOne({
          accountId,

          email
        })
          .select(
            "_id active role"
          );


      if (
        existingUser
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "Já existe uma conta com este email."
          });
      }


      /*
       * =====================================================
       * CHECK PENDING REQUEST
       * =====================================================
       *
       * Evita que a mesma pessoa envie dezenas de pedidos
       * pendentes.
       * =====================================================
       */

      const existingRequest =
        await AccessRequest.findOne({
          accountId,

          email,

          status:
            "pending"
        })
          .select(
            "_id createdAt"
          );


      if (
        existingRequest
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            error:
              "Já existe um pedido de acesso pendente para este email."
          });
      }


      /*
       * =====================================================
       * CREATE REQUEST
       * =====================================================
       */

      const accessRequest =
        await AccessRequest.create({
          accountId,

          name,

          email,

          phone:
            phone ||
            null,

          company:
            company ||
            null,

          reason:
            reason ||
            null,

          status:
            "pending",

          lastSubmissionIp:
            req.ip ||
            null
        });


      /*
       * =====================================================
       * RESPONSE
       * =====================================================
       *
       * Não devolvemos informações internas da conta.
       * =====================================================
       */

      return res
        .status(201)
        .json({
          success:
            true,

          message:
            "Pedido de acesso enviado com sucesso.",

          requestId:
            accessRequest._id
        });

    } catch (
      error
    ) {

      /*
       * Se houver uma corrida de requests ou outro conflito
       * de índice, deixamos o handler global tratar.
       */

      if (
        error instanceof
        mongoose.Error.ValidationError
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "Os dados enviados são inválidos."
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
