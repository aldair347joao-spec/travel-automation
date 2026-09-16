const Tesseract = require("tesseract.js");

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

const OCR_PASSES = [
  {
    name: "standard",
    psm: 6
  },
  {
    name: "sparse",
    psm: 11
  },
  {
    name: "mrz",
    psm: 6,
    whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
  }
];

function normalizeOcrLine(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[«»‹›≤≥]/g, "<")
    .replace(/[—–−_]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9< ]/g, "")
    .trim();
}

function compactMrzCandidate(value) {
  return normalizeOcrLine(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "<");
}

function scoreMrzCandidate(line) {
  if (!line) {
    return -1;
  }

  let score = 0;

  if (line.length >= 40) {
    score += 2;
  }

  if (line.length >= 44) {
    score += 4;
  }

  if (line.length === 44) {
    score += 5;
  }

  if (line[0] === "P") {
    score += 8;
  }

  if (line[1] === "<") {
    score += 4;
  }

  if (/^[A-Z0-9<]+$/.test(line)) {
    score += 2;
  }

  if (/[0-9]/.test(line)) {
    score += 1;
  }

  if (/<{2,}/.test(line)) {
    score += 1;
  }

  return score;
}

/*
 * OCR pode trocar caracteres alfabéticos por números
 * e vice-versa.
 *
 * Estas conversões só são utilizadas quando a posição
 * da MRZ determina que o carácter deveria pertencer
 * ao conjunto correspondente.
 */
const DIGIT_CORRECTIONS = {
  O: "0",
  Q: "0",
  D: "0",

  I: "1",
  L: "1",

  Z: "2",

  E: "3",

  A: "4",

  S: "5",

  G: "6",

  T: "7",

  B: "8"
};

const LETTER_CORRECTIONS = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "3": "E",
  "4": "A",
  "5": "S",
  "6": "G",
  "7": "T",
  "8": "B"
};

function correctDigitCharacter(char) {
  const value = String(char || "");

  if (/^\d$/.test(value)) {
    return value;
  }

  return DIGIT_CORRECTIONS[value] || value;
}

function correctLetterCharacter(char) {
  const value = String(char || "");

  if (/^[A-Z]$/.test(value)) {
    return value;
  }

  return LETTER_CORRECTIONS[value] || value;
}

/*
 * Corrige a linha 1 do TD3 apenas nos campos
 * onde o tipo do carácter é conhecido.
 *
 * P<XXX...
 */
function normalizeFirstMrzLine(line) {
  const normalized =
    compactMrzCandidate(line);

  if (!normalized) {
    return null;
  }

  const chars =
    normalized
      .split("");

  if (chars.length >= 1) {
    chars[0] =
      chars[0] === "P"
        ? "P"
        : correctLetterCharacter(chars[0]);
  }

  if (chars.length >= 2) {
    if (
      chars[1] !== "<"
    ) {
      chars[1] = "<";
    }
  }

  /*
   * ISO issuing country:
   * posições 2, 3 e 4.
   */
  for (
    let index = 2;
    index <= 4 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctLetterCharacter(
        chars[index]
      );
  }

  return chars.join("");
}

/*
 * Corrige a linha 2 usando a estrutura TD3:
 *
 * 0-8   número
 * 9     check digit
 * 10-12 nacionalidade
 * 13-18 nascimento
 * 19    check digit
 * 20    sexo
 * 21-26 validade
 * 27    check digit
 * 28-41 número pessoal
 * 42    check digit
 * 43    check final
 */
