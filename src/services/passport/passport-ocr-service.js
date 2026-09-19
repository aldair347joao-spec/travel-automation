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
 * ESTRATÉGIA OCR
 * =========================================================
 *
 * A versão anterior fazia:
 *
 * 6 crops × 3 tratamentos × 3 PSM
 *
 * e depois ainda expandia centenas de candidatos.
 *
 * Isso tornava a análise lenta e aumentava muito o ruído.
 *
 * Agora:
 *
 * 1. normalização da imagem
 * 2. MRZ inferior principal
 * 3. poucas tentativas OCR
 * 4. se não houver candidatos fortes:
 *      segundo crop
 * 5. somente no fim:
 *      OCR da página completa
 *
 * A validação real continua no
 * PassportValidationService.
 */

const PRIMARY_MRZ_PASSES = [
  {
    name: "mrz_primary_block",
    psm: 6
  },
  {
    name: "mrz_primary_single",
    psm: 7
  }
];

const PRIMARY_MRZ_GRAY_PASSES = [
  {
    name: "mrz_primary_gray_single",
    psm: 7
  }
];

const FALLBACK_MRZ_PASSES = [
  {
    name: "mrz_fallback_block",
    psm: 6
  },
  {
    name: "mrz_fallback_single",
    psm: 7
  }
];

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
 * =========================================================
 * CORREÇÕES OCR
 * =========================================================
 *
 * Estas tabelas NÃO validam o passaporte.
 *
 * Apenas ajudam a transformar erros comuns do OCR
 * em candidatos que posteriormente serão submetidos
 * aos check digits ICAO.
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
    .replace(/[⟨⟩]/g, "<")
    .replace(/[|!]/g, "I")
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
 * PRIMEIRA LINHA TD3
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
   * A primeira posição deve ser P.
   *
   * Não confiamos cegamente no OCR.
   * O candidato original continua disponível
   * em outras etapas.
   */
  if (chars.length > 0) {
    if (chars[0] !== "P") {
      chars[0] =
        correctLetter(chars[0]);
    }
  }

  /*
   * TD3:
   *
   * P<
   */
  if (chars.length > 1) {
    chars[1] = "<";
  }

  /*
   * Código do país emissor.
   */
  for (
    let i = 2;
    i <= 4 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctLetter(chars[i]);
  }

  return chars.join("");
}

/*
 * =========================================================
 * SEGUNDA LINHA TD3
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
    i <= 12 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctLetter(chars[i]);
  }

  /*
   * Data de nascimento.
   */
  for (
    let i = 13;
    i <= 19 && i < chars.length;
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
      sex === "F" ||
      sex === "<"
    ) {
      chars[20] = sex;
    } else {
      chars[20] = "<";
    }
  }

  /*
   * Validade.
   */
  for (
    let i = 21;
    i <= 27 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

  /*
   * Check digit do número pessoal.
   */
  if (chars.length > 42) {
    chars[42] =
      correctDigit(chars[42]);
  }

  /*
   * Check digit composto.
   */
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

    /*
     * Passaportes TD3 normalmente têm
     * bastante conteúdo de filler <.
     */
    if (/<{2,}/.test(line)) {
      score += 3;
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

    if (
      /^.{28}[A-Z0-9<]+$/.test(line)
    ) {
      score += 3;
    }
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

  const add =
    candidate => {
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
       * Mantemos a leitura original.
       * O validador decidirá depois.
       */
      set.add(candidate);
    };

  if (compact.length === 44) {
    add(compact);
    return;
  }

  /*
   * Pequenas sobras do OCR são comuns.
   *
   * Limitamos a procura a textos razoáveis
   * para evitar explosão combinatória.
   */
  if (
    compact.length > 44 &&
    compact.length <= 100
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

      if (
        lineNumber === 2 &&
        !/^[A-Z0-9<]{44}$/.test(
          window
        )
      ) {
        continue;
      }

      add(
        window
      );
    }
  }
}

/*
 * =========================================================
 * CANDIDATOS DE LINHA
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

  add44Window(
    set,
    compact,
    lineNumber
  );

  /*
   * Para a primeira linha:
   * procurar P.
   */
  if (lineNumber === 1) {
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
}

