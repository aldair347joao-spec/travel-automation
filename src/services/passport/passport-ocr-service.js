const Tesseract = require("tesseract.js");
const sharp = require("sharp");

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

const MRZ_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/*
 * =========================================================
 * CONFIGURAÇÃO
 * =========================================================
 */

const FULL_OCR_PASSES = [
  {
    name: "full_block",
    psm: 6
  },
  {
    name: "full_sparse",
    psm: 11
  },
  {
    name: "full_auto",
    psm: 3
  }
];

const MRZ_OCR_PASSES = [
  {
    name: "mrz_block",
    psm: 6
  },
  {
    name: "mrz_single",
    psm: 7
  },
  {
    name: "mrz_raw",
    psm: 13
  }
];

/*
 * =========================================================
 * CORREÇÕES OCR
 * =========================================================
 *
 * Estas correções são apenas alternativas.
 * A MRZ só será aceite depois dos check digits.
 */

const DIGIT_ALTERNATIVES = {
  O: ["0"],
  Q: ["0"],
  D: ["0"],
  I: ["1"],
  L: ["1"],
  Z: ["2"],
  E: ["3"],
  A: ["4"],
  S: ["5"],
  G: ["6"],
  T: ["7"],
  B: ["8"]
};

const LETTER_ALTERNATIVES = {
  "0": ["O"],
  "1": ["I", "L"],
  "2": ["Z"],
  "3": ["E"],
  "4": ["A"],
  "5": ["S"],
  "6": ["G"],
  "7": ["T"],
  "8": ["B"]
};

/*
 * =========================================================
 * NORMALIZAÇÃO
 * =========================================================
 */

function normalizeOcrLine(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[«»‹›≤≥]/g, "<")
    .replace(/[—–−_]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9< \-]/g, "")
    .trim();
}

function compactMrz(value) {
  return normalizeOcrLine(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "<");
}

function correctDigit(char) {
  const value =
    String(char || "");

  if (/^\d$/.test(value)) {
    return value;
  }

  return (
    DIGIT_ALTERNATIVES[value]?.[0] ||
    value
  );
}

function correctLetter(char) {
  const value =
    String(char || "");

  if (/^[A-Z]$/.test(value)) {
    return value;
  }

  return (
    LETTER_ALTERNATIVES[value]?.[0] ||
    value
  );
}

/*
 * =========================================================
 * NORMALIZAÇÃO MRZ
 * =========================================================
 */

function normalizeFirstMrzLine(value) {
  const line =
    compactMrz(value);

  if (!line) {
    return null;
  }

  const chars =
    line.split("");

  if (chars.length > 0) {
    chars[0] =
      chars[0] === "P"
        ? "P"
        : correctLetter(chars[0]);
  }

  if (chars.length > 1) {
    chars[1] = "<";
  }

  /*
   * País emissor.
   */
  for (
    let i = 2;
    i <= 4 &&
    i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctLetter(chars[i]);
  }

  return chars.join("");
}