function normalizeSecondMrzLine(line) {
  const normalized =
    compactMrzCandidate(line);

  if (!normalized) {
    return null;
  }

  const chars =
    normalized
      .split("");

  /*
   * Número do passaporte:
   * alfanumérico. Não fazemos conversão agressiva.
   */
  for (
    let index = 0;
    index <= 8 && index < chars.length;
    index += 1
  ) {
    if (
      chars[index] === " "
    ) {
      chars[index] = "<";
    }
  }

  /*
   * Check digit do número.
   */
  if (chars.length > 9) {
    chars[9] =
      correctDigitCharacter(
        chars[9]
      );
  }

  /*
   * Nacionalidade.
   */
  for (
    let index = 10;
    index <= 12 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctLetterCharacter(
        chars[index]
      );
  }

  /*
   * Data de nascimento.
   */
  for (
    let index = 13;
    index <= 18 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigitCharacter(
        chars[index]
      );
  }

  /*
   * Check digit nascimento.
   */
  if (chars.length > 19) {
    chars[19] =
      correctDigitCharacter(
        chars[19]
      );
  }

  /*
   * Sexo.
   */
  if (chars.length > 20) {
    chars[20] =
      correctLetterCharacter(
        chars[20]
      );

    if (
      !["M", "F", "<"].includes(
        chars[20]
      )
    ) {
      chars[20] = "<";
    }
  }

  /*
   * Data de validade.
   */
  for (
    let index = 21;
    index <= 26 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigitCharacter(
        chars[index]
      );
  }

  /*
   * Check digit validade.
   */
  if (chars.length > 27) {
    chars[27] =
      correctDigitCharacter(
        chars[27]
      );
  }

  /*
   * Número pessoal.
   *
   * É alfanumérico, portanto não fazemos
   * substituição agressiva aqui.
   */
  for (
    let index = 28;
    index <= 41 && index < chars.length;
    index += 1
  ) {
    if (
      chars[index] === " "
    ) {
      chars[index] = "<";
    }
  }

  /*
   * Check digit número pessoal.
   */
  if (chars.length > 42) {
    chars[42] =
      correctDigitCharacter(
        chars[42]
      );
  }

  /*
   * Check digit final.
   */
  if (chars.length > 43) {
    chars[43] =
      correctDigitCharacter(
        chars[43]
      );
  }

  return chars.join("");
}

/*
 * Gera uma pequena família de candidatos.
 *
 * Importante:
 * não criamos combinações exponenciais.
 * O objetivo é corrigir apenas os erros
 * mais comuns do OCR.
 */
function generateMrzVariants(line, lineNumber) {
  const normalized =
    compactMrzCandidate(line);

  if (!normalized) {
    return [];
  }

  const variants = new Set();

  variants.add(normalized);

  if (lineNumber === 1) {
    const corrected =
      normalizeFirstMrzLine(
        normalized
      );

    if (corrected) {
      variants.add(corrected);
    }
  }

  if (lineNumber === 2) {
    const corrected =
      normalizeSecondMrzLine(
        normalized
      );

    if (corrected) {
      variants.add(corrected);
    }
  }

  return [
    ...variants
  ];
}

function generateCandidates(text) {
  const rawLines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  const candidates =
    [];

  /*
   * Linhas individuais.
   */
  for (
    const line of rawLines
  ) {
    const compact =
      compactMrzCandidate(
        line
      );

    if (
      compact.length >= 40
    ) {
      candidates.push(
        compact
      );
    }
  }

  /*
   * Duas linhas juntas.
   */
  for (
    let i = 0;
    i < rawLines.length - 1;
    i += 1
  ) {
    const joined =
      compactMrzCandidate(
        `${rawLines[i]} ${rawLines[i + 1]}`
      );

    if (
      joined.length >= 40
    ) {
      candidates.push(
        joined
      );
    }
  }

  /*
   * Três linhas juntas.
   *
   * Algumas fotografias fazem o OCR quebrar
   * uma MRZ em três segmentos.
   */
  for (
    let i = 0;
    i < rawLines.length - 2;
    i += 1
  ) {
    const joined =
      compactMrzCandidate(
        `${rawLines[i]} ${rawLines[i + 1]} ${rawLines[i + 2]}`
      );

    if (
      joined.length >= 40
    ) {
      candidates.push(
        joined
      );
    }
  }

  return [
    ...new Set(candidates)
  ].sort(
    (a, b) =>
      scoreMrzCandidate(b) -
      scoreMrzCandidate(a)
  );
}

function normalizeTo44(value) {
  if (!value) {
    return null;
  }

  const line =
    compactMrzCandidate(
      value
    );

  if (
    line.length === 44
  ) {
    return line;
  }

  /*
   * OCR pode adicionar alguns caracteres
   * no início/fim.
   *
   * Só aceitamos uma diferença pequena.
   */
  if (
    line.length > 44 &&
    line.length <= 48
  ) {
    const firstP =
      line.indexOf("P");

    if (
      firstP >= 0 &&
      firstP <= 3
    ) {
      const trimmed =
        line.slice(
          firstP,
          firstP + 44
        );

      if (
        trimmed.length === 44
      ) {
        return trimmed;
      }
    }
  }

  return null;
}