/*
 * =========================================================
 * EXTRAÇÃO DA MRZ
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

  /*
   * 1. Linhas individuais.
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
   * 2. Pares de linhas adjacentes.
   */
  for (
    let i = 0;
    i < rawLines.length - 1;
    i += 1
  ) {
    const line1 =
      rawLines[i];

    const line2 =
      rawLines[i + 1];

    const joined =
      compactMrz(
        `${line1}${line2}`
      );

    /*
     * Caso clássico:
     * duas linhas perfeitas.
     */
    if (joined.length >= 88) {
      const p =
        joined.indexOf("P");

      if (p >= 0) {
        const tail =
          joined.slice(p);

        if (tail.length >= 88) {
          add44Window(
            first,
            tail.slice(0, 44),
            1
          );

          add44Window(
            second,
            tail.slice(44, 88),
            2
          );
        }
      }
    }
  }

  /*
   * 3. Texto completo.
   *
   * Útil quando o Tesseract juntou as duas linhas.
   */
  const whole =
    compactMrz(text);

  if (whole.length >= 88) {
    const p =
      whole.indexOf("P");

    if (p >= 0) {
      const tail =
        whole.slice(p);

      if (tail.length >= 88) {
        add44Window(
          first,
          tail.slice(0, 44),
          1
        );

        add44Window(
          second,
          tail.slice(44, 88),
          2
        );
      }

      /*
       * Pequeno deslocamento caso o OCR tenha
       * inserido alguns caracteres antes/depois.
       */
      if (
        tail.length > 88 &&
        tail.length <= 110
      ) {
        for (
          let start = 0;
          start <= tail.length - 88;
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
            pair.slice(44, 88),
            2
          );
        }
      }
    }
  }

  return {
    rawLines,

    first:
      [...first].slice(0, 40),

    second:
      [...second].slice(0, 40)
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

  /*
   * Limite defensivo.
   *
   * Não precisamos de milhares de pares.
   */
  const firstCandidates =
    candidates.first.slice(0, 20);

  const secondCandidates =
    candidates.second.slice(0, 20);

  for (
    const line1 of firstCandidates
  ) {
    for (
      const line2 of secondCandidates
    ) {
      const score =
        scoreMrzLine(
          line1,
          1
        ) +
        scoreMrzLine(
          line2,
          2
        );

      /*
       * Um par TD3 precisa pelo menos
       * parecer estruturalmente correto.
       */
      if (score < 45) {
        continue;
      }

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

        score
      });
    }
  }

  pairs.sort(
    (a, b) =>
      Number(b.score || 0) -
      Number(a.score || 0)
  );

  return {
    candidates,
    pairs:
      pairs.slice(0, 30)
  };
}

/*
 * =========================================================
 * EXPANSÃO INTELIGENTE
 * =========================================================
 *
 * A versão anterior fazia expansão sequencial de muitas
 * posições e podia chegar rapidamente a centenas/milhares
 * de combinações.
 *
 * Agora usamos uma pequena busca em largura.
 *
 * O objetivo é cobrir:
 *
 * O -> 0
 * I -> 1
 * L -> 1
 * B -> 8
 * etc.
 *
 * sem destruir o desempenho.
 */

