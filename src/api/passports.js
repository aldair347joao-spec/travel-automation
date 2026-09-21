const express =
  require("express");

const multer =
  require("multer");

const crypto =
  require("crypto");

const Client =
  require("../models/client");

const AuditLog =
  require("../models/audit-log");

const PassportOcrService =
  require("../services/passport/passport-ocr-service");

const PassportValidationService =
  require("../services/passport/passport-validation-service");

const PassportStorageService =
  require("../services/passport/passport-storage-service");

const {
  requireAuth,
  requireRole
} =
  require("../middleware/auth");


const router =
  express.Router();


const ocr =
  new PassportOcrService();

const validation =
  new PassportValidationService();

const storage =
  new PassportStorageService();


const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        6 * 1024 * 1024,

      files: 1
    },

    fileFilter(
      req,
      file,
      callback
    ) {
      if (
        ![
          "image/jpeg",
          "image/png"
        ].includes(
          file.mimetype
        )
      ) {
        return callback(
          new Error(
            "Only JPEG and PNG passport images are supported"
          )
        );
      }

      callback(
        null,
        true
      );
    }
  });


router.use(
  requireAuth
);


/*
 * =========================================================
 * AUTORIZAÇÃO / ISOLAMENTO
 * =========================================================
 */

function isPrivilegedPassportUser(
  req
) {
  return [
    "owner",
    "admin",
    "operator"
  ].includes(
    req.user?.role
  );
}


function isSameUserId(
  first,
  second
) {
  if (
    !first ||
    !second
  ) {
    return false;
  }

  return (
    String(first) ===
    String(second)
  );
}


function buildClientScope(
  req,
  clientId
) {
  const filter = {
    _id:
      clientId,

    accountId:
      req.user.accountId,

    active:
      true
  };

  if (
    req.user.role ===
    "client"
  ) {
    filter.createdBy =
      req.user._id;
  }

  return filter;
}


/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function createFingerprint(
  buffer
) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}


function normalizeText(
  value
) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}


function normalizeCompact(
  value
) {
  return normalizeText(value)
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    );
}


function normalizeOcrValue(
  value
) {
  return String(value || "")
    .replace(/[|]/g, "I")
    .replace(
      /[“”"]/g,
      ""
    )
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    )
    .split("\n")
    .map(
      line =>
        line
          .replace(
            /\s+/g,
            " "
          )
          .trim()
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}


/*
 * =========================================================
 * DATAS VISUAIS
 * =========================================================
 */

function normalizeDateCandidate(
  value
) {
  const raw =
    String(value || "")
      .trim()
      .replace(
        /[Oo]/g,
        "0"
      )
      .replace(
        /[Il|]/g,
        "1"
      )
      .replace(
        /[Ss]/g,
        "5"
      );

  let match =
    raw.match(
      /\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/
    );

  if (match) {
    const day =
      match[1];

    const month =
      match[2];

    const year =
      match[3];

    const date =
      new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day)
        )
      );

    if (
      date.getUTCFullYear() !==
        Number(year) ||
      date.getUTCMonth() !==
        Number(month) - 1 ||
      date.getUTCDate() !==
        Number(day)
    ) {
      return null;
    }

    return (
      `${year}-${month}-${day}`
    );
  }


  match =
    raw.match(
      /\b(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})\b/
    );

  if (match) {
    const year =
      match[1];

    const month =
      match[2];

    const day =
      match[3];

    const date =
      new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day)
        )
      );

    if (
      date.getUTCFullYear() !==
        Number(year) ||
      date.getUTCMonth() !==
        Number(month) - 1 ||
      date.getUTCDate() !==
        Number(day)
    ) {
      return null;
    }

    return (
      `${year}-${month}-${day}`
    );
  }


  match =
    raw.match(
      /\b(\d{1,2})[\s\-\/,]+([A-Za-z]{3,9})[\s\-\/,]+(\d{4})\b/i
    );

  if (match) {
    const day =
      String(
        match[1]
      ).padStart(
        2,
        "0"
      );

    const monthName =
      String(
        match[2]
      )
        .trim()
        .toUpperCase()
        .slice(
          0,
          3
        );

    const year =
      match[3];

    const months = {
      JAN: "01",
      FEB: "02",
      MAR: "03",
      APR: "04",
      MAY: "05",
      JUN: "06",
      JUL: "07",
      AUG: "08",
      SEP: "09",
      OCT: "10",
      NOV: "11",
      DEC: "12"
    };

    const month =
      months[monthName];

    if (!month) {
      return null;
    }

    const date =
      new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day)
        )
      );

    if (
      date.getUTCFullYear() !==
        Number(year) ||
      date.getUTCMonth() !==
        Number(month) - 1 ||
      date.getUTCDate() !==
        Number(day)
    ) {
      return null;
    }

    return (
      `${year}-${month}-${day}`
    );
  }

  return null;
}