function buildMrzPairs(
  candidates
) {
  const normalized =
    candidates
      .map(normalizeTo44)
      .filter(Boolean);

  const unique =
    [
      ...new Set(
        normalized
      )
    ];

  const firstLines =
    unique.filter(
      line =>
        line.startsWith("P")
    );

  const secondLines =
    unique.filter(
      line =>
        !line.startsWith("P")
    );

  const pairs =
    [];

  for (
    const line1 of firstLines
  ) {
    for (
      const line2 of secondLines
    ) {
      pairs.push({
        line1,
        line2,

        score:
          scoreMrzCandidate(
            line1
          ) +
          scoreMrzCandidate(
            line2
          )
      });
    }
  }

  pairs.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return {
    candidates: unique,
    pairs
  };
}

function findMrzLines(text) {
  const baseCandidates =
    generateCandidates(
      text
    );

  const expanded =
    [];

  for (
    const candidate of baseCandidates
  ) {
    expanded.push(
      ...generateMrzVariants(
        candidate,
        candidate.startsWith("P")
          ? 1
          : 2
      )
    );
  }

  return buildMrzPairs(
    [
      ...baseCandidates,
      ...expanded
    ]
  );
}

function extractOcrFields(text) {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  return {
    rawLines: lines,

    text:
      lines.join(" ")
  };
}

function mergeOcrTexts(
  results
) {
  return results
    .map(
      result =>
        result?.data?.text || ""
    )
    .filter(Boolean)
    .join("\n");
}

class PassportOcrService {
  constructor(options = {}) {
    this.language =
      options.language ||
      DEFAULT_LANGUAGE;

    this.logger =
      options.logger ||
      null;
  }

  async runOcr(
    buffer,
    pass
  ) {
    const config = {
      logger: message => {
        if (
          this.logger
        ) {
          this.logger({
            ...message,
            pass:
              pass.name
          });
        }
      }
    };

    /*
     * Tesseract.js aceita estas opções
     * como parâmetros de configuração.
     *
     * A whitelist é utilizada apenas
     * na passagem específica da MRZ.
     */
    if (
      Number.isInteger(
        pass.psm
      )
    ) {
      config.tessedit_pageseg_mode =
        String(pass.psm);
    }

    if (
      pass.whitelist
    ) {
      config.tessedit_char_whitelist =
        pass.whitelist;
    }

    return Tesseract.recognize(
      buffer,
      this.language,
      config
    );
  }

  async recognize(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(
        "Passport image must be provided as a Buffer"
      );
    }

    if (
      buffer.length === 0
    ) {
      throw new Error(
        "Passport image is empty"
      );
    }

    if (
      buffer.length >
      MAX_IMAGE_BYTES
    ) {
      throw new Error(
        "Passport image exceeds the 8 MB limit"
      );
    }

    const results =
      [];

    for (
      const pass of OCR_PASSES
    ) {
      try {
        const result =
          await this.runOcr(
            buffer,
            pass
          );

        results.push(
          result
        );
      } catch (error) {
        /*
         * Uma passagem que falhe não invalida
         * as outras.
         */
        if (
          this.logger
        ) {
          this.logger({
            event:
              "passport_ocr_pass_failed",
            pass:
              pass.name,
            error:
              error.message
          });
        }
      }
    }

    if (
      results.length === 0
    ) {
      throw new Error(
        "Passport OCR failed"
      );
    }

    const text =
      mergeOcrTexts(
        results
      );

    const confidences =
      results
        .map(
          result =>
            Number(
              result?.data?.confidence
            )
        )
        .filter(
          value =>
            Number.isFinite(
              value
            )
        );

    const confidence =
      confidences.length > 0
        ? Math.max(
            ...confidences
          )
        : null;

    const fields =
      extractOcrFields(
        text
      );

    const mrz =
      findMrzLines(
        text
      );

    return {
      text,

      confidence,

      lines:
        fields.rawLines,

      mrzCandidates:
        mrz.candidates,

      mrzPairs:
        mrz.pairs
    };
  }

  async extract(buffer) {
    const result =
      await this.recognize(
        buffer
      );

    const bestPair =
      result.mrzPairs[0] ||
      null;

    return {
      ...result,

      mrz:
        bestPair
          ? {
              line1:
                bestPair.line1,

              line2:
                bestPair.line2,

              score:
                bestPair.score
            }
          : null
    };
  }
}

module.exports =
  PassportOcrService;

module.exports.MAX_IMAGE_BYTES =
  MAX_IMAGE_BYTES;

module.exports.findMrzLines =
  findMrzLines;

module.exports.normalizeTo44 =
  normalizeTo44;

module.exports.normalizeFirstMrzLine =
  normalizeFirstMrzLine;

module.exports.normalizeSecondMrzLine =
  normalizeSecondMrzLine;
