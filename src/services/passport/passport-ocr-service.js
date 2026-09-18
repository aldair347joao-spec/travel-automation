const Tesseract = require("tesseract.js");
const sharp = require("sharp");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

const MRZ_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/*
 * OCR geral do documento.
 *
 * Aqui queremos ler também os campos impressos
 * do passaporte, e não somente a MRZ.
 */
const FULL_OCR_PASSES = [
  {
    name: "full_block",
    psm: 6
  },
  {
    name: "full_sparse",
    psm: 11
  }
];

/*
 * OCR específico da MRZ.
 *
 * A MRZ normalmente possui duas linhas de 44 caracteres
 * no passaporte comum TD3.
 */
const MRZ_OCR_PASSES = [
  {
    name: "mrz_block",
    psm: 6
  },
  {
    name: "mrz_lines",
    psm: 7
  },
  {
    name: "mrz_single",
    psm: 13
  }
];

/*
 * Algumas confusões comuns do OCR.
 *
 * Estas correções NÃO são consideradas válidas por si mesmas.
 * Elas apenas geram uma alternativa para posteriormente
 * ser confirmada pela validação da MRZ.
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

function normalizeOcrLine(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[«»‹›≤≥]/g, "<")
    .replace(/[—–−_]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9< -]/g, "")
    .trim();
}

function compactMrz(value) {
  return normalizeOcrLine(value)
    .replace(/\s+/g, "")
    .replace(/-/g, "<");
}

function correctDigit(char) {
  const value = String(char || "");

  if (/^\d$/.test(value)) {
    return value;
  }

  return DIGIT_CORRECTIONS[value] || value;
}

function correctLetter(char) {
  const value = String(char || "");

  if (/^[A-Z]$/.test(value)) {
    return value;
  }

  return LETTER_CORRECTIONS[value] || value;
}

/*
 * Normalização da primeira linha TD3.
 *
 * Estrutura:
 *
 * P<XXX...
 */
function normalizeFirstMrzLine(value) {
  const line = compactMrz(value);

  if (!line) {
    return null;
  }

  const chars = line.split("");

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
    let index = 2;
    index <= 4 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctLetter(chars[index]);
  }

  return chars.join("");
}

/*
 * Normalização da segunda linha TD3.
 */
function normalizeSecondMrzLine(value) {
  const line = compactMrz(value);

  if (!line) {
    return null;
  }

  const chars = line.split("");

  /*
   * Número do passaporte + check digit.
   */
  if (chars.length > 9) {
    chars[9] =
      correctDigit(chars[9]);
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
      correctLetter(chars[index]);
  }

  /*
   * Data de nascimento + check digit.
   */
  for (
    let index = 13;
    index <= 19 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigit(chars[index]);
  }

  /*
   * Sexo.
   */
  if (chars.length > 20) {
    const sex =
      correctLetter(chars[20]);

    chars[20] =
      ["M", "F", "<"].includes(sex)
        ? sex
        : "<";
  }

  /*
   * Data de validade + check digit.
   */
  for (
    let index = 21;
    index <= 27 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigit(chars[index]);
  }

  /*
   * Número pessoal permanece alfanumérico.
   */

  /*
   * Check digit pessoal + check final.
   */
  for (
    let index = 42;
    index <= 43 && index < chars.length;
    index += 1
  ) {
    chars[index] =
      correctDigit(chars[index]);
  }

  return chars.join("");
}

/*
 * Dá uma pontuação estrutural a uma possível linha MRZ.
 *
 * Esta pontuação NÃO valida o passaporte.
 */
function scoreMrzLine(line, lineNumber) {
  if (!line) {
    return -1;
  }

  let score = 0;

  if (line.length === 44) {
    score += 20;
  } else if (line.length >= 40) {
    score += 8;
  }

  if (lineNumber === 1) {
    if (line[0] === "P") {
      score += 15;
    }

    if (line[1] === "<") {
      score += 5;
    }

    if (/^P<[A-Z<]{3}/.test(line)) {
      score += 5;
    }
  } else {
    if (/^[A-Z0-9<]+$/.test(line)) {
      score += 4;
    }

    if (/^.{9}\d/.test(line)) {
      score += 3;
    }
  }

  if (/^[A-Z0-9<]+$/.test(line)) {
    score += 3;
  }

  if (/<{2,}/.test(line)) {
    score += 2;
  }

  return score;
}

