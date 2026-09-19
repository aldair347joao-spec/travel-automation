const Tesseract = require("tesseract.js");
const sharp = require("sharp");

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

const MRZ_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

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
 * São alternativas de OCR.
 * Nenhuma delas torna uma MRZ automaticamente válida.
 *
 * A validação final continua sendo feita pelo
 * PassportValidationService através dos check digits.
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
 * NORMALIZAÇÃO OCR
 * =========================================================
 */

function normalizeOcrLine(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[«»‹›≤≥]/g, "<")
    .replace(/[|]/g, "I")
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

  if (
    /^\d$/.test(value)
  ) {
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

  if (
    /^[A-Z]$/.test(value)
  ) {
    return value;
  }

  return (
    LETTER_ALTERNATIVES[value]?.[0] ||
    value
  );
}

/*
 * =========================================================
 * NORMALIZAÇÃO DA PRIMEIRA LINHA TD3
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

  /*
   * Posição 0:
   * normalmente P.
   */
  if (chars.length > 0) {
    chars[0] =
      chars[0] === "P"
        ? "P"
        : correctLetter(chars[0]);
  }

  /*
   * Posição 1:
   * no passaporte TD3 deve ser <.
   *
   * Isto corrige exatamente o caso observado
   * nesta fotografia:
   *
   * PNAGO...
   *
   * -> P<AGO...
   */
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

/*
 * =========================================================
 * NORMALIZAÇÃO DA SEGUNDA LINHA TD3
 * =========================================================
 */

