const mongoose =
  require("mongoose");

/*
 * ============================================================
 * LIVENESS POSITION
 * ============================================================
 *
 * Cada posição representa um evento biométrico confirmado
 * pelo motor facial local.
 *
 * IMPORTANTE:
 *
 * Isto NÃO é uma fotografia.
 * Não existe data URL.
 * Não existe imagem armazenada.
 * Não existe storageReference obrigatório.
 *
 * Guardamos apenas os sinais necessários para comprovar
 * que a posição foi realmente executada durante a sessão.
 * ============================================================
 */

const livenessPositionSchema =
  new mongoose.Schema(
    {
      position: {
        type: Number,
        min: 1,
        max: 10,
        required: true
      },

      label: {
        type: String,
        required: true,
        maxlength: 80
      },

      instruction: {
        type: String,
        default: null,
        maxlength: 240
      },

      sequence: {
        type: Number,
        min: 1,
        max: 10,
        required: true
      },

      score: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      positionScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      faceDetected: {
        type: Boolean,
        default: false
      },

      singleFace: {
        type: Boolean,
        default: false
      },

      faceCount: {
        type: Number,
        min: 0,
        default: 0
      },

      faceArea: {
        type: Number,
        min: 0,
        default: 0
      },

      detectionScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      pose: {
        yaw: {
          type: Number,
          default: 0
        },

        pitch: {
          type: Number,
          default: 0
        },

        roll: {
          type: Number,
          default: 0
        }
      },

      quality: {
        brightness: {
          type: Number,
          default: 0
        },

        brightnessScore: {
          type: Number,
          min: 0,
          max: 1,
          default: 0
        },

        sharpnessScore: {
          type: Number,
          min: 0,
          max: 1,
          default: 0
        },

        faceSizeScore: {
          type: Number,
          min: 0,
          max: 1,
          default: 0
        },

        detectionScore: {
          type: Number,
          min: 0,
          max: 1,
          default: 0
        }
      },

      smileDetected: {
        type: Boolean,
        default: false
      },

      smileScore: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
      },

      verified: {
        type: Boolean,
        default: false
      },

      completedAt: {
        type: Date,
        default: Date.now
      }
    },
    {
      _id: false
    }
  );


/*
 * ============================================================
 * LIVENESS SESSION
 * ============================================================
 *
 * Uma sessão representa uma execução completa do fluxo
 * facial.
 *
 * Não contém imagens.
 * ============================================================
 */

const livenessSessionSchema =
  new mongoose.Schema(
    {
      sessionId: {
        type: String,
        required: true,
        maxlength: 160
      },

      status: {
        type: String,
        enum: [
          "in_progress",
          "passed",
          "failed",
          "requires_user"
        ],
        default: "in_progress"
      },

      source: {
        type: String,
        default: "local_liveness"
      },

      startedAt: {
        type: Date,
        default: null
      },

      completedAt: {
        type: Date,
        default: null
      },

      score: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      completedCount: {
        type: Number,
        min: 0,
        max: 10,
        default: 0
      },

      total: {
        type: Number,
        min: 0,
        max: 10,
        default: 10
      },

      verified: {
        type: Boolean,
        default: false
      },

      positions: {
        type: [
          livenessPositionSchema
        ],
        default: []
      }
    },
    {
      _id: false
    }
  );


/*
 * ============================================================
 * LEGACY / OFFICIAL FACIAL POSITION
 * ============================================================
 *
 * Mantemos esta estrutura para não quebrar documentos antigos.
 *
 * storageReference deixa de ser obrigatório porque o novo
 * fluxo de liveness não depende de fotografias por posição.
 * ============================================================
 */

const facePositionSchema =
  new mongoose.Schema(
    {
      position: {
        type: Number,
        min: 1,
        max: 10,
        required: true
      },

      label: {
        type: String,
        required: true,
        maxlength: 80
      },

      storageReference: {
        type: String,
        default: null,
        maxlength: 500
      },

      capturedAt: {
        type: Date,
        default: Date.now
      },

      verified: {
        type: Boolean,
        default: false
      }
    },
    {
      _id: false
    }
  );


/*
 * ============================================================
 * FACIAL PROFILE
 * ============================================================
 */

const facialProfileSchema =
  new mongoose.Schema(
    {
      provider: {
        type: String,
        default: null
      },

      templateReference: {
        type: String,
        default: null
      },

      /*
       * Mantido por compatibilidade com versões anteriores.
       *
       * O novo fluxo não depende deste array para validar
       * a sessão de liveness.
       */
      positions: {
        type: [
          facePositionSchema
        ],

        validate: {
          validator(value) {
            return value.length <= 10;
          },

          message:
            "Maximum of 10 facial positions"
        }
      },

      videoReference: {
        type: String,
        default: null,
        maxlength: 500
      },

      verificationStatus: {
        type: String,

        enum: [
          "not_started",
          "pending",
          "verified",
          "failed"
        ],

        default:
          "not_started"
      }
    },
    {
      _id: false
    }
  );