/*
 * Adiciona uma possível linha de 44 caracteres.
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
    if (candidate.length !== 44) {
      return;
    }

    const normalized =
      lineNumber === 1
        ? normalizeFirstMrzLine(candidate)
        : normalizeSecondMrzLine(candidate);

    if (
      normalized &&
      normalized.length === 44
    ) {
      set.add(normalized);
    }

    /*
     * Também conservamos o OCR original.
     */
    set.add(candidate);
  };

  if (compact.length === 44) {
    add(compact);
    return;
  }

  /*
   * OCR pode inserir caracteres extras.
   *
   * Tentamos pequenas janelas, mas a validação posterior
   * continua obrigatória.
   */
  if (
    compact.length > 44 &&
    compact.length <= 96
  ) {
    for (
      let start = 0;
      start <= compact.length - 44;
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
 * Extrai candidatos de MRZ de UMA leitura OCR.
 *
 * Muito importante:
 *
 * Não misturamos textos provenientes de OCRs diferentes
 * nesta função.
 */
function extractLineCandidates(text) {
  const rawLines =
    String(text || "")
      .split(/\r?\n/)
      .map(normalizeOcrLine)
      .filter(Boolean);

  const first =
    new Set();

  const second =
    new Set();

  const processString =
    value => {
      const compact =
        compactMrz(value);

      if (compact.length < 40) {
        return;
      }

      /*
       * Procuramos possíveis linhas 1.
       */
      for (
        let start = 0;
        start <= compact.length - 44;
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

        /*
         * Segunda linha.
         */
        if (
          start === 0 ||
          compact.length <= 48
        ) {
          add44Window(
            second,
            window,
            2
          );
        }
      }

      /*
       * Quando o OCR devolver as duas linhas
       * praticamente juntas, tentamos reconstruir
       * um bloco 44 + 44.
       */
      if (
        compact.length >= 80 &&
        compact.length <= 96
      ) {
        for (
          let start = 0;
          start <= compact.length - 88;
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
          }

          add44Window(
            second,
            line2,
            2
          );
        }
      }
    };

  /*
   * Linhas individuais.
   */
  for (
    const line of rawLines
  ) {
    processString(line);
  }

  /*
   * Linhas adjacentes.
   *
   * Continua sendo a MESMA leitura OCR.
   */
  for (
    let index = 0;
    index < rawLines.length - 1;
    index += 1
  ) {
    processString(
      `${rawLines[index]}${rawLines[index + 1]}`
    );
  }

  return {
    rawLines,
    first: [...first],
    second: [...second]
  };
}

/*
 * Constrói pares de uma única leitura OCR.
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
    const line1 of candidates.first
  ) {
    for (
      const line2 of candidates.second
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
 * Prepara versões da imagem somente para OCR.
 *
 * O arquivo original recebido pelo servidor nunca é alterado.
 */
async function createPreprocessedVariants(
  buffer
) {
  const processed =
    await sharp(buffer)
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: false
      })
      .flatten({
        background: "#ffffff"
      })
      .jpeg({
        quality: 94,
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
     * A MRZ fica na zona inferior.
     *
     * Usamos três recortes para evitar depender
     * de uma única posição.
     */
    const ratios = [
      0.30,
      0.38,
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

      const crop =
        sharp(normalized)
          .extract({
            left: 0,
            top,
            width,
            height: cropHeight
          })
          .extend({
            top: 24,
            bottom: 24,
            left: 24,
            right: 24,
            background: "#ffffff"
          });

      const color =
        await crop
          .clone()
          .sharpen({
            sigma: 1.1
          })
          .jpeg({
            quality: 98,
            chromaSubsampling: "4:4:4"
          })
          .toBuffer();

      const gray =
        await crop
          .clone()
          .grayscale()
          .normalize()
          .sharpen({
            sigma: 1.2
          })
          .jpeg({
            quality: 98,
            chromaSubsampling: "4:4:4"
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
            ocrPass: pass.name
          });
        }
      }
    };

    if (
      Number.isInteger(pass.psm)
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
            name: "original",
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
     * Cada OCR é processado separadamente.
     */
    for (
      const variant of
        prepared.variants
    ) {
      const isFull =
        variant.name === "full" ||
        variant.name === "original";

      const passes =
        isFull
          ? FULL_OCR_PASSES
          : MRZ_OCR_PASSES;

      for (
        const basePass of passes
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
              result?.data?.confidence
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
           * Para os recortes MRZ,
           * extraímos os candidatos imediatamente.
           *
           * Assim a origem da informação é preservada.
           */
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
     * IMPORTANTE:
     *
     * Não fazemos:
     *
     * mergeOcrTexts(...)
     *
     * para depois tentar montar uma MRZ.
     *
     * Isso poderia pegar a primeira linha de uma leitura
     * e a segunda linha de outra leitura completamente
     * diferente.
     */

    const pairs = [];
    const candidateSet =
      new Set();

    for (
      const source of mrzSources
    ) {
      for (
        const pair of
          source.extracted.pairs
      ) {
        pairs.push(pair);

        candidateSet.add(
          pair.line1
        );

        candidateSet.add(
          pair.line2
        );
      }
    }

    /*
     * O OCR completo também pode encontrar a MRZ.
     *
     * Usamos como fallback.
     */
    for (
      const result of allResults
    ) {
      if (
        result.variant !== "full" &&
        result.variant !== "original"
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

        candidateSet.add(
          pair.line1
        );

        candidateSet.add(
          pair.line2
        );
      }
    }

    /*
     * Remove pares duplicados.
     */
    const uniquePairs = [];
    const seenPairs =
      new Set();

    for (
      const pair of pairs
    ) {
      const key =
        `${pair.line1}|${pair.line2}`;

      if (
        seenPairs.has(key)
      ) {
        continue;
      }

      seenPairs.add(key);

      uniquePairs.push(
        pair
      );
    }

    /*
     * Ordenamos primeiro pela estrutura da MRZ
     * e depois pela confiança do OCR.
     */
    uniquePairs.sort(
      (a, b) => {
        const confidenceA =
          Number(
            a.confidence || 0
          );

        const confidenceB =
          Number(
            b.confidence || 0
          );

        return (
          b.score -
            a.score ||
          confidenceB -
            confidenceA
        );
      }
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

    /*
     * O texto do OCR completo é preservado
     * para posterior extração dos campos do passaporte.
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
      fullTexts.join("\n");

    return {
      /*
       * Texto geral do passaporte.
       */
      text:
        fullText,

      /*
       * Confiança geral do OCR.
       *
       * Isto não substitui a validação da MRZ.
       */
      confidence,

      /*
       * Linhas reconhecidas no documento.
       */
      lines:
        fullText
          .split(/\r?\n/)
          .map(
            normalizeOcrLine
          )
          .filter(Boolean),

      /*
       * Candidatos encontrados.
       */
      mrzCandidates:
        [...candidateSet],

      /*
       * Pares candidatos preservando a origem.
       */
      mrzPairs:
        uniquePairs,

      /*
       * Diagnóstico técnico sem devolver
       * o conteúdo completo do passaporte.
       */
      diagnostics: {
        ocrPasses:
          allResults.length,

        preprocessingVariants:
          prepared.variants.length,

        mrzSources:
          mrzSources.length,

        mrzCandidatePairs:
          uniquePairs.length,

        imageWidth:
          prepared.width,

        imageHeight:
          prepared.height,

        fullOcrResults:
          fullTexts.length
      }
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
                bestPair.score,

              source:
                bestPair.source,

              confidence:
                bestPair.confidence
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