function visualDateToMrzDate(
  value
) {
  const match =
    String(value || "")
      .trim()
      .match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

  if (!match) {
    return null;
  }

  const year =
    match[1];

  const month =
    match[2];

  const day =
    match[3];

  const date =
    new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day)
      )
    );

  if (
    date.getUTCFullYear() !==
      Number(year) ||
    date.getUTCMonth() !==
      Number(month) - 1 ||
    date.getUTCDate() !==
      Number(day)
  ) {
    return null;
  }

  return (
    year.slice(-2) +
    month +
    day
  );
}


/*
 * =========================================================
 * MRZ CHECK DIGITS
 * =========================================================
 */

function calculateMrzCheckDigit(
  value
) {
  const weights = [
    7,
    3,
    1
  ];

  let sum = 0;

  const normalized =
    String(value || "")
      .toUpperCase();

  for (
    let index = 0;
    index <
      normalized.length;
    index += 1
  ) {
    const char =
      normalized[index];

    let numericValue;

    if (
      char >= "0" &&
      char <= "9"
    ) {
      numericValue =
        Number(char);
    } else if (
      char >= "A" &&
      char <= "Z"
    ) {
      numericValue =
        char.charCodeAt(0) -
        55;
    } else if (
      char === "<"
    ) {
      numericValue = 0;
    } else {
      return null;
    }

    sum +=
      numericValue *
      weights[
        index % 3
      ];
  }

  return String(
    sum % 10
  );
}


function rebuildTd3CompositeCheckDigit(
  line2
) {
  const normalized =
    String(line2 || "")
      .replace(
        /\s/g,
        ""
      )
      .toUpperCase();

  if (
    normalized.length !==
    44
  ) {
    return null;
  }

  const compositeInput =
    normalized.slice(
      0,
      10
    ) +
    normalized.slice(
      13,
      20
    ) +
    normalized.slice(
      21,
      43
    );

  return calculateMrzCheckDigit(
    compositeInput
  );
}


function recoverMrzWithVisualExpiry(
  pair,
  visualExpiryDate
) {
  if (
    !pair ||
    !pair.line1 ||
    !pair.line2
  ) {
    return null;
  }

  const line1 =
    String(pair.line1)
      .replace(
        /\s/g,
        ""
      )
      .toUpperCase();

  let line2 =
    String(pair.line2)
      .replace(
        /\s/g,
        ""
      )
      .toUpperCase();

  if (
    line1.length !== 44 ||
    line2.length !== 44
  ) {
    return null;
  }

  const mrzExpiry =
    visualDateToMrzDate(
      visualExpiryDate
    );

  if (!mrzExpiry) {
    return null;
  }

  /*
   * TD3:
   *
   * 22-27 = YYMMDD
   * 28    = check digit
   * 44    = composite
   *
   * Índices JS:
   * 21-26
   * 27
   * 43
   */

  line2 =
    line2.slice(
      0,
      21
    ) +
    mrzExpiry +
    "<" +
    line2.slice(
      28
    );

  const expiryCheckDigit =
    calculateMrzCheckDigit(
      mrzExpiry
    );

  if (
    expiryCheckDigit ===
    null
  ) {
    return null;
  }

  line2 =
    line2.slice(
      0,
      27
    ) +
    expiryCheckDigit +
    line2.slice(
      28
    );

  const compositeCheckDigit =
    rebuildTd3CompositeCheckDigit(
      line2
    );

  if (
    compositeCheckDigit ===
    null
  ) {
    return null;
  }

  line2 =
    line2.slice(
      0,
      43
    ) +
    compositeCheckDigit;

  return {
    line1,
    line2
  };
}


/*
 * =========================================================
 * OCR VISUAL
 * =========================================================
 */