/*
 * ============================================================
 * INTERNAL FACIAL PREFLIGHT
 * ============================================================
 *
 * Isto representa a preparação/liveness executada pelo
 * próprio sistema.
 *
 * NÃO significa que uma verificação VFS externa foi concluída.
 * ============================================================
 */

const facialPreflightSchema =
  new mongoose.Schema(
    {
      status: {
        type: String,

        enum: [
          "not_started",
          "in_progress",
          "passed",
          "requires_user",
          "failed"
        ],

        default:
          "not_started"
      },

      score: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      minimumScore: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      minimumPositionScore: {
        type: Number,
        min: 0,
        max: 1,
        default: null
      },

      positionsCompleted: {
        type: Number,
        min: 0,
        max: 10,
        default: 0
      },

      positionsRequired: {
        type: Number,
        min: 0,
        max: 10,
        default: 10
      },

      smileDetected: {
        type: Boolean,
        default: false
      },

      passportMatch: {
        name: {
          type: Boolean,
          default: null
        },

        dateOfBirth: {
          type: Boolean,
          default: null
        },

        passportNumber: {
          type: Boolean,
          default: null
        },

        nationality: {
          type: Boolean,
          default: null
        }
      },

      /*
       * ======================================================
       * SESSÃO REAL DE LIVENESS
       * ======================================================
       *
       * Aqui ficam os eventos das 10 posições.
       *
       * Nenhuma imagem é armazenada.
       */

      livenessSession: {
        type:
          livenessSessionSchema,

        default: null
      },

      issues: {
        type: [String],
        default: []
      },

      checkedAt: {
        type: Date,
        default: null
      },

      consentAcceptedAt: {
        type: Date,
        default: null
      }
    },
    {
      _id: false
    }
  );


/*
 * ============================================================
 * CLIENT
 * ============================================================
 */

const clientSchema =
  new mongoose.Schema(
    {
      accountId: {
        type: String,
        required: true,
        index: true
      },

      createdBy: {
        type:
          mongoose.Schema.Types.ObjectId,

        ref: "User",

        required: true
      },

      fullName: {
        type: String,

        required: true,

        trim: true,

        maxlength: 160
      },

      email: {
        type: String,

        required: true,

        lowercase: true,

        trim: true,

        maxlength: 254
      },

      phone: {
        type: String,

        default: null,

        maxlength: 40
      },

      dateOfBirth: {
        type: String,

        default: null
      },

      nationality: {
        type: String,

        default: null
      },

      gender: {
        type: String,

        default: null
      },

      passportNumber: {
        type: String,

        default: null
      },

      passportIssueDate: {
        type: String,

        default: null
      },

      passportExpiryDate: {
        type: String,

        default: null
      },

      passportCountry: {
        type: String,

        default: null
      },

      passportType: {
        type: String,

        enum: [
          "legacy",
          "electronic",
          "unknown"
        ],

        default: "unknown"
      },

      passportValidation: {
        status: {
          type: String,

          enum: [
            "not_started",
            "pending",
            "passed",
            "requires_user",
            "failed"
          ],

          default:
            "not_started"
        },

        passportType: {
          type: String,

          enum: [
            "legacy",
            "electronic",
            "unknown"
          ],

          default: "unknown"
        },

        mrzPresent: {
          type: Boolean,
          default: false
        },

        mrzValid: {
          type: Boolean,
          default: false
        },

        ocrValid: {
          type: Boolean,
          default: false
        },

        clientMatch: {
          type: Boolean,
          default: false
        },

        expired: {
          type: Boolean,
          default: false
        },

        fingerprint: {
          type: String,
          default: null
        },

        issues: {
          type: [String],
          default: []
        },

        checkedAt: {
          type: Date,
          default: null
        }
      },

      /*
       * ======================================================
       * BIOMETRIC CONSENT
       * ======================================================
       */

      facialConsent: {
        accepted: {
          type: Boolean,

          default: false
        },

        acceptedAt: {
          type: Date,

          default: null
        }
      },

      /*
       * ======================================================
       * OFFICIAL FACIAL PROFILE
       * ======================================================
       */

      facialProfile: {
        type:
          facialProfileSchema,

        default: () => ({
          positions: []
        })
      },

      /*
       * ======================================================
       * FACIAL PREFLIGHT / LIVENESS
       * ======================================================
       */

      facialPreflight: {
        type:
          facialPreflightSchema,

        default: () => ({
          status:
            "not_started",

          positionsCompleted:
            0,

          positionsRequired:
            10,

          issues: [],

          livenessSession:
            null
        })
      },

      active: {
        type: Boolean,

        default: true
      }
    },

    {
      timestamps: true
    }
  );


/*
 * ============================================================
 * INDEXES
 * ============================================================
 */

clientSchema.index({
  accountId: 1,
  email: 1
});


/*
 * ============================================================
 * EXPORT
 * ============================================================
 */

module.exports =
  mongoose.model(
    "Client",
    clientSchema
  );