function normalizeSecondMrzLine(value) {
  const line =
    compactMrz(value);

  if (!line) {
    return null;
  }

  const chars =
    line.split("");

  /*
   * Check digit do número do passaporte.
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
   * Data de nascimento + check digit.
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
    const sex =
      correctLetter(chars[20]);

    if (
      sex === "M" ||
      sex === "F"
    ) {
      chars[20] = sex;
    } else {
      chars[20] = "<";
    }
  }

  /*
   * Data de validade + check digit.
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
   * O número pessoal é alfanumérico.
   *
   * Não fazemos conversão cega neste bloco.
   */

  /*
   * Check digit do número pessoal + check final.
   */
  if (chars.length > 42) {
    chars[42] =
      correctDigit(chars[42]);
  }

  if (chars.length > 43) {
    chars[43] =
      correctDigit(chars[43]);
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

  if (
    line.length === 44
  ) {
    score += 30;
  }

  if (
    /^[A-Z0-9<]+$/.test(line)
  ) {
    score += 8;
  }

  if (
    lineNumber === 1
  ) {
    if (
      line[0] === "P"
    ) {
      score += 20;
    }

    if (
      line[1] === "<"
    ) {
      score += 10;
    }

    if (
      /^P<[A-Z<]{3}/.test(line)
    ) {
      score += 10;
    }
  }

  if (
    lineNumber === 2
  ) {
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

  if (
    /<{2,}/.test(line)
  ) {
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
     * Mantemos também a leitura original.
     */
    set.add(candidate);
  };

  if (
    compact.length === 44
  ) {
    add(compact);
    return;
  }

  /*
   * Se o OCR colocou caracteres extras,
   * tentamos todas as janelas possíveis.
   */
  if (
    compact.length > 44 &&
    compact.length <= 120
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

      if (
        lineNumber === 2 &&
        !/^[A-Z0-9<]{44}$/.test(
          window
        )
      ) {
        continue;
      }

      add(window);
    }
  }
}

/*
 * =========================================================
 * CANDIDATOS DE UMA LINHA
 * =========================================================
 */

function addLikelyLineCandidates(
  set,
  value,
  lineNumber
) {
  const compact =
    compactMrz(value);

  if (!compact) {
    return;
  }

  /*
   * Para a primeira linha procuramos
   * explicitamente o P.
   */
  if (
    lineNumber === 1
  ) {
    const p =
      compact.indexOf("P");

    if (p >= 0) {
      add44Window(
        set,
        compact.slice(p),
        1
      );
    }
  }

  /*
   * Tentativa direta.
   */
  add44Window(
    set,
    compact,
    lineNumber
  );
}

/*
 * =========================================================
 * EXTRAÇÃO ROBUSTA DA MRZ
 * =========================================================
 *
 * Não dependemos mais exclusivamente da forma
 * como o Tesseract separou as linhas.
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

  /*
   * =====================================================
   * 1. LINHAS INDIVIDUAIS
   * =====================================================
   */

  for (
    const line of rawLines
  ) {
    addLikelyLineCandidates(
      first,
      line,
      1
    );

    addLikelyLineCandidates(
      second,
      line,
      2
    );
  }

  /*
   * =====================================================
   * 2. LINHAS ADJACENTES
   * =====================================================
   */

  for (
    let i = 0;
    i <
      rawLines.length - 1;
    i += 1
  ) {
    const joined =
      `${rawLines[i]}${rawLines[i + 1]}`;

    const compact =
      compactMrz(joined);

    addLikelyLineCandidates(
      first,
      rawLines[i],
      1
    );

    addLikelyLineCandidates(
      second,
      rawLines[i + 1],
      2
    );

    /*
     * Procurar a primeira ocorrência
     * de P e separar duas linhas de 44.
     */
    const p =
      compact.indexOf("P");

    if (
      p >= 0
    ) {
      const tail =
        compact.slice(p);

      if (
        tail.length >= 88
      ) {
        add44Window(
          first,
          tail.slice(0, 44),
          1
        );

        add44Window(
          second,
          tail.slice(44),
          2
        );
      }
    }

    /*
     * OCR pode devolver as duas linhas
     * juntas com texto adicional.
     */
    if (
      compact.length >= 88 &&
      compact.length <= 120
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

        if (
          pair[0] !== "P"
        ) {
          continue;
        }

        add44Window(
          first,
          pair.slice(0, 44),
          1
        );

        add44Window(
          second,
          pair.slice(44),
          2
        );
      }
    }
  }

  /*
   * =====================================================
   * 3. TEXTO COMPLETO
   * =====================================================
   *
   * Isto cobre o caso em que o Tesseract
   * praticamente destruiu as quebras de linha.
   */

  const whole =
    compactMrz(text);

  const p =
    whole.indexOf("P");

  if (
    p >= 0
  ) {
    const tail =
      whole.slice(p);

    if (
      tail.length >= 88
    ) {
      add44Window(
        first,
        tail.slice(0, 44),
        1
      );

      add44Window(
        second,
        tail.slice(44),
        2
      );
    }

    if (
      tail.length >= 88 &&
      tail.length <= 140
    ) {
      for (
        let start = 0;
        start <=
          tail.length - 88;
        start += 1
      ) {
        const pair =
          tail.slice(
            start,
            start + 88
          );

        if (
          pair[0] !== "P"
        ) {
          continue;
        }

        add44Window(
          first,
          pair.slice(0, 44),
          1
        );

        add44Window(
          second,
          pair.slice(44),
          2
        );
      }
    }
  }

  return {
    rawLines,

    first:
      [...first],

    second:
      [...second]
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
    extractLineCandidates(
      text
    );

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
 * EXPANSÃO INTELIGENTE
 * =========================================================
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

  if (
    lineNumber === 2
  ) {
    /*
     * Posições obrigatoriamente numéricas.
     */
    const numeric =
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
      index === 43;

    if (
      numeric
    ) {
      for (
        const item of
          DIGIT_ALTERNATIVES[
            char
          ] || []
      ) {
        alternatives.add(
          item
        );
      }

      return [
        ...alternatives
      ];
    }

    /*
     * Nacionalidade.
     */
    if (
      index >= 10 &&
      index <= 12
    ) {
      for (
        const item of
          LETTER_ALTERNATIVES[
            char
          ] || []
      ) {
        alternatives.add(
          item
        );
      }

      return [
        ...alternatives
      ];
    }

    /*
     * Sexo.
     */
    if (
      index === 20
    ) {
      if (
        char === "M" ||
        char === "F" ||
        char === "<"
      ) {
        return [
          char
        ];
      }

      alternatives.add(
        "<"
      );

      alternatives.add(
        "F"
      );

      alternatives.add(
        "M"
      );

      return [
        ...alternatives
      ];
    }
  }

  if (
    lineNumber === 1
  ) {
    if (
      index === 0
    ) {
      alternatives.add(
        "P"
      );
    }

    if (
      index === 1
    ) {
      alternatives.add(
        "<"
      );
    }

    /*
     * País emissor.
     */
    if (
      index >= 2 &&
      index <= 4
    ) {
      for (
        const item of
          LETTER_ALTERNATIVES[
            char
          ] || []
      ) {
        alternatives.add(
          item
        );
      }
    }
  }

  return [
    ...alternatives
  ];
}

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
    const hasAlternative =
      variants.some(
        current => {
          const alternatives =
            getAlternativesForPosition(
              current.split(""),
              index,
              lineNumber
            );

          return (
            alternatives.length > 1
          );
        }
      );

    if (
      !hasAlternative
    ) {
      continue;
    }

    const next = [];

    for (
      const current of
        variants
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
      ].slice(
        0,
        maxVariants
      );
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
     * A MRZ do passaporte TD3 fica na parte inferior.
     *
     * Usamos diferentes alturas porque a fotografia
     * pode conter margens diferentes.
     */
    const ratios = [
      0.22,
      0.26,
      0.30,
      0.36,
      0.42,
      0.48
    ];

    for (
      const ratio of
        ratios
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

      const base =
        sharp(normalized)
          .extract({
            left: 0,
            top,
            width,
            height:
              cropHeight
          })
          .extend({
            top: 48,
            bottom: 48,
            left: 48,
            right: 48,
            background:
              "#ffffff"
          });

      /*
       * Variante colorida.
       */
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

      /*
       * Variante grayscale.
       */
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

      /*
       * Variante de contraste.
       */
      const contrast =
        await base
          .clone()
          .grayscale()
          .normalize()
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
          buffer:
            color
        },
        {
          name:
            `mrz_${Math.round(
              ratio * 100
            )}_gray`,
          buffer:
            gray
        },
        {
          name:
            `mrz_${Math.round(
              ratio * 100
            )}_contrast`,
          buffer:
            contrast
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
      logger:
        message => {
          if (
            this.logger
          ) {
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
        String(
          pass.psm
        );
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
    } catch (
      error
    ) {
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

          /*
           * Toda passagem, inclusive full OCR,
           * é analisada como possível fonte MRZ.
           */
          const extracted =
            buildPairsFromOcrText(
              text,
              `${variant.name}/${pass.name}`,
              normalizedConfidence
            );

          mrzSources.push({
            source:
              `${variant.name}/${pass.name}`,

            confidence:
              normalizedConfidence,

            extracted
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

    /*
     * =====================================================
     * CONSTRUIR PARES
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
        pairs.push(
          pair
        );
      }
    }

    /*
     * =====================================================
     * EXPANSÃO
     * =====================================================
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
          : [
              pair.line1
            ];

      const second =
        line2Variants.length
          ? line2Variants
          : [
              pair.line2
            ];

      let count = 0;

      for (
        const line1 of
          first
      ) {
        for (
          const line2 of
            second
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
            count >=
            512
          ) {
            break;
          }
        }

        if (
          count >=
          512
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

      uniquePairs.push(
        pair
      );
    }

    /*
     * =====================================================
     * ORDENAÇÃO
     * =====================================================
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
        .filter(
          Boolean
        );

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
          Number.isFinite
        );

    const confidence =
      confidenceValues.length
        ? Math.max(
            ...confidenceValues
          )
        : null;

    /*
     * =====================================================
     * DIAGNÓSTICO
     * =====================================================
     *
     * Guardamos os candidatos que realmente chegaram
     * até esta etapa.
     */

    const diagnosticCandidates =
      uniquePairs
        .slice(
          0,
          30
        )
        .map(
          pair => ({
            line1:
              pair.line1,

            line2:
              pair.line2,

            source:
              pair.source,

            confidence:
              pair.confidence,

            score:
              pair.score,

            expanded:
              Boolean(
                pair.expanded
              )
          })
        );

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
          .filter(
            Boolean
          ),

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

        confidence,

        candidateSample:
          diagnosticCandidates,

        sourceSummary:
          mrzSources.map(
            source => ({
              source:
                source.source,

              confidence:
                source.confidence,

              firstCandidates:
                source.extracted
                  .candidates
                  .first
                  .slice(
                    0,
                    8
                  ),

              secondCandidates:
                source.extracted
                  .candidates
                  .second
                  .slice(
                    0,
                    8
                  ),

              pairCount:
                source.extracted
                  .pairs
                  .length
            })
          )
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
