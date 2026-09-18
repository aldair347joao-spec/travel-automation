const Tesseract = require("tesseract.js");
const sharp = require("sharp");

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
  }
];

const MRZ_OCR_PASSES = [
  {
    name: "mrz_block",
    psm: 6,
    whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
  },
  {
    name: "mrz_sparse",
    psm: 11,
    whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
  },
  {
    name: "mrz_line",
    psm: 13,
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
 * Correções utilizadas somente quando a estrutura
 * da MRZ permite determinar o tipo esperado.
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
 * Linha 1 TD3:
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
    normalized.split("");

  if (chars.length >= 1) {
    chars[0] =
      chars[0] === "P"
        ? "P"
        : correctLetterCharacter(
            chars[0]
          );
  }

  if (chars.length >= 2) {
    chars[1] = "<";
  }

  /*
   * País emissor.
   */
  for (
    let index = 2;
    index <= 4 &&
    index < chars.length;
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
 * Linha 2 TD3:
 *
 * 0-8   número do passaporte
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
    normalized.split("");

  /*
   * Check digit do número do passaporte.
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
    index <= 12 &&
    index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctLetterCharacter(
        chars[index]
      );
  }

  /*
   * Data de nascimento + check digit.
   */
  for (
    let index = 13;
    index <= 19 &&
    index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigitCharacter(
        chars[index]
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
   * Data de validade + check digit.
   */
  for (
    let index = 21;
    index <= 27 &&
    index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigitCharacter(
        chars[index]
      );
  }

  /*
   * Número pessoal:
   * permanece alfanumérico.
   */

  /*
   * Check digit pessoal + check final.
   */
  for (
    let index = 42;
    index <= 43 &&
    index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigitCharacter(
        chars[index]
      );
  }

  return chars.join("");
}

function generateMrzVariants(
  line,
  lineNumber
) {
  const normalized =
    compactMrzCandidate(line);

  if (!normalized) {
    return [];
  }

  const variants =
    new Set();

  variants.add(
    normalized
  );

  if (lineNumber === 1) {
    const corrected =
      normalizeFirstMrzLine(
        normalized
      );

    if (corrected) {
      variants.add(
        corrected
      );
    }
  }

  if (lineNumber === 2) {
    const corrected =
      normalizeSecondMrzLine(
        normalized
      );

    if (corrected) {
      variants.add(
        corrected
      );
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
    ...new Set(
      candidates
    )
  ].sort(
    (a, b) =>
      scoreMrzCandidate(b) -
      scoreMrzCandidate(a)
  );
}

/*
 * Produz possíveis linhas de exatamente 44 caracteres.
 *
 * Não aceitamos cortes arbitrários.
 * Quando o OCR produzir uma linha um pouco maior,
 * testamos apenas pequenas janelas.
 */
function normalizeTo44Variants(
  value,
  lineNumber
) {
  const line =
    compactMrzCandidate(
      value
    );

  if (!line) {
    return [];
  }

  const variants =
    new Set();

  const addVariant =
    candidate => {
      if (
        candidate.length !== 44
      ) {
        return;
      }

      const normalized =
        lineNumber === 1
          ? normalizeFirstMrzLine(
              candidate
            )
          : normalizeSecondMrzLine(
              candidate
            );

      if (
        normalized &&
        normalized.length === 44
      ) {
        variants.add(
          normalized
        );
      }

      variants.add(
        candidate
      );
    };

  if (
    line.length === 44
  ) {
    addVariant(
      line
    );
  }

  /*
   * Permite pequenos caracteres extras
   * produzidos pelo OCR.
   */
  if (
    line.length > 44 &&
    line.length <= 48
  ) {
    for (
      let start = 0;
      start <= line.length - 44;
      start += 1
    ) {
      const window =
        line.slice(
          start,
          start + 44
        );

      if (
        lineNumber === 1 &&
        !window.startsWith("P")
      ) {
        continue;
      }

      addVariant(
        window
      );
    }
  }

  return [
    ...variants
  ];
}

function buildMrzPairs(
  candidates
) {
  const firstLines =
    new Set();

  const secondLines =
    new Set();

  for (
    const candidate of candidates
  ) {
    const lineNumber =
      candidate.startsWith("P")
        ? 1
        : 2;

    const variants =
      normalizeTo44Variants(
        candidate,
        lineNumber
      );

    for (
      const line of variants
    ) {
      if (
        line.startsWith("P")
      ) {
        firstLines.add(
          line
        );
      } else {
        secondLines.add(
          line
        );
      }
    }
  }

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
    candidates: [
      ...firstLines,
      ...secondLines
    ],

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
    rawLines:
      lines,

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
        result?.data?.text ||
        ""
    )
    .filter(Boolean)
    .join("\n");
}

/*
 * Cria versões derivadas exclusivamente para OCR.
 *
 * IMPORTANTE:
 * buffer continua sendo o arquivo original.
 * Nenhuma dessas transformações substitui o arquivo
 * enviado pelo cliente.
 */
async function createOcrVariants(
  buffer,
  logger
) {
  const base =
    sharp(buffer)
      .rotate()
      .resize({
        width: 2400,
        withoutEnlargement: false,
        fit: "inside"
      })
      .flatten({
        background: "#ffffff"
      });

  const normalizedResult =
    await base
      .jpeg({
        quality: 92,
        chromaSubsampling: "4:4:4"
      })
      .toBuffer({
        resolveWithObject: true
      });

  const normalized =
    normalizedResult.data;

  const info =
    normalizedResult.info;

  const variants = [
    {
      name: "full",
      buffer:
        normalized
    }
  ];

  const width =
    info.width;

  const height =
    info.height;

  if (
    width > 0 &&
    height > 0
  ) {
    /*
     * Como a MRZ fica na parte inferior,
     * usamos mais de um recorte.
     *
     * Isto evita depender de uma posição
     * única da fotografia.
     */
    const cropRatios = [
      0.42,
      0.50
    ];

    for (
      const ratio of cropRatios
    ) {
      const cropHeight =
        Math.max(
          1,
          Math.floor(
            height * ratio
          )
        );

      const top =
        Math.max(
          0,
          height -
            cropHeight
        );

      const cropBase =
        sharp(
          normalized
        )
          .extract({
            left: 0,
            top,
            width,
            height:
              cropHeight
          })
          .extend({
            top: 18,
            bottom: 18,
            left: 18,
            right: 18,
            background:
              "#ffffff"
          });

      /*
       * Versão colorida/nítida.
       */
      const colorMrz =
        await cropBase
          .clone()
          .sharpen()
          .jpeg({
            quality: 96,
            chromaSubsampling:
              "4:4:4"
          })
          .toBuffer();

      /*
       * Versão em escala de cinza,
       * normalizada e mais nítida.
       */
      const grayMrz =
        await cropBase
          .clone()
          .grayscale()
          .normalize()
          .sharpen()
          .jpeg({
            quality: 96,
            chromaSubsampling:
              "4:4:4"
          })
          .toBuffer();

      variants.push(
        {
          name:
            `mrz_crop_${Math.round(
              ratio * 100
            )}`,

          buffer:
            colorMrz
        },

        {
          name:
            `mrz_gray_${Math.round(
              ratio * 100
            )}`,

          buffer:
            grayMrz
        }
      );
    }
  }

  if (
    logger
  ) {
    logger({
      event:
        "passport_ocr_preprocessing",

      width,

      height,

      variants:
        variants.length
    });
  }

  return variants;
}

class PassportOcrService {
  constructor(
    options = {}
  ) {
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
      logger:
        message => {
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

    if (
      Number.isInteger(
        pass.psm
      )
    ) {
      config.tessedit_pageseg_mode =
        String(
          pass.psm
        );
    }

    if (
      pass.whitelist
    ) {
      config.tessedit_char_whitelist =
        pass.whitelist;

      /*
       * Reduz influência dos dicionários
       * normais do Tesseract na MRZ.
       */
      config.load_system_dawg =
        "0";

      config.load_freq_dawg =
        "0";
    }

    return Tesseract.recognize(
      buffer,
      this.language,
      config
    );
  }

  async recognize(
    buffer
  ) {
    if (
      !Buffer.isBuffer(
        buffer
      )
    ) {
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

    let variants;

    try {
      variants =
        await createOcrVariants(
          buffer,
          this.logger
        );
    } catch (
      error
    ) {
      /*
       * Se o processamento falhar,
       * não bloqueamos o OCR original.
       */
      if (
        this.logger
      ) {
        this.logger({
          event:
            "passport_ocr_preprocessing_failed",

          error:
            error.message
        });
      }

      variants = [
        {
          name:
            "original",

          buffer
        }
      ];
    }

    const results =
      [];

    for (
      const variant of variants
    ) {
      /*
       * A imagem completa usa OCR normal.
       *
       * Os recortes usam OCR especializado
       * na MRZ.
       */
      const passes =
        variant.name ===
          "full"
          ? OCR_PASSES
          : MRZ_OCR_PASSES;

      for (
        const pass of passes
      ) {
        try {
          const result =
            await this.runOcr(
              variant.buffer,
              {
                ...pass,

                name:
                  `${variant.name}_${pass.name}`
              }
            );

          results.push({
            ...result,

            variant:
              variant.name,

            pass:
              pass.name
          });
        } catch (
          error
        ) {
          if (
            this.logger
          ) {
            this.logger({
              event:
                "passport_ocr_pass_failed",

              variant:
                variant.name,

              pass:
                pass.name,

              error:
                error.message
            });
          }
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
        mrz.pairs,

      diagnostics: {
        ocrPasses:
          results.length,

        preprocessingVariants:
          variants.length
      }
    };
  }

  async extract(
    buffer
  ) {
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
  normalizeTo44Variants;

module.exports.normalizeFirstMrzLine =
  normalizeFirstMrzLine;

module.exports.normalizeSecondMrzLine =
  normalizeSecondMrzLine;