function extractVisualPassportFields(
  ocrText
) {
  const text =
    normalizeOcrValue(
      ocrText
    );

  if (!text) {
    return {
      fullName: null,
      passportNumber: null,
      nationality: null,
      dateOfBirth: null,
      gender: null,
      passportIssueDate: null,
      passportExpiryDate: null
    };
  }

  const lines =
    text
      .split(
        /\r?\n/
      )
      .map(
        line =>
          normalizeOcrValue(
            line
          )
      )
      .filter(Boolean);

  const result = {
    fullName: null,
    passportNumber: null,
    nationality: null,
    dateOfBirth: null,
    gender: null,
    passportIssueDate: null,
    passportExpiryDate: null
  };


  const issueLabels = [
    "DATE OF ISSUE",
    "ISSUE DATE",
    "DATE OF ISSUANCE",
    "ISSUED",
    "DATA DE EMISSÃO",
    "DATA EMISSÃO",
    "EMITIDO EM",
    "DATE D'EMISSION"
  ];

  const expiryLabels = [
    "DATE OF EXPIRY",
    "EXPIRY DATE",
    "DATE OF EXPIRATION",
    "VALID UNTIL",
    "EXPIRATION",
    "DATA DE VALIDADE",
    "VALIDADE",
    "EXPIRA EM"
  ];

  const birthLabels = [
    "DATE OF BIRTH",
    "BIRTH DATE",
    "DOB",
    "DATA DE NASCIMENTO",
    "NASCIMENTO"
  ];

  const passportNumberLabels = [
    "PASSPORT NO",
    "PASSPORT NO.",
    "PASSPORT NUMBER",
    "PASSPORT N°",
    "PASSPORT Nº",
    "Nº DO PASSAPORTE",
    "N DO PASSAPORTE",
    "NO DO PASSAPORTE"
  ];


  function findDateAfterLabels(
    labels
  ) {
    for (
      let index = 0;
      index < lines.length;
      index += 1
    ) {
      const line =
        lines[index]
          .toUpperCase();

      if (
        labels.some(
          label =>
            line.includes(
              label
            )
        )
      ) {
        const sameLine =
          normalizeDateCandidate(
            lines[index]
          );

        if (sameLine) {
          return sameLine;
        }

        for (
          let offset = 1;
          offset <= 2;
          offset += 1
        ) {
          if (
            lines[
              index + offset
            ]
          ) {
            const candidate =
              normalizeDateCandidate(
                lines[
                  index + offset
                ]
              );

            if (candidate) {
              return candidate;
            }
          }
        }
      }
    }

    return null;
  }


  result.passportIssueDate =
    findDateAfterLabels(
      issueLabels
    );

  result.passportExpiryDate =
    findDateAfterLabels(
      expiryLabels
    );

  result.dateOfBirth =
    findDateAfterLabels(
      birthLabels
    );


  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const upper =
      lines[index]
        .toUpperCase();

    if (
      passportNumberLabels.some(
        label =>
          upper.includes(
            label
          )
      )
    ) {
      const value =
        lines[index]
          .replace(
            /.*?(PASSPORT\s*(?:NO|NUMBER|N°|Nº)?\s*[:#]?)\s*/i,
            ""
          )
          .replace(
            /[^A-Z0-9]/gi,
            ""
          );

      if (
        value.length >= 6 &&
        value.length <= 12
      ) {
        result.passportNumber =
          value.toUpperCase();

        break;
      }

      for (
        let offset = 1;
        offset <= 2;
        offset += 1
      ) {
        const next =
          lines[
            index + offset
          ];

        if (!next) {
          continue;
        }

        const candidate =
          next
            .replace(
              /[^A-Z0-9]/gi,
              ""
            )
            .toUpperCase();

        if (
          candidate.length >= 6 &&
          candidate.length <= 12
        ) {
          result.passportNumber =
            candidate;

          break;
        }
      }

      if (
        result.passportNumber
      ) {
        break;
      }
    }
  }


  for (
    const line of lines
  ) {
    const upper =
      line.toUpperCase();

    if (
      /\bSEX\b|\bSEXO\b|\bGENDER\b/
        .test(upper)
    ) {
      if (
        /\bF\b|\bFEMALE\b|\bFEMININO\b/
          .test(upper)
      ) {
        result.gender =
          "female";

        break;
      }

      if (
        /\bM\b|\bMALE\b|\bMASCULINO\b/
          .test(upper)
      ) {
        result.gender =
          "male";

        break;
      }
    }
  }

  return result;
}


function createInternalEmail(
  passportNumber
) {
  const normalized =
    normalizeCompact(
      passportNumber
    );

  const safe =
    normalized ||
    crypto
      .createHash(
        "sha256"
      )
      .update(
        String(
          Date.now()
        )
      )
      .digest("hex")
      .slice(
        0,
        20
      );

  return (
    `passport-${safe.toLowerCase()}@travel-automation.local`
  );
}


function mapMrzSex(
  sex
) {
  const normalized =
    String(sex || "")
      .trim()
      .toUpperCase();

  if (
    normalized === "M"
  ) {
    return "male";
  }

  if (
    normalized === "F"
  ) {
    return "female";
  }

  return null;
}


/*
 * =========================================================
 * VALIDATION OBJECT
 * =========================================================
 */

function buildPassportValidation(
  {
    status,
    passportType,
    fingerprint,
    mrzPresent,
    mrzValid,
    ocrValid,
    clientMatch,
    expired,
    issues
  }
) {
  return {
    status,

    passportType:
      passportType ||
      "unknown",

    mrzPresent:
      Boolean(
        mrzPresent
      ),

    mrzValid:
      Boolean(
        mrzValid
      ),

    ocrValid:
      Boolean(
        ocrValid
      ),

    clientMatch:
      Boolean(
        clientMatch
      ),

    expired:
      Boolean(
        expired
      ),

    fingerprint:
      fingerprint ||
      null,

    issues:
      Array.isArray(
        issues
      )
        ? issues
        : [],

    checkedAt:
      new Date()
  };
}


/*
 * =========================================================
 * MRZ DIAGNÓSTICOS
 * =========================================================
 */

function createMrzDiagnostics(
  ocrResult
) {
  const pairs =
    Array.isArray(
      ocrResult?.mrzPairs
    )
      ? ocrResult.mrzPairs
      : [];

  const diagnostics = {
    mrzFound:
      pairs.length > 0,

    candidates:
      pairs.length,

    validCandidates:
      0,

    invalidCandidates:
      0,

    lineLengthCandidates:
      0,

    checkDigitFailures: {
      passportNumber: 0,
      dateOfBirth: 0,
      expiryDate: 0,
      personalNumber: 0,
      composite: 0
    },

    parserFailures:
      0,

    bestFailure:
      null
  };


  for (
    const pair of pairs
  ) {
    if (
      !pair ||
      !pair.line1 ||
      !pair.line2
    ) {
      diagnostics.parserFailures +=
        1;

      continue;
    }

    const line1 =
      String(
        pair.line1
      ).replace(
        /\s/g,
        ""
      );

    const line2 =
      String(
        pair.line2
      ).replace(
        /\s/g,
        ""
      );

    if (
      line1.length === 44 &&
      line2.length === 44
    ) {
      diagnostics.lineLengthCandidates +=
        1;
    }

    const result =
      validation.validateMrz({
        line1,
        line2
      });

    if (
      result.success &&
      result.passed &&
      result.data
    ) {
      diagnostics.validCandidates +=
        1;

      continue;
    }

    diagnostics.invalidCandidates +=
      1;

    if (
      result?.data?.checks
    ) {
      const checks =
        result.data.checks;

      for (
        const field of [
          "passportNumber",
          "dateOfBirth",
          "expiryDate",
          "personalNumber",
          "composite"
        ]
      ) {
        if (
          checks[field] ===
          false
        ) {
          diagnostics
            .checkDigitFailures[
              field
            ] += 1;
        }
      }
    } else {
      diagnostics.parserFailures +=
        1;
    }

    if (
      !diagnostics.bestFailure
    ) {
      diagnostics.bestFailure =
        Array.isArray(
          result?.errors
        )
          ? (
              result.errors[0] ||
              null
            )
          : null;
    }
  }

  return diagnostics;
}


function buildMrzFailureIssues(
  ocrResult
) {
  const diagnostics =
    createMrzDiagnostics(
      ocrResult
    );

  const issues = [];

  if (
    !diagnostics.mrzFound
  ) {
    issues.push(
      "A zona MRZ não foi identificada pelo OCR."
    );
  } else {
    issues.push(
      `O OCR encontrou ${diagnostics.candidates} candidato(s) de MRZ.`
    );

    if (
      diagnostics.lineLengthCandidates ===
      0
    ) {
      issues.push(
        "Nenhum candidato apresentou simultaneamente duas linhas MRZ com 44 caracteres."
      );
    }

    if (
      diagnostics.invalidCandidates >
      0
    ) {
      issues.push(
        `${diagnostics.invalidCandidates} candidato(s) falharam na validação MRZ.`
      );
    }

    const failures =
      diagnostics.checkDigitFailures;

    if (
      failures.passportNumber >
      0
    ) {
      issues.push(
        `Check digit do número do passaporte falhou em ${failures.passportNumber} candidato(s).`
      );
    }

    if (
      failures.dateOfBirth >
      0
    ) {
      issues.push(
        `Check digit da data de nascimento falhou em ${failures.dateOfBirth} candidato(s).`
      );
    }

    if (
      failures.expiryDate >
      0
    ) {
      issues.push(
        `Check digit da validade falhou em ${failures.expiryDate} candidato(s).`
      );
    }

    if (
      failures.personalNumber >
      0
    ) {
      issues.push(
        `Check digit do número pessoal falhou em ${failures.personalNumber} candidato(s).`
      );
    }

    if (
      failures.composite >
      0
    ) {
      issues.push(
        `Check digit composto da MRZ falhou em ${failures.composite} candidato(s).`
      );
    }

    if (
      diagnostics.bestFailure
    ) {
      issues.push(
        `Motivo técnico principal: ${diagnostics.bestFailure}`
      );
    }
  }

  if (
    issues.length === 0
  ) {
    issues.push(
      "Nenhum candidato MRZ passou na validação de segurança."
    );
  }

  return {
    diagnostics,
    issues
  };
}


/*
 * =========================================================
 * ENCONTRAR MRZ VÁLIDA
 * =========================================================
 */

function findValidMrz(
  ocrResult,
  {
    visualExpiryDate = null
  } = {}
) {
  const pairs =
    Array.isArray(
      ocrResult?.mrzPairs
    )
      ? ocrResult.mrzPairs
      : [];

  const validCandidates =
    [];

  const invalidCandidates =
    [];


  for (
    const pair of pairs
  ) {
    if (
      !pair ||
      !pair.line1 ||
      !pair.line2
    ) {
      continue;
    }

    const result =
      validation.validateMrz({
        line1:
          pair.line1,

        line2:
          pair.line2
      });

    if (
      result.success &&
      result.passed &&
      result.data
    ) {
      validCandidates.push({
        pair,

        validation:
          result
      });

      continue;
    }


    const expiryFailed =
      result?.data?.checks
        ?.expiryDate === false ||
      (
        Array.isArray(
          result?.errors
        ) &&
        result.errors.some(
          error =>
            /expiry|expir|validade/i.test(
              String(error)
            )
        )
      );


    if (
      visualExpiryDate &&
      expiryFailed
    ) {
      const recovered =
        recoverMrzWithVisualExpiry(
          pair,
          visualExpiryDate
        );

      if (recovered) {
        const recoveredResult =
          validation.validateMrz({
            line1:
              recovered.line1,

            line2:
              recovered.line2
          });

        if (
          recoveredResult.success &&
          recoveredResult.passed &&
          recoveredResult.data
        ) {
          validCandidates.push({
            pair: {
              ...pair,

              line1:
                recovered.line1,

              line2:
                recovered.line2,

              recoverySource:
                "visual_passport_expiry"
            },

            validation:
              recoveredResult
          });

          continue;
        }
      }
    }


    invalidCandidates.push({
      pair,

      validation:
        result
    });
  }


  if (
    validCandidates.length ===
    0
  ) {
    return {
      valid: false,

      candidateCount:
        pairs.length,

      invalidCandidates,

      diagnostics:
        createMrzDiagnostics(
          ocrResult
        ),

      failure:
        buildMrzFailureIssues(
          ocrResult
        )
    };
  }


  validCandidates.sort(
    (a, b) => {
      const scoreA =
        Number(
          a.pair?.score ||
          0
        );

      const scoreB =
        Number(
          b.pair?.score ||
          0
        );

      if (
        scoreB !== scoreA
      ) {
        return (
          scoreB -
          scoreA
        );
      }

      const confidenceA =
        Number(
          a.pair?.confidence ||
          0
        );

      const confidenceB =
        Number(
          b.pair?.confidence ||
          0
        );

      return (
        confidenceB -
        confidenceA
      );
    }
  );


  return {
    valid: true,

    result:
      validCandidates[0],

    candidateCount:
      pairs.length,

    validCandidateCount:
      validCandidates.length,

    diagnostics:
      createMrzDiagnostics(
        ocrResult
      )
  };
}


/*
 * =========================================================
 * CRIAR / ATUALIZAR CLIENTE PELO PASSAPORTE
 * =========================================================
 *
 * REGRA:
 *
 * owner/admin/operator:
 *   account-wide
 *
 * client:
 *   somente os seus próprios perfis.
 *
 * Um colaborador nunca pode assumir um perfil criado
 * por outro colaborador.
 * =========================================================
 */

async function createClientFromPassport(
  {
    accountId,
    createdBy,
    role,
    mrzData,
    passportType,
    visualData
  }
) {
  const passportNumber =
    normalizeText(
      mrzData.passportNumber
    );

  if (
    !passportNumber
  ) {
    throw new Error(
      "Passport number could not be extracted"
    );
  }


  let client =
    await Client.findOne({
      accountId,

      passportNumber,

      active:
        true
    });


  if (
    client &&
    role === "client" &&
    !isSameUserId(
      client.createdBy,
      createdBy
    )
  ) {
    const error =
      new Error(
        "Este passaporte já está associado a outro perfil desta conta."
      );

    error.statusCode =
      409;

    error.code =
      "PASSPORT_OWNED_BY_OTHER_COLLABORATOR";

    throw error;
  }


  const fullName =
    normalizeText(
      mrzData.fullName
    );

  if (
    !fullName
  ) {
    throw new Error(
      "Full name could not be extracted from passport"
    );
  }


  const email =
    createInternalEmail(
      passportNumber
    );

  const gender =
    mapMrzSex(
      mrzData.sex
    );

  const visual =
    visualData ||
    {};

  const passportIssueDate =
    visual.passportIssueDate ||
    null;


  if (!client) {
    client =
      new Client({
        accountId,

        createdBy,

        fullName,

        email,

        phone:
          null,

        dateOfBirth:
          mrzData.dateOfBirth ||
          null,

        nationality:
          mrzData.nationality ||
          null,

        gender,

        passportNumber,

        passportIssueDate,

        passportExpiryDate:
          mrzData.passportExpiryDate ||
          null,

        passportCountry:
          mrzData.issuingCountry ||
          null,

        passportType:
          passportType ||
          "unknown",

        passportValidation: {
          status:
            "pending",

          passportType:
            passportType ||
            "unknown",

          mrzPresent:
            true,

          mrzValid:
            true,

          ocrValid:
            false,

          clientMatch:
            true,

          expired:
            false,

          fingerprint:
            null,

          issues: [],

          checkedAt:
            new Date()
        },

        active:
          true
      });
  } else {
    client.fullName =
      fullName;

    client.dateOfBirth =
      mrzData.dateOfBirth ||
      client.dateOfBirth ||
      null;

    client.nationality =
      mrzData.nationality ||
      client.nationality ||
      null;

    client.gender =
      gender ||
      client.gender ||
      null;

    client.passportNumber =
      passportNumber;

    client.passportExpiryDate =
      mrzData.passportExpiryDate ||
      client.passportExpiryDate ||
      null;

    if (
      passportIssueDate
    ) {
      client.passportIssueDate =
        passportIssueDate;
    }

    client.passportCountry =
      mrzData.issuingCountry ||
      client.passportCountry ||
      null;

    client.passportType =
      passportType ||
      "unknown";
  }


  return client;
}


/*
 * =========================================================
 * IMPORTAÇÃO AUTOMÁTICA
 * =========================================================
 *
 * Agora também disponível para role "client".
 *
 * Um client pode criar vários perfis.
 * =========================================================
 */

router.post(
  "/import",

  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
  ),

  upload.single(
    "passport"
  ),

  async (
    req,
    res,
    next
  ) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Passport image is required"
          });
      }


      const fingerprint =
        createFingerprint(
          req.file.buffer
        );


      /*
       * 1. OCR
       */

      const ocrResult =
        await ocr.extract(
          req.file.buffer
        );


      const visualPassportData =
        extractVisualPassportFields(
          ocrResult.text
        );


      /*
       * 2. MRZ
       */

      const validMrz =
        findValidMrz(
          ocrResult,
          {
            visualExpiryDate:
              visualPassportData
                .passportExpiryDate
          }
        );


      if (
        !validMrz.valid
      ) {
        const failure =
          validMrz.failure ||
          buildMrzFailureIssues(
            ocrResult
          );

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Não foi possível validar o passaporte. Fotografe o documento completo, sem reflexos e com a zona inferior perfeitamente visível.",

            passportValidation:
              buildPassportValidation({
                status:
                  "requires_user",

                passportType:
                  "unknown",

                fingerprint,

                mrzPresent:
                  Boolean(
                    validMrz
                      .diagnostics
                      ?.mrzFound
                  ),

                mrzValid:
                  false,

                ocrValid:
                  Number(
                    ocrResult?.confidence
                  ) >= 70,

                clientMatch:
                  false,

                expired:
                  false,

                issues:
                  failure.issues
              }),

            ocrDiagnostics: {
              candidates:
                validMrz
                  .candidateCount,

              validCandidates:
                0,

              diagnostics:
                failure.diagnostics
            }
          });
      }


      const mrzResult =
        validMrz
          .result
          .validation;

      const mrzData =
        mrzResult.data;


      /*
       * 3. EXPIRAÇÃO
       */

      const expiry =
        validation.validateExpiry(
          mrzData
        );


      if (
        !expiry.passed
      ) {
        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "O passaporte está expirado ou a data de validade não pôde ser confirmada.",

            passportValidation:
              buildPassportValidation({
                status:
                  "requires_user",

                passportType:
                  "unknown",

                fingerprint,

                mrzPresent:
                  true,

                mrzValid:
                  true,

                ocrValid:
                  Number(
                    ocrResult?.confidence
                  ) >= 70,

                clientMatch:
                  false,

                expired:
                  true,

                issues: [
                  expiry.reason ||
                    "Passport expiry validation failed"
                ]
              })
          });
      }


      /*
       * 4. TIPO
       */

      const passportType =
        validation.detectPassportType({
          declaredType:
            null,

          ocrText:
            ocrResult.text,

          documentType:
            mrzData.documentType,

          issuingCountry:
            mrzData.issuingCountry
        });


      /*
       * 5. CRIAR / ATUALIZAR
       */

      let client;

      try {
        client =
          await createClientFromPassport({
            accountId:
              req.user.accountId,

            createdBy:
              req.user._id,

            role:
              req.user.role,

            mrzData,

            passportType:
              passportType.type,

            visualData:
              visualPassportData
          });
      } catch (
        error
      ) {
        if (
          error.code ===
          "PASSPORT_OWNED_BY_OTHER_COLLABORATOR"
        ) {
          return res
            .status(
              error.statusCode ||
              409
            )
            .json({
              success: false,

              status:
                "conflict",

              error:
                error.message
            });
        }

        throw error;
      }


      /*
       * 6. COMPARAR
       */

      const clientComparison =
        validation.compareWithClient(
          mrzData,
          client
        );


      if (
        !clientComparison.passed
      ) {
        client.passportValidation =
          buildPassportValidation({
            status:
              "requires_user",

            passportType:
              passportType.type,

            fingerprint,

            mrzPresent:
              true,

            mrzValid:
              true,

            ocrValid:
              Number(
                ocrResult?.confidence
              ) >= 70,

            clientMatch:
              false,

            expired:
              false,

            issues:
              clientComparison
                .mismatches
                .map(
                  field =>
                    `Client/MRZ mismatch: ${field}`
                )
          });

        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Os dados do passaporte não coincidem com o perfil existente.",

            clientId:
              client._id,

            passportValidation:
              client.passportValidation
          });
      }


      /*
       * 7. VALIDADO
       */

      client.passportType =
        passportType.type;

      client.passportValidation =
        buildPassportValidation({
          status:
            "passed",

          passportType:
            passportType.type,

          fingerprint,

          mrzPresent:
            true,

          mrzValid:
            true,

          ocrValid:
            Number(
              ocrResult?.confidence
            ) >= 70,

          clientMatch:
            true,

          expired:
            false,

          issues: []
        });


      /*
       * 8. GUARDAR DOCUMENTO
       */

      const stored =
        await storage.save({
          accountId:
            req.user.accountId,

          clientId:
            client._id,

          buffer:
            req.file.buffer,

          mimeType:
            req.file.mimetype,

          originalName:
            req.file.originalname,

          validationStatus:
            "passed"
        });


      await client.save();


      /*
       * 9. AUDITORIA
       */

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.passport_import",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip,

        metadata: {
          documentId:
            stored.document._id
              .toString(),

          mimeType:
            req.file.mimetype,

          size:
            req.file.size,

          validation:
            "passed",

          duplicate:
            stored.duplicate,

          fingerprint,

          passportType:
            passportType.type,

          actorRole:
            req.user.role
        }
      });


      /*
       * 10. RESPOSTA
       */

      return res.json({
        success: true,

        status:
          "passed",

        next:
          "facial_preflight",

        clientId:
          client._id,

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

          email:
            client.email,

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
            client.passportCountry,

          passportType:
            client.passportType
        },

        passport: {
          ready:
            true,

          passportType:
            passportType.type,

          mrzValid:
            true,

          clientMatch:
            true,

          expired:
            false,

          documentStored:
            true,

          documentId:
            stored.document._id,

          duplicate:
            stored.duplicate
        },

        passportValidation:
          client.passportValidation,

        ocrDiagnostics: {
          candidates:
            validMrz.candidateCount,

          validCandidates:
            validMrz.validCandidateCount,

          selectedScore:
            Number(
              validMrz
                .result
                ?.pair
                ?.score ||
              0
            ),

          selectedConfidence:
            Number(
              validMrz
                .result
                ?.pair
                ?.confidence ||
              0
            )
        }
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);