function getAlternativesForPosition(
  chars,
  index,
  lineNumber
) {
  const char =
    chars[index];

  const alternatives =
    new Set([
      char
    ]);

  if (lineNumber === 1) {
    if (index === 0) {
      alternatives.add("P");
    }

    if (index === 1) {
      alternatives.add("<");
    }

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
        alternatives.add(item);
      }
    }

    return [
      ...alternatives
    ];
  }

  /*
   * Segunda linha.
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

  if (numeric) {
    for (
      const item of
        DIGIT_ALTERNATIVES[
          char
        ] || []
    ) {
      alternatives.add(item);
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
      alternatives.add(item);
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
      char !== "M" &&
      char !== "F" &&
      char !== "<"
    ) {
      alternatives.add("<");
      alternatives.add("M");
      alternatives.add("F");
    }

    return [
      ...alternatives
    ];
  }

  return [
    ...alternatives
  ];
}

function expandMrzLine(
  value,
  lineNumber,
  maxVariants = 64
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

  /*
   * Primeiro preservamos sempre o candidato original.
   */
  let variants = [
    normalized
  ];

  /*
   * Só analisamos posições que realmente
   * possuem uma alternativa OCR.
   */
  const positions = [];

  for (
    let index = 0;
    index < 44;
    index += 1
  ) {
    const alternatives =
      getAlternativesForPosition(
        normalized.split(""),
        index,
        lineNumber
      );

    if (
      alternatives.length > 1
    ) {
      positions.push({
        index,
        alternatives
      });
    }
  }

  /*
   * No máximo 8 posições ambíguas.
   *
   * Mais do que isso normalmente indica
   * que o OCR está muito ruim e é melhor
   * executar outra passagem de OCR.
   */
  const limitedPositions =
    positions.slice(0, 8);

  for (
    const position of limitedPositions
  ) {
    const next = [];

    for (
      const current of variants
    ) {
      const chars =
        current.split("");

      const alternatives =
        getAlternativesForPosition(
          chars,
          position.index,
          lineNumber
        );

      for (
        const alternative of alternatives
      ) {
        chars[position.index] =
          alternative;

        next.push(
          chars.join("")
        );

        if (
          next.length >= maxVariants
        ) {
          break;
        }

        chars[position.index] =
          current[position.index];
      }

      if (
        next.length >= maxVariants
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

  /*
   * Garante o candidato original.
   */
  variants.unshift(
    normalized
  );

  return [
    ...new Set(variants)
  ].slice(
    0,
    maxVariants
  );
}

/*
 * =========================================================
 * PRÉ-PROCESSAMENTO
 * =========================================================
 *
 * Aqui está uma das maiores correções de desempenho.
 *
 * Não criamos dezenas de variantes.
 *
 * Criamos:
 *
 * - imagem normalizada
 * - crop MRZ principal
 * - grayscale MRZ principal
 * - crop MRZ fallback
 * - grayscale fallback
 * - full image para último recurso
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

  const variants = [];

  /*
   * Full image fica guardada, mas marcada
   * para uso somente como fallback.
   */
  variants.push({
    name: "full",
    type: "full",
    buffer: normalized,
    priority: 3
  });

  if (
    width &&
    height
  ) {
    /*
     * Crop principal.
     *
     * 34% da parte inferior cobre a MRZ
     * mesmo quando existe margem significativa.
     */
    const primaryRatio =
      0.34;

    const primaryHeight =
      Math.max(
        1,
        Math.floor(
          height *
            primaryRatio
        )
      );

    const primaryTop =
      Math.max(
        0,
        height -
          primaryHeight
      );

    const primaryBase =
      sharp(normalized)
        .extract({
          left: 0,
          top: primaryTop,
          width,
          height:
            primaryHeight
        })
        .extend({
          top: 60,
          bottom: 60,
          left: 40,
          right: 40,
          background:
            "#ffffff"
        });

    const primaryColor =
      await primaryBase
        .clone()
        .sharpen({
          sigma: 1.1
        })
        .jpeg({
          quality: 100,
          chromaSubsampling:
            "4:4:4"
        })
        .toBuffer();

    const primaryGray =
      await primaryBase
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

    variants.push({
      name:
        "mrz_primary_color",
      type: "mrz",
      buffer:
        primaryColor,
      priority: 1
    });

    variants.push({
      name:
        "mrz_primary_gray",
      type: "mrz",
      buffer:
        primaryGray,
      priority: 1
    });

    /*
     * Fallback mais largo.
     *
     * 48% inferior.
     */
    const fallbackRatio =
      0.48;

    const fallbackHeight =
      Math.max(
        1,
        Math.floor(
          height *
            fallbackRatio
        )
      );

    const fallbackTop =
      Math.max(
        0,
        height -
          fallbackHeight
      );

    const fallbackBase =
      sharp(normalized)
        .extract({
          left: 0,
          top: fallbackTop,
          width,
          height:
            fallbackHeight
        })
        .extend({
          top: 60,
          bottom: 60,
          left: 40,
          right: 40,
          background:
            "#ffffff"
        });

    const fallbackGray =
      await fallbackBase
        .clone()
        .grayscale()
        .normalize()
        .sharpen({
          sigma: 1.5
        })
        .jpeg({
          quality: 100,
          chromaSubsampling:
            "4:4:4"
        })
        .toBuffer();

    variants.push({
      name:
        "mrz_fallback_gray",
      type: "mrz",
      buffer:
        fallbackGray,
      priority: 2
    });
  }

  /*
   * Ordenamos:
   *
   * MRZ primeiro.
   * Full somente no final.
   */
  variants.sort(
    (a, b) =>
      Number(a.priority || 0) -
      Number(b.priority || 0)
  );

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

  /*
   * Verifica rapidamente se já temos
   * uma estrutura suficientemente boa para
   * parar de gastar CPU.
   */
  hasStrongMrzCandidate(
    mrzSources
  ) {
    for (
      const source of mrzSources
    ) {
      const pairs =
        source?.extracted?.pairs ||
        [];

      for (
        const pair of pairs
      ) {
        if (
          pair.line1?.length === 44 &&
          pair.line2?.length === 44 &&
          pair.line1[0] === "P" &&
          pair.line1[1] === "<" &&
          pair.score >= 90
        ) {
          return true;
        }
      }
    }

    return false;
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
            type:
              "full",
            buffer,
            priority:
              3
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
     * FASE 1 — MRZ PRINCIPAL
     * =====================================================
     */

    for (
      const variant of
        prepared.variants
    ) {
      /*
       * Full image só entra na fase final.
       */
      if (
        variant.type === "full"
      ) {
        continue;
      }

      let passes =
        FALLBACK_MRZ_PASSES;

      if (
        variant.name ===
        "mrz_primary_color"
      ) {
        passes =
          PRIMARY_MRZ_PASSES;
      }

      if (
        variant.name ===
        "mrz_primary_gray"
      ) {
        passes =
          PRIMARY_MRZ_GRAY_PASSES;
      }

      for (
        const basePass of passes
      ) {
        const pass = {
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

          /*
           * Se a MRZ já parece excelente,
           * não fazemos OCR adicional.
           *
           * O PassportValidationService continuará
           * responsável pela confirmação final.
           */
          if (
            this.hasStrongMrzCandidate(
              mrzSources
            )
          ) {
            break;
          }
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

      if (
        this.hasStrongMrzCandidate(
          mrzSources
        )
      ) {
        break;
      }
    }

    /*
     * =====================================================
     * FASE 2 — OCR COMPLETO
     * =====================================================
     *
     * Só executamos se a MRZ inferior não
     * produzir uma estrutura forte.
     */
    if (
      !this.hasStrongMrzCandidate(
        mrzSources
      )
    ) {
      const fullVariant =
        prepared.variants.find(
          variant =>
            variant.type === "full"
        );

      if (fullVariant) {
        for (
          const pass of
            FULL_OCR_PASSES
        ) {
          try {
            const result =
              await this.runOcr(
                fullVariant.buffer,
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

            allResults.push({
              variant:
                "full",
              pass:
                pass.name,
              confidence:
                normalizedConfidence,
              text
            });

            const extracted =
              buildPairsFromOcrText(
                text,
                `full/${pass.name}`,
                normalizedConfidence
              );

            mrzSources.push({
              source:
                `full/${pass.name}`,

              confidence:
                normalizedConfidence,

              extracted
            });

            if (
              this.hasStrongMrzCandidate(
                mrzSources
              )
            ) {
              break;
            }
          } catch (
            error
          ) {
            if (
              this.logger
            ) {
              this.logger({
                event:
                  "passport_ocr_full_pass_failed",

                pass:
                  pass.name,

                error:
                  error.message
              });
            }
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
      const source of mrzSources
    ) {
      for (
        const pair of
          source.extracted.pairs
      ) {
        pairs.push(
          pair
        );
      }
    }

    /*
     * =====================================================
     * EXPANSÃO CONTROLADA
     * =====================================================
     */

    const expandedPairs = [];

    for (
      const pair of pairs
    ) {
      const line1Variants =
        expandMrzLine(
          pair.line1,
          1,
          48
        );

      const line2Variants =
        expandMrzLine(
          pair.line2,
          2,
          96
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

      /*
       * Não fazemos produto cartesiano gigante.
       *
       * Priorizamos variantes por score.
       */
      const candidates = [];

      for (
        const line1 of first
      ) {
        for (
          const line2 of second
        ) {
          candidates.push({
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
        }
      }

      candidates.sort(
        (a, b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

      expandedPairs.push(
        ...candidates.slice(
          0,
          80
        )
      );
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
      const pair of expandedPairs
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
          scoreA !== scoreB
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
            "full"
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
     * DIAGNÓSTICOS
     * =====================================================
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

/*
 * =========================================================
 * EXPORTS
 * =========================================================
 *
 * Mantemos os mesmos exports utilizados
 * pelo restante do projeto.
 */

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
