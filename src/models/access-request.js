const mongoose =
  require("mongoose");


/*
 * =========================================================
 * ACCESS REQUEST MODEL
 * =========================================================
 *
 * Guarda pedidos de acesso feitos por pessoas que ainda
 * não possuem uma conta no Travel Automation.
 *
 * IMPORTANTE:
 *
 * Este documento NÃO é um User.
 *
 * O User só será criado depois da aprovação do pedido.
 * =========================================================
 */

const accessRequestSchema =
  new mongoose.Schema(
    {
      /*
       * =====================================================
       * ACCOUNT
       * =====================================================
       *
       * Identifica a conta/organização para a qual o pedido
       * está sendo direcionado.
       *
       * Quando o pedido ainda não estiver associado a uma
       * conta específica, o sistema poderá utilizar a conta
       * de entrada configurada pela aplicação.
       * =====================================================
       */

      accountId: {
        type:
          String,

        required:
          true,

        index:
          true
      },


      /*
       * =====================================================
       * REQUESTER
       * =====================================================
       */

      name: {
        type:
          String,

        required:
          true,

        trim:
          true,

        maxlength:
          120
      },


      email: {
        type:
          String,

        required:
          true,

        lowercase:
          true,

        trim:
          true,

        maxlength:
          180,

        index:
          true
      },


      phone: {
        type:
          String,

        trim:
          true,

        maxlength:
          40,

        default:
          null
      },


      company: {
        type:
          String,

        trim:
          true,

        maxlength:
          160,

        default:
          null
      },


      reason: {
        type:
          String,

        trim:
          true,

        maxlength:
          1000,

        default:
          null
      },


      /*
       * =====================================================
       * REQUEST STATUS
       * =====================================================
       *
       * pending  -> aguardando análise
       * approved -> acesso aprovado
       * rejected -> pedido recusado
       *
       * Não criamos User automaticamente quando o pedido
       * entra como pending.
       * =====================================================
       */

      status: {
        type:
          String,

        enum: [
          "pending",
          "approved",
          "rejected"
        ],

        default:
          "pending",

        index:
          true
      },


      /*
       * =====================================================
       * REVIEW
       * =====================================================
       *
       * Guarda quem analisou o pedido e quando.
       * =====================================================
       */

      reviewedBy: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref:
          "User",

        default:
          null
      },


      reviewedAt: {
        type:
          Date,

        default:
          null
      },


      reviewNote: {
        type:
          String,

        trim:
          true,

        maxlength:
          1000,

        default:
          null
      },


      /*
       * =====================================================
       * CREATED USER
       * =====================================================
       *
       * Depois da aprovação, este campo poderá apontar
       * para o User criado para o colaborador.
       *
       * Enquanto estiver pending ou rejected permanece null.
       * =====================================================
       */

      createdUserId: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref:
          "User",

        default:
          null,

        index:
          true
      },


      /*
       * =====================================================
       * SECURITY / ANTI-DUPLICATION
       * =====================================================
       *
       * Permite controlar pedidos repetidos sem transformar
       * o email em uma conta antes da aprovação.
       * =====================================================
       */

      lastSubmissionIp: {
        type:
          String,

        trim:
          true,

        maxlength:
          120,

        default:
          null
      }
    },

    {
      timestamps:
        true
    }
  );


/*
 * =========================================================
 * INDEXES
 * =========================================================
 */


/*
 * Pesquisa rápida dos pedidos pendentes de uma conta.
 */

accessRequestSchema.index(
  {
    accountId:
      1,

    status:
      1,

    createdAt:
      -1
  }
);


/*
 * Pesquisa por email dentro de uma conta.
 */

accessRequestSchema.index(
  {
    accountId:
      1,

    email:
      1,

    createdAt:
      -1
  }
);


/*
 * =========================================================
 * MODEL
 * =========================================================
 */

module.exports =
  mongoose.model(
    "AccessRequest",
    accessRequestSchema
  );