/*
 * =========================================================
 * UPLOAD PARA CLIENTE EXISTENTE
 * =========================================================
 */

router.post(
  "/:clientId",

  requireRole(
    "owner",
    "admin",
    "operator",
    "client"
  ),

  upload.single(
    "passport"
  ),

  async (
    req,
    res,
    next
  ) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Passport image is required"
          });
      }


      const client =
        await Client.findOne(
          buildClientScope(
            req,
            req.params.clientId
          )
        );


      if (!client) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "Client not found"
          });
      }


      /*
       * 1. OCR
       */

      const ocrResult =
        await ocr.extract(
          req.file.buffer
        );

      const visualPassportData =
        extractVisualPassportFields(
          ocrResult.text
        );

      const fingerprint =
        createFingerprint(
          req.file.buffer
        );


      /*
       * 2. MRZ
       */

      const validMrz =
        findValidMrz(
          ocrResult,
          {
            visualExpiryDate:
              visualPassportData
                .passportExpiryDate
          }
        );


      if (
        !validMrz.valid
      ) {
        const failure =
          validMrz.failure ||
          buildMrzFailureIssues(
            ocrResult
          );

        client.passportValidation =
          buildPassportValidation({
            status:
              "requires_user",

            passportType:
              "unknown",

            fingerprint,

            mrzPresent:
              Boolean(
                validMrz
                  .diagnostics
                  ?.mrzFound
              ),

            mrzValid:
              false,

            ocrValid:
              Number(
                ocrResult?.confidence
              ) >= 70,

            clientMatch:
              false,

            expired:
              false,

            issues:
              failure.issues
          });

        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "Não foi possível validar o passaporte. Verifique a fotografia e tente novamente.",

            passportValidation:
              client.passportValidation,

            ocrDiagnostics: {
              candidates:
                validMrz.candidateCount,

              validCandidates:
                0,

              diagnostics:
                failure.diagnostics
            }
          });
      }


      const mrzResult =
        validMrz
          .result
          .validation;

      const mrzData =
        mrzResult.data;


      if (
        visualPassportData
          .passportIssueDate
      ) {
        client.passportIssueDate =
          visualPassportData
            .passportIssueDate;
      }


      /*
       * 3. COMPARAR
       */

      const clientComparison =
        validation.compareWithClient(
          mrzData,
          client
        );


      /*
       * 4. EXPIRAÇÃO
       */

      const expiry =
        validation.validateExpiry(
          mrzData
        );


      /*
       * 5. TIPO
       */

      const passportType =
        validation.detectPassportType({
          declaredType:
            client.passportType,

          ocrText:
            ocrResult.text,

          documentType:
            mrzData.documentType,

          issuingCountry:
            mrzData.issuingCountry
        });


      const issues = [
        ...clientComparison
          .mismatches
      ];


      if (
        !expiry.passed
      ) {
        issues.push(
          "Passport expired"
        );
      }


      const passed =
        mrzResult.passed &&
        clientComparison.passed &&
        expiry.passed;


      /*
       * 6. ATUALIZAR
       */

      client.passportType =
        passportType.type;

      client.passportValidation =
        buildPassportValidation({
          status:
            passed
              ? "passed"
              : "requires_user",

          passportType:
            passportType.type,

          fingerprint,

          mrzPresent:
            true,

          mrzValid:
            mrzResult.passed,

          ocrValid:
            Number(
              ocrResult?.confidence
            ) >= 70,

          clientMatch:
            clientComparison.passed,

          expired:
            expiry.expired,

          issues
        });


      if (!passed) {
        await client.save();

        return res
          .status(422)
          .json({
            success: false,

            status:
              "requires_user",

            error:
              "O passaporte precisa de correção antes de poder ser utilizado pelo bot.",

            passportValidation:
              client.passportValidation,

            ocrDiagnostics: {
              candidates:
                validMrz.candidateCount,

              validCandidates:
                validMrz.validCandidateCount
            }
          });
      }


      /*
       * 7. GUARDAR DOCUMENTO
       */

      const stored =
        await storage.save({
          accountId:
            req.user.accountId,

          clientId:
            client._id,

          buffer:
            req.file.buffer,

          mimeType:
            req.file.mimetype,

          originalName:
            req.file.originalname,

          validationStatus:
            "passed"
        });


      await client.save();


      /*
       * 8. AUDITORIA
       */

      await AuditLog.create({
        actorId:
          req.user._id,

        action:
          "client.passport_upload",

        resource:
          "client",

        resourceId:
          client._id.toString(),

        ip:
          req.ip,

        metadata: {
          documentId:
            stored.document._id
              .toString(),

          mimeType:
            req.file.mimetype,

          size:
            req.file.size,

          validation:
            "passed",

          duplicate:
            stored.duplicate,

          fingerprint,

          actorRole:
            req.user.role
        }
      });


      /*
       * 9. RESPOSTA
       */

      return res.json({
        success: true,

        status:
          "passed",

        clientId:
          client._id,

        next:
          "facial_preflight",

        passport: {
          ready:
            true,

          passportType:
            passportType.type,

          mrzValid:
            true,

          clientMatch:
            true,

          expired:
            false,

          documentStored:
            true,

          documentId:
            stored.document._id,

          duplicate:
            stored.duplicate
        },

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

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
            client.passportCountry,

          passportType:
            client.passportType
        },

        passportValidation:
          client.passportValidation,

        ocrDiagnostics: {
          candidates:
            validMrz.candidateCount,

          validCandidates:
            validMrz.validCandidateCount,

          selectedScore:
            Number(
              validMrz
                .result
                ?.pair
                ?.score ||
              0
            ),

          selectedConfidence:
            Number(
              validMrz
                .result
                ?.pair
                ?.confidence ||
              0
            )
        }
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);


/*
 * =========================================================
 * GET PASSPORT STATUS
 * =========================================================
 */

router.get(
  "/:clientId/status",

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
      const client =
        await Client.findOne(
          buildClientScope(
            req,
            req.params.clientId
          )
        );


      if (!client) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "Client not found"
          });
      }


      return res.json({
        success: true,

        clientId:
          client._id,

        client: {
          id:
            client._id,

          fullName:
            client.fullName,

          email:
            client.email,

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
            client.passportCountry,

          passportType:
            client.passportType
        },

        passportValidation:
          client.passportValidation,

        passportType:
          client.passportType,

        facialPreflight:
          client.facialPreflight,

        facialProfile:
          client.facialProfile
      });
    } catch (
      error
    ) {
      next(error);
    }
  }
);


module.exports =
  router;