function normalizeSecondMrzLine(value) {
  const line =
    compactMrz(value);

  if (!line) {
    return null;
  }

  const chars =
    line.split("");

  /*
   * Check digit do número.
   */
  if (chars.length > 9) {
    chars[9] =
      correctDigit(chars[9]);
  }

  /*
   * Nacionalidade.
   */
  for (
    let i = 10;
    i <= 12 &&
    i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctLetter(chars[i]);
  }

  /*
   * Data nascimento + check digit.
   */
  for (
    let i = 13;
    i <= 19 &&
    i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

  /*
   * Sexo.
   */
  if (chars.length > 20) {
    const value20 =
      correctLetter(chars[20]);

    if (
      value20 === "M" ||
      value20 === "F"
    ) {
      chars[20] =
        value20;
    } else {
      chars[20] = "<";
    }
  }

  /*
   * Validade + check digit.
   */
  for (
    let i = 21;
    i <= 27 &&
    i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

  /*
   * Número pessoal:
   * mantém alfanumérico.
   */

  /*
   * Check digit pessoal + final.
   */
  for (
    let i = 42;
    i <= 43 &&
    i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

  return chars.join("");
}

/*
 * =========================================================
 * SCORE
 * =========================================================
 */

function scoreMrzLine(
  line,
  lineNumber
) {
  if (!line) {
    return -1;
  }

  let score = 0;

  if (line.length === 44) {
    score += 30;
  }

  if (
    /^[A-Z0-9<]+$/.test(line)
  ) {
    score += 8;
  }

  if (lineNumber === 1) {
    if (line[0] === "P") {
      score += 20;
    }

    if (line[1] === "<") {
      score += 10;
    }

    if (
      /^P<[A-Z<]{3}/.test(line)
    ) {
      score += 10;
    }
  }

  if (lineNumber === 2) {
    if (
      /^.{9}\d/.test(line)
    ) {
      score += 5;
    }

    if (
      /^.{10}[A-Z]{3}/.test(line)
    ) {
      score += 5;
    }

    if (
      /^.{20}[MF<]/.test(line)
    ) {
      score += 5;
    }
  }

  if (/<{2,}/.test(line)) {
    score += 3;
  }

  return score;
}

/*
 * =========================================================
 * JANELAS DE 44 CARACTERES
 * =========================================================
 */

function add44Window(
  set,
  value,
  lineNumber
) {
  const compact =
    compactMrz(value);

  if (!compact) {
    return;
  }

  const add = candidate => {
    if (
      !candidate ||
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
      set.add(normalized);
    }

    /*
     * Também guardamos a leitura original.
     */
    set.add(candidate);
  };

  if (compact.length === 44) {
    add(compact);
    return;
  }

  if (
    compact.length > 44 &&
    compact.length <= 100
  ) {
    for (
      let start = 0;
      start <=
        compact.length - 44;
      start += 1
    ) {
      const window =
        compact.slice(
          start,
          start + 44
        );

      if (
        lineNumber === 1 &&
        window[0] !== "P"
      ) {
        continue;
      }

      add(window);
    }
  }
}

/*
 * =========================================================
 * EXTRAÇÃO DE LINHAS
 * =========================================================
 */

function extractLineCandidates(
  text
) {
  const rawLines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  const first =
    new Set();

  const second =
    new Set();

  function process(value) {
    const compact =
      compactMrz(value);

    if (
      compact.length < 40
    ) {
      return;
    }

    /*
     * Linha 1.
     */
    for (
      let start = 0;
      start <=
        compact.length - 44;
      start += 1
    ) {
      const window =
        compact.slice(
          start,
          start + 44
        );

      if (
        window.length !== 44
      ) {
        continue;
      }

      if (
        window[0] === "P"
      ) {
        add44Window(
          first,
          window,
          1
        );
      }
    }

    /*
     * Linha 2.
     */
    for (
      let start = 0;
      start <=
        compact.length - 44;
      start += 1
    ) {
      const window =
        compact.slice(
          start,
          start + 44
        );

      if (
        window.length !== 44
      ) {
        continue;
      }

      add44Window(
        second,
        window,
        2
      );
    }

    /*
     * OCR pode devolver 2 linhas juntas.
     */
    if (
      compact.length >= 80 &&
      compact.length <= 100
    ) {
      for (
        let start = 0;
        start <=
          compact.length - 88;
        start += 1
      ) {
        const pair =
          compact.slice(
            start,
            start + 88
          );

        const line1 =
          pair.slice(0, 44);

        const line2 =
          pair.slice(44, 88);

        if (
          line1[0] === "P"
        ) {
          add44Window(
            first,
            line1,
            1
          );

          add44Window(
            second,
            line2,
            2
          );
        }
      }
    }
  }

  for (
    const line of rawLines
  ) {
    process(line);
  }

  /*
   * Linhas adjacentes.
   */
  for (
    let i = 0;
    i < rawLines.length - 1;
    i += 1
  ) {
    process(
      `${rawLines[i]}${rawLines[i + 1]}`
    );
  }

  return {
    rawLines,
    first: [...first],
    second: [...second]
  };
}

/*
 * =========================================================
 * PARES
 * =========================================================
 */

function buildPairsFromOcrText(
  text,
  source,
  confidence
) {
  const candidates =
    extractLineCandidates(text);

  const pairs = [];

  for (
    const line1 of
      candidates.first
  ) {
    for (
      const line2 of
        candidates.second
    ) {
      pairs.push({
        line1,
        line2,

        source,

        confidence:
          Number.isFinite(
            Number(confidence)
          )
            ? Number(confidence)
            : null,

        score:
          scoreMrzLine(
            line1,
            1
          ) +
          scoreMrzLine(
            line2,
            2
          )
      });
    }
  }

  return {
    candidates,
    pairs
  };
}

/*
 * =========================================================
 * EXPANSÃO INTELIGENTE DE CANDIDATOS
 * =========================================================
 *
 * Aqui está uma das mudanças importantes.
 *
 * O Tesseract pode devolver:
 *
 * O -> onde deveria estar 0
 * 0 -> onde deveria estar O
 * I -> onde deveria estar 1
 *
 * Em vez de escolher cegamente uma correção,
 * geramos alternativas limitadas.
 *
 * Depois o PassportValidationService decide
 * matematicamente qual é válida.
 */

function getAlternativesForPosition(
  chars,
  index,
  lineNumber
) {
  const char =
    chars[index];

  const alternatives =
    new Set([char]);

  if (lineNumber === 2) {
    /*
     * Posições obrigatoriamente numéricas.
     */
    const numeric =
      (
        index === 9 ||
        (
          index >= 13 &&
          index <= 19
        ) ||
        (
          index >= 21 &&
          index <= 27
        ) ||
        index === 42 ||
        index === 43
      );

    if (numeric) {
      if (
        DIGIT_ALTERNATIVES[char]
      ) {
        for (
          const item of
            DIGIT_ALTERNATIVES[char]
        ) {
          alternatives.add(item);
        }
      }

      return [
        ...alternatives
      ];
    }

    /*
     * País/nacionalidade.
     */
    const letter =
      (
        index >= 10 &&
        index <= 12
      );

    if (letter) {
      if (
        LETTER_ALTERNATIVES[char]
      ) {
        for (
          const item of
            LETTER_ALTERNATIVES[char]
        ) {
          alternatives.add(item);
        }
      }

      return [
        ...alternatives
      ];
    }

    /*
     * Sexo.
     */
    if (index === 20) {
      if (
        char === "M" ||
        char === "F" ||
        char === "<"
      ) {
        return [
          char
        ];
      }

      alternatives.add("<");
      return [
        ...alternatives
      ];
    }
  }

  if (lineNumber === 1) {
    if (
      index === 0
    ) {
      alternatives.add("P");
    }

    if (
      index === 1
    ) {
      alternatives.add("<");
    }

    /*
     * País emissor.
     */
    if (
      index >= 2 &&
      index <= 4
    ) {
      if (
        LETTER_ALTERNATIVES[char]
      ) {
        for (
          const item of
            LETTER_ALTERNATIVES[char]
        ) {
          alternatives.add(item);
        }
      }
    }
  }

  return [
    ...alternatives
  ];
}

/*
 * Expande somente posições que apresentam ambiguidade.
 *
 * Limitamos a expansão para evitar explosão combinatória.
 */
function expandMrzLine(
  value,
  lineNumber,
  maxVariants = 256
) {
  const normalized =
    lineNumber === 1
      ? normalizeFirstMrzLine(
          value
        )
      : normalizeSecondMrzLine(
          value
        );

  if (
    !normalized ||
    normalized.length !== 44
  ) {
    return [];
  }

  let variants = [
    normalized
  ];

  for (
    let index = 0;
    index < 44;
    index += 1
  ) {
    const chars =
      variants.map(
        item => item[index]
      );

    const hasAlternative =
      chars.some(char => {
        return (
          (
            lineNumber === 2 &&
            (
              (
                index === 9 ||
                (
                  index >= 13 &&
                  index <= 19
                ) ||
                (
                  index >= 21 &&
                  index <= 27
                ) ||
                index === 42 ||
                index === 43
              )
            ) &&
            DIGIT_ALTERNATIVES[char]
          ) ||
          (
            (
              lineNumber === 1 ||
              (
                index >= 10 &&
                index <= 12
              )
            ) &&
            LETTER_ALTERNATIVES[char]
          )
        );
      });

    if (!hasAlternative) {
      continue;
    }

    const next =
      [];

    for (
      const current of variants
    ) {
      const alternatives =
        getAlternativesForPosition(
          current.split(""),
          index,
          lineNumber
        );

      for (
        const alternative of
          alternatives
      ) {
        const copy =
          current.split("");

        copy[index] =
          alternative;

        next.push(
          copy.join("")
        );

        if (
          next.length >=
          maxVariants
        ) {
          break;
        }
      }

      if (
        next.length >=
        maxVariants
      ) {
        break;
      }
    }

    variants =
      [
        ...new Set(next)
      ];

    if (
      variants.length >=
      maxVariants
    ) {
      variants =
        variants.slice(
          0,
          maxVariants
        );
    }
  }

  return [
    ...new Set(variants)
  ];
}

/*
 * =========================================================
 * PRÉ-PROCESSAMENTO
 * =========================================================
 */

async function createPreprocessedVariants(
  buffer
) {
  const processed =
    await sharp(buffer)
      .rotate()
      .resize({
        width: 2600,
        height: 2600,
        fit: "inside",
        withoutEnlargement: false
      })
      .flatten({
        background: "#ffffff"
      })
      .jpeg({
        quality: 96,
        chromaSubsampling: "4:4:4"
      })
      .toBuffer({
        resolveWithObject: true
      });

  const normalized =
    processed.data;

  const width =
    processed.info.width;

  const height =
    processed.info.height;

  const variants = [
    {
      name: "full",
      buffer: normalized
    }
  ];

  if (
    width &&
    height
  ) {
    /*
     * Aumentamos as opções da MRZ.
     */
    const ratios = [
      0.26,
      0.30,
      0.34,
      0.40,
      0.48
    ];

    for (
      const ratio of ratios
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
          height - cropHeight
        );

      const base =
        sharp(normalized)
          .extract({
            left: 0,
            top,
            width,
            height: cropHeight
          })
          .extend({
            top: 32,
            bottom: 32,
            left: 32,
            right: 32,
            background:
              "#ffffff"
          });

      const color =
        await base
          .clone()
          .sharpen({
            sigma: 1.2
          })
          .jpeg({
            quality: 100,
            chromaSubsampling:
              "4:4:4"
          })
          .toBuffer();

      const gray =
        await base
          .clone()
          .grayscale()
          .normalize()
          .sharpen({
            sigma: 1.4
          })
          .jpeg({
            quality: 100,
            chromaSubsampling:
              "4:4:4"
          })
          .toBuffer();

      const highContrast =
        await base
          .clone()
          .grayscale()
          .linear(
            1.35,
            -35
          )
          .sharpen({
            sigma: 1.3
          })
          .jpeg({
            quality: 100,
            chromaSubsampling:
              "4:4:4"
          })
          .toBuffer();

      variants.push(
        {
          name:
            `mrz_${Math.round(
              ratio * 100
            )}_color`,
          buffer: color
        },
        {
          name:
            `mrz_${Math.round(
              ratio * 100
            )}_gray`,
          buffer: gray
        },
        {
          name:
            `mrz_${Math.round(
              ratio * 100
            )}_contrast`,
          buffer:
            highContrast
        }
      );
    }
  }

  return {
    variants,
    width,
    height
  };
}

/*
 * =========================================================
 * SERVIÇO
 * =========================================================
 */

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
      logger: message => {
        if (this.logger) {
          this.logger({
            ...message,
            ocrPass:
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
        String(pass.psm);
    }

    if (
      pass.whitelist
    ) {
      config.tessedit_char_whitelist =
        pass.whitelist;

      config.load_system_dawg =
        "0";

      config.load_freq_dawg =
        "0";

      config.classify_bln_numeric_mode =
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
      !Buffer.isBuffer(buffer)
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

    let prepared;

    try {
      prepared =
        await createPreprocessedVariants(
          buffer
        );
    } catch (error) {
      if (this.logger) {
        this.logger({
          event:
            "passport_ocr_preprocessing_failed",
          error:
            error.message
        });
      }

      prepared = {
        variants: [
          {
            name:
              "original",
            buffer
          }
        ],
        width: null,
        height: null
      };
    }

    const allResults = [];
    const mrzSources = [];

    /*
     * =====================================================
     * OCR
     * =====================================================
     */

    for (
      const variant of
        prepared.variants
    ) {
      const isFull =
        variant.name ===
          "full" ||
        variant.name ===
          "original";

      const passes =
        isFull
          ? FULL_OCR_PASSES
          : MRZ_OCR_PASSES;

      for (
        const basePass of
          passes
      ) {
        const pass =
          isFull
            ? basePass
            : {
                ...basePass,
                whitelist:
                  MRZ_WHITELIST
              };

        try {
          const result =
            await this.runOcr(
              variant.buffer,
              pass
            );

          const text =
            result?.data?.text ||
            "";

          const confidence =
            Number(
              result?.data
                ?.confidence
            );

          const normalizedConfidence =
            Number.isFinite(
              confidence
            )
              ? confidence
              : null;

          const entry = {
            variant:
              variant.name,

            pass:
              pass.name,

            confidence:
              normalizedConfidence,

            text
          };

          allResults.push(
            entry
          );

          if (!isFull) {
            const extracted =
              buildPairsFromOcrText(
                text,
                `${variant.name}/${pass.name}`,
                normalizedConfidence
              );

            mrzSources.push(
              {
                source:
                  `${variant.name}/${pass.name}`,

                confidence:
                  normalizedConfidence,

                extracted
              }
            );
          }
        } catch (error) {
          if (this.logger) {
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

    /*
     * =====================================================
     * CONSTRUIR CANDIDATOS
     * =====================================================
     */

    const pairs = [];

    for (
      const source of
        mrzSources
    ) {
      for (
        const pair of
          source.extracted
            .pairs
      ) {
        pairs.push(pair);
      }
    }

    /*
     * OCR completo também pode conter a MRZ.
     */
    for (
      const result of
        allResults
    ) {
      if (
        result.variant !==
          "full" &&
        result.variant !==
          "original"
      ) {
        continue;
      }

      const extracted =
        buildPairsFromOcrText(
          result.text,
          `${result.variant}/${result.pass}`,
          result.confidence
        );

      for (
        const pair of
          extracted.pairs
      ) {
        pairs.push(pair);
      }
    }

    /*
     * =====================================================
     * EXPANSÃO
     * =====================================================
     *
     * Cada par original recebe algumas alternativas.
     */
    const expandedPairs = [];

    for (
      const pair of
        pairs
    ) {
      const line1Variants =
        expandMrzLine(
          pair.line1,
          1,
          128
        );

      const line2Variants =
        expandMrzLine(
          pair.line2,
          2,
          256
        );

      const first =
        line1Variants.length
          ? line1Variants
          : [pair.line1];

      const second =
        line2Variants.length
          ? line2Variants
          : [pair.line2];

      /*
       * Não permitimos explosão.
       */
      let count = 0;

      for (
        const line1 of first
      ) {
        for (
          const line2 of second
        ) {
          expandedPairs.push({
            line1,
            line2,

            source:
              pair.source,

            confidence:
              pair.confidence,

            score:
              scoreMrzLine(
                line1,
                1
              ) +
              scoreMrzLine(
                line2,
                2
              ),

            expanded:
              line1 !==
                pair.line1 ||
              line2 !==
                pair.line2
          });

          count += 1;

          if (
            count >= 512
          ) {
            break;
          }
        }

        if (
          count >= 512
        ) {
          break;
        }
      }
    }

    /*
     * =====================================================
     * DEDUPLICAÇÃO
     * =====================================================
     */

    const uniquePairs = [];
    const seen =
      new Set();

    for (
      const pair of
        expandedPairs
    ) {
      const key =
        `${pair.line1}|${pair.line2}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      uniquePairs.push(pair);
    }

    /*
     * Ordenação inicial.
     *
     * A validação final continuará no
     * PassportValidationService.
     */
    uniquePairs.sort(
      (a, b) => {
        const scoreA =
          Number(
            a.score || 0
          );

        const scoreB =
          Number(
            b.score || 0
          );

        if (
          scoreA !==
          scoreB
        ) {
          return (
            scoreB -
            scoreA
          );
        }

        return (
          Number(
            b.confidence || 0
          ) -
          Number(
            a.confidence || 0
          )
        );
      }
    );

    /*
     * =====================================================
     * TEXTO COMPLETO
     * =====================================================
     */

    const fullTexts =
      allResults
        .filter(
          result =>
            result.variant ===
              "full" ||
            result.variant ===
              "original"
        )
        .map(
          result =>
            result.text
        )
        .filter(Boolean);

    const fullText =
      fullTexts.join(
        "\n"
      );

    const confidenceValues =
      allResults
        .map(
          result =>
            Number(
              result.confidence
            )
        )
        .filter(
          value =>
            Number.isFinite(
              value
            )
        );

    const confidence =
      confidenceValues.length
        ? Math.max(
            ...confidenceValues
          )
        : null;

    return {
      text:
        fullText,

      confidence,

      lines:
        fullText
          .split(/\r?\n/)
          .map(
            normalizeOcrLine
          )
          .filter(Boolean),

      mrzCandidates:
        uniquePairs.flatMap(
          pair => [
            pair.line1,
            pair.line2
          ]
        ),

      mrzPairs:
        uniquePairs,

      diagnostics: {
        ocrPasses:
          allResults.length,

        preprocessingVariants:
          prepared.variants.length,

        mrzSources:
          mrzSources.length,

        rawMrzPairs:
          pairs.length,

        expandedMrzPairs:
          expandedPairs.length,

        mrzCandidatePairs:
          uniquePairs.length,

        imageWidth:
          prepared.width,

        imageHeight:
          prepared.height,

        fullOcrResults:
          fullTexts.length,

        confidence
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
                bestPair.score,

              source:
                bestPair.source,

              confidence:
                bestPair.confidence,

              expanded:
                Boolean(
                  bestPair.expanded
                )
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
  text =>
    buildPairsFromOcrText(
      text,
      "external",
      null
    );

module.exports.normalizeTo44 =
  (
    value,
    lineNumber
  ) => {
    const set =
      new Set();

    add44Window(
      set,
      value,
      lineNumber
    );

    return [
      ...set
    ];
  };

module.exports.normalizeFirstMrzLine =
  normalizeFirstMrzLine;

module.exports.normalizeSecondMrzLine =
  normalizeSecondMrzLine;

module.exports.expandMrzLine =
  expandMrzLine;
