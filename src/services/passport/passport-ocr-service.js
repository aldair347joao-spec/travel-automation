const Tesseract = require("tesseract.js");
const sharp = require("sharp");

const MAX_IMAGE_BYTES =
  8 * 1024 * 1024;

const DEFAULT_LANGUAGE =
  process.env.OCR_LANGUAGE || "eng";

const MRZ_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

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
 * CONFUSÕES OCR ADICIONAIS
 * =========================================================
 *
 * Estas NÃO são substituições automáticas.
 *
 * São apenas possibilidades que o recuperador poderá
 * testar. Um carácter só será aceite no resultado final
 * se os check digits ICAO confirmarem a combinação.
 */
const MRZ_OCR_CONFUSIONS = {
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
  B: ["8"],

  C: ["G"],
  G: ["C"],

  U: ["V"],
  V: ["U"],

  R: ["P"],
  P: ["R"],

  N: ["H"],
  H: ["N"],

  Y: ["V"],

  F: ["E"],
  E: ["F"],

  K: ["X"],
  X: ["K"],

  J: ["I"],
  M: ["N"],
  W: ["V"],

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

  if (chars.length > 0) {
    if (chars[0] !== "P") {
      chars[0] =
        correctLetter(chars[0]);
    }
  }

  if (chars.length > 1) {
    chars[1] = "<";
  }

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
 *
 * TD3:
 *
 * 0..8   passport number
 * 9      passport number check
 * 10..12 nationality
 * 13..18 DOB YYMMDD
 * 19     DOB check
 * 20     sex
 * 21..26 expiry YYMMDD
 * 27     expiry check
 * 28..41 personal number
 * 42     personal number check
 * 43     composite check
 */

function normalizeSecondMrzLine(value) {
  const line =
    compactMrz(value);

  if (!line) {
    return null;
  }

  const chars =
    line.split("");

  if (chars.length > 9) {
    chars[9] =
      correctDigit(chars[9]);
  }

  for (
    let i = 10;
    i <= 12 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctLetter(chars[i]);
  }

  for (
    let i = 13;
    i <= 19 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

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

  for (
    let i = 21;
    i <= 27 && i < chars.length;
    i += 1
  ) {
    chars[i] =
      correctDigit(chars[i]);
  }

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
 * ICAO CHECK DIGIT
 * =========================================================
 */

function mrzCharacterValue(char) {
  if (
    char >= "0" &&
    char <= "9"
  ) {
    return Number(char);
  }

  if (
    char >= "A" &&
    char <= "Z"
  ) {
    return (
      char.charCodeAt(0) -
      55
    );
  }

  if (char === "<") {
    return 0;
  }

  return null;
}

function calculateMrzCheckDigit(value) {
  const weights = [
    7,
    3,
    1
  ];

  let sum = 0;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    const number =
      mrzCharacterValue(
        value[index]
      );

    if (number === null) {
      return null;
    }

    sum +=
      number *
      weights[index % 3];
  }

  return String(
    sum % 10
  );
}

/*
 * =========================================================
 * DATAS
 * =========================================================
 */

function isRealCalendarDate(
  yy,
  mm,
  dd
) {
  if (
    !/^\d{2}$/.test(yy) ||
    !/^\d{2}$/.test(mm) ||
    !/^\d{2}$/.test(dd)
  ) {
    return false;
  }

  const month =
    Number(mm);

  const day =
    Number(dd);

  if (
    month < 1 ||
    month > 12
  ) {
    return false;
  }

  if (
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const year =
    2000 + Number(yy);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  return (
    date.getUTCFullYear() ===
      year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() ===
      day
  );
}

function isPlausibleBirthDate(value) {
  if (
    !/^\d{6}$/.test(value)
  ) {
    return false;
  }

  const yy =
    value.slice(0, 2);

  const mm =
    value.slice(2, 4);

  const dd =
    value.slice(4, 6);

  if (
    !isRealCalendarDate(
      yy,
      mm,
      dd
    )
  ) {
    return false;
  }

  const currentYear =
    new Date()
      .getUTCFullYear();

  const yyNumber =
    Number(yy);

  const candidates = [
    1900 + yyNumber,
    2000 + yyNumber
  ];

  return candidates.some(
    year => {
      const age =
        currentYear -
        year;

      return (
        age >= 0 &&
        age <= 120
      );
    }
  );
}

function isPlausibleExpiryDate(value) {
  if (
    !/^\d{6}$/.test(value)
  ) {
    return false;
  }

  return isRealCalendarDate(
    value.slice(0, 2),
    value.slice(2, 4),
    value.slice(4, 6)
  );
}

/*
 * =========================================================
 * RECUPERAÇÃO DA DOB
 * =========================================================
 */

function recoverBirthDateCandidates(
  line2,
  maxCandidates = 80
) {
  if (
    !line2 ||
    line2.length !== 44
  ) {
    return [];
  }

  /*
   * TD3:
   *
   * posição 14-19 = YYMMDD
   * posição 20    = check digit
   *
   * Em JavaScript:
   *
   * 13-18 = DOB
   * 19    = check digit
   */

  const observed =
    line2.slice(13, 19);

  const observedCheck =
    line2[19];

  if (!observed) {
    return [];
  }

  /*
   * OCR pode transformar números em letras.
   *
   * Aqui normalizamos apenas as equivalências
   * que fazem sentido para uma posição numérica.
   *
   * Não fazemos substituição cega.
   */
  const digitAlternatives = {
    "0": ["0"],
    "1": ["1"],
    "2": ["2"],
    "3": ["3"],
    "4": ["4"],
    "5": ["5"],
    "6": ["6"],
    "7": ["7"],
    "8": ["8"],
    "9": ["9"],

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

  /*
   * Para cada posição, mantemos apenas os dígitos
   * plausíveis derivados do OCR.
   *
   * Se o OCR reconheceu corretamente um dígito,
   * ele continua sendo a primeira opção.
   */
  const positionOptions =
    observed
      .split("")
      .map(char => {
        const options =
          digitAlternatives[
            char
          ] || [];

        const result =
          new Set();

        /*
         * Se já é número, preservamos o original.
         */
        if (/^\d$/.test(char)) {
          result.add(char);
        }

        /*
         * Adiciona as equivalências OCR.
         */
        for (
          const value of options
        ) {
          if (/^\d$/.test(value)) {
            result.add(value);
          }
        }

        /*
         * Segurança:
         * se o OCR produziu um carácter desconhecido,
         * permitimos todos os dígitos.
         *
         * Isso evita depender de uma tabela fechada
         * de erros OCR.
         */
        if (
          result.size === 0
        ) {
          for (
            let digit = 0;
            digit <= 9;
            digit += 1
          ) {
            result.add(
              String(digit)
            );
          }
        }

        return [
          ...result
        ];
      });

  const candidates =
    new Map();

  function addCandidate(
    date,
    distance
  ) {
    if (
      !/^\d{6}$/.test(date)
    ) {
      return;
    }

    if (
      !isPlausibleBirthDate(
        date
      )
    ) {
      return;
    }

    /*
     * O check digit da DOB é calculado
     * novamente a partir da data candidata.
     *
     * Isto é fundamental:
     *
     * o OCR pode ter errado simultaneamente
     * a data E o check digit.
     */
    const calculatedCheck =
      calculateMrzCheckDigit(
        date
      );

    if (
      !/^\d$/.test(
        String(calculatedCheck || "")
      )
    ) {
      return;
    }

    const key =
      date;

    const existing =
      candidates.get(key);

    const item = {
      date,
      checkDigit:
        calculatedCheck,
      distance,
      checkMatched:
        calculatedCheck ===
        observedCheck
    };

    if (
      !existing ||
      distance <
        existing.distance ||
      (
        distance ===
          existing.distance &&
        item.checkMatched &&
        !existing.checkMatched
      )
    ) {
      candidates.set(
        key,
        item
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * 1. DOB original
   * ---------------------------------------------------------
   *
   * Mesmo que o check digit observado esteja errado,
   * a data original pode estar correta.
   */
  if (
    /^\d{6}$/.test(
      observed
    )
  ) {
    addCandidate(
      observed,
      0
    );
  }

  /*
   * ---------------------------------------------------------
   * 2. Uma alteração
   * ---------------------------------------------------------
   *
   * Usa as alternativas OCR conhecidas.
   */
  for (
    let index = 0;
    index < 6;
    index += 1
  ) {
    for (
      const digit of
        positionOptions[index]
    ) {
      if (
        digit ===
        observed[index]
      ) {
        continue;
      }

      const chars =
        observed.split("");

      chars[index] =
        digit;

      addCandidate(
        chars.join(""),
        1
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * 3. Duas alterações
   * ---------------------------------------------------------
   *
   * Isto cobre casos em que o OCR errou dois caracteres
   * da DOB.
   */
  for (
    let first = 0;
    first < 6;
    first += 1
  ) {
    for (
      let second =
        first + 1;
      second < 6;
      second += 1
    ) {
      for (
        const firstDigit of
          positionOptions[first]
      ) {
        if (
          firstDigit ===
          observed[first]
        ) {
          continue;
        }

        for (
          const secondDigit of
            positionOptions[second]
        ) {
          if (
            secondDigit ===
            observed[second]
          ) {
            continue;
          }

          const chars =
            observed.split("");

          chars[first] =
            firstDigit;

          chars[second] =
            secondDigit;

          addCandidate(
            chars.join(""),
            2
          );

          if (
            candidates.size >=
            maxCandidates * 4
          ) {
            break;
          }
        }

        if (
          candidates.size >=
          maxCandidates * 4
        ) {
          break;
        }
      }

      if (
        candidates.size >=
        maxCandidates * 4
      ) {
        break;
      }
    }

    if (
      candidates.size >=
      maxCandidates * 4
    ) {
      break;
    }
  }

  /*
   * ---------------------------------------------------------
   * 4. Se ainda não encontrámos uma DOB plausível,
   *    fazemos recuperação numérica controlada.
   *
   * Não fazemos 1 milhão de combinações.
   *
   * Primeiro utilizamos as posições que o OCR marcou
   * como suspeitas.
   * ---------------------------------------------------------
   */

  if (
    candidates.size === 0
  ) {
    const allDigits =
      [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
      ];

    /*
     * Uma posição de cada vez.
     */
    for (
      let index = 0;
      index < 6;
      index += 1
    ) {
      for (
        const digit of allDigits
      ) {
        if (
          digit ===
          observed[index]
        ) {
          continue;
        }

        const chars =
          observed.split("");

        chars[index] =
          digit;

        addCandidate(
          chars.join(""),
          1
        );
      }
    }
  }

  /*
   * ---------------------------------------------------------
   * Ordenação
   * ---------------------------------------------------------
   *
   * 1. check digit observado coincide
   * 2. menor número de alterações
   * 3. data
   */
  return [
    ...candidates.values()
  ]
    .sort(
      (a, b) => {
        if (
          Boolean(
            b.checkMatched
          ) !==
          Boolean(
            a.checkMatched
          )
        ) {
          return b.checkMatched
            ? 1
            : -1;
        }

        if (
          Number(
            a.distance || 99
          ) !==
          Number(
            b.distance || 99
          )
        ) {
          return (
            Number(
              a.distance || 99
            ) -
            Number(
              b.distance || 99
            )
          );
        }

        return String(
          a.date
        ).localeCompare(
          String(
            b.date
          )
        );
      }
    )
    .slice(
      0,
      maxCandidates
    );
}
function applyBirthDateCandidates(
  line2,
  maxCandidates = 80
) {
  const recovered =
    recoverBirthDateCandidates(
      line2,
      maxCandidates
    );

  const variants = [];

  for (
    const candidate of recovered
  ) {
    const chars =
      line2.split("");

    for (
      let offset = 0;
      offset < 6;
      offset += 1
    ) {
      chars[13 + offset] =
        candidate.date[offset];
    }

    chars[19] =
      candidate.checkDigit;

    variants.push({
      line:
        chars.join(""),

      recoveredBirthDate:
        candidate.date,

      recoveredBirthCheckDigit:
        candidate.checkDigit,

      recoveryDistance:
        candidate.distance
    });
  }

  return variants;
}

/*
 * =========================================================
 * RECUPERAÇÃO DA EXPIRY DATE
 * =========================================================
 *
 * A MRZ continua YYMMDD.
 *
 * Não usamos aqui a ordem visual da data impressa
 * no passaporte.
 */

function recoverExpiryDateCandidates(
  line2,
  maxCandidates = 80
) {
  if (
    !line2 ||
    line2.length !== 44
  ) {
    return [];
  }

  const observed =
    line2.slice(21, 27);

  const observedCheck =
    line2[27];

  if (
    !/^[0-9]{6}$/.test(
      observed
    )
  ) {
    return [];
  }

  const candidates = [];

  function addCandidate(
    date,
    distance,
    requireObservedCheck
  ) {
    if (
      !isPlausibleExpiryDate(
        date
      )
    ) {
      return;
    }

    const expectedCheck =
      calculateMrzCheckDigit(
        date
      );

    if (
      requireObservedCheck &&
      expectedCheck !==
        observedCheck
    ) {
      return;
    }

    candidates.push({
      date,
      checkDigit:
        expectedCheck,

      distance,

      checkMatched:
        expectedCheck ===
        observedCheck
    });
  }

  /*
   * Primeiro:
   * uma alteração + check digit observado.
   */
  for (
    let index = 0;
    index < 6;
    index += 1
  ) {
    const original =
      observed[index];

    for (
      let digit = 0;
      digit <= 9;
      digit += 1
    ) {
      const value =
        String(digit);

      if (
        value === original
      ) {
        continue;
      }

      const chars =
        observed.split("");

      chars[index] =
        value;

      addCandidate(
        chars.join(""),
        1,
        true
      );

      if (
        candidates.length >=
        maxCandidates
      ) {
        break;
      }
    }

    if (
      candidates.length >=
      maxCandidates
    ) {
      break;
    }
  }

  /*
   * Segundo:
   * uma alteração, mas permitindo que
   * o check digit original também esteja errado.
   */
  if (
    candidates.length === 0
  ) {
    for (
      let index = 0;
      index < 6;
      index += 1
    ) {
      const original =
        observed[index];

      for (
        let digit = 0;
        digit <= 9;
        digit += 1
      ) {
        const value =
          String(digit);

        if (
          value === original
        ) {
          continue;
        }

        const chars =
          observed.split("");

        chars[index] =
          value;

        addCandidate(
          chars.join(""),
          1,
          false
        );

        if (
          candidates.length >=
          maxCandidates
        ) {
          break;
        }
      }

      if (
        candidates.length >=
        maxCandidates
      ) {
        break;
      }
    }
  }

  /*
   * Terceiro:
   * duas alterações, mantendo o check digit
   * observado.
   */
  if (
    candidates.length === 0
  ) {
    for (
      let first = 0;
      first < 6;
      first += 1
    ) {
      for (
        let second = first + 1;
        second < 6;
        second += 1
      ) {
        for (
          let digitA = 0;
          digitA <= 9;
          digitA += 1
        ) {
          for (
            let digitB = 0;
            digitB <= 9;
            digitB += 1
          ) {
            const chars =
              observed.split("");

            chars[first] =
              String(digitA);

            chars[second] =
              String(digitB);

            addCandidate(
              chars.join(""),
              2,
              true
            );

            if (
              candidates.length >=
              maxCandidates
            ) {
              break;
            }
          }

          if (
            candidates.length >=
            maxCandidates
          ) {
            break;
          }
        }

        if (
          candidates.length >=
          maxCandidates
        ) {
          break;
        }
      }

      if (
        candidates.length >=
        maxCandidates
      ) {
        break;
      }
    }
  }

  const seen =
    new Set();

  return candidates
    .sort((a, b) => {
      if (
        Boolean(
          b.checkMatched
        ) !==
        Boolean(
          a.checkMatched
        )
      ) {
        return b.checkMatched
          ? 1
          : -1;
      }

      return (
        Number(
          a.distance || 99
        ) -
        Number(
          b.distance || 99
        )
      );
    })
    .filter(candidate => {
      const key =
        `${candidate.date}|${candidate.checkDigit}`;

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .slice(
      0,
      maxCandidates
    );
}

function applyExpiryDateCandidates(
  line2,
  maxCandidates = 80
) {
  const recovered =
    recoverExpiryDateCandidates(
      line2,
      maxCandidates
    );

  const variants = [];

  for (
    const candidate of recovered
  ) {
    const chars =
      line2.split("");

    for (
      let offset = 0;
      offset < 6;
      offset += 1
    ) {
      chars[21 + offset] =
        candidate.date[offset];
    }

    chars[27] =
      candidate.checkDigit;

    variants.push({
      line:
        chars.join(""),

      recoveredExpiryDate:
        candidate.date,

      recoveredExpiryCheckDigit:
        candidate.checkDigit,

      expiryRecoveryDistance:
        candidate.distance,

      expiryCheckMatched:
        candidate.checkMatched
    });
  }

  return variants;
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

    if (
      /<{2,}/.test(line)
    ) {
      score += 3;
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

    if (
      /^.{28}[A-Z0-9<]+$/.test(line)
    ) {
      score += 3;
    }

    const birthDate =
      line.slice(
        13,
        19
      );

    if (
      isPlausibleBirthDate(
        birthDate
      )
    ) {
      score += 8;
    }

    const expiryDate =
      line.slice(
        21,
        27
      );

    if (
      isPlausibleExpiryDate(
        expiryDate
      )
    ) {
      score += 8;
    }
  }

  return score;
}

/*
 * =========================================================
 * JANELAS DE 44
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

      set.add(candidate);
    };

  if (
    compact.length === 44
  ) {
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
}

/*
 * =========================================================
 * EXTRAÇÃO MRZ
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

    if (
      joined.length >= 88
    ) {
      const p =
        joined.indexOf("P");

      if (p >= 0) {
        const tail =
          joined.slice(p);

        if (
          tail.length >= 88
        ) {
          add44Window(
            first,
            tail.slice(
              0,
              44
            ),
            1
          );

          add44Window(
            second,
            tail.slice(
              44,
              88
            ),
            2
          );
        }
      }
    }
  }

  const whole =
    compactMrz(text);

  if (
    whole.length >= 88
  ) {
    const p =
      whole.indexOf("P");

    if (p >= 0) {
      const tail =
        whole.slice(p);

      if (
        tail.length >= 88
      ) {
        add44Window(
          first,
          tail.slice(
            0,
            44
          ),
          1
        );

        add44Window(
          second,
          tail.slice(
            44,
            88
          ),
          2
        );
      }

      if (
        tail.length > 88 &&
        tail.length <= 110
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
            pair.slice(
              0,
              44
            ),
            1
          );

          add44Window(
            second,
            pair.slice(
              44,
              88
            ),
            2
          );
        }
      }
    }
  }

  return {
    rawLines,

    first:
      [...first].slice(
        0,
        40
      ),

    second:
      [...second].slice(
        0,
        40
      )
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

  const rawLines =
    Array.isArray(
      candidates.rawLines
    )
      ? candidates.rawLines
      : [];

  /*
   * =========================================================
   * PARES DIRETOS
   * =========================================================
   *
   * Uma MRZ TD3 tem duas linhas consecutivas.
   *
   * Primeiro tentamos preservar a relação original
   * encontrada pelo OCR:
   *
   *     linha 1
   *     linha 2
   *
   * Não fazemos imediatamente:
   *
   *     linha1 A × linha2 A/B/C/D
   *
   * porque isso cria combinações artificiais.
   */

  for (
    let index = 0;
    index < rawLines.length - 1;
    index += 1
  ) {
    const rawLine1 =
      rawLines[index];

    const rawLine2 =
      rawLines[index + 1];

    const line1Candidates =
      new Set();

    const line2Candidates =
      new Set();

    addLikelyLineCandidates(
      line1Candidates,
      rawLine1,
      1
    );

    addLikelyLineCandidates(
      line2Candidates,
      rawLine2,
      2
    );

    for (
      const line1 of line1Candidates
    ) {
      for (
        const line2 of line2Candidates
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

        if (
          score < 45
        ) {
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

          score,

          pairing:
            "adjacent_ocr_lines"
        });
      }
    }
  }

  /*
   * =========================================================
   * PARES EXTRAÍDOS PELO ALGORITMO EXISTENTE
   * =========================================================
   *
   * Só usamos o cruzamento de candidatos como FALLBACK.
   *
   * Isto é importante para fotografias em que o OCR:
   *
   * - quebra uma linha;
   * - junta as duas linhas;
   * - coloca texto extra entre elas;
   * - ou perde a separação visual da MRZ.
   *
   * Portanto não eliminamos a capacidade de recuperação.
   */

  const firstCandidates =
    candidates.first.slice(
      0,
      12
    );

  const secondCandidates =
    candidates.second.slice(
      0,
      12
    );

  /*
   * Se já conseguimos pares diretos suficientes,
   * não precisamos fabricar dezenas de combinações.
   */
  const hasGoodDirectPair =
    pairs.some(
      pair =>
        Number(
          pair.score || 0
        ) >= 75
    );

  if (
    !hasGoodDirectPair
  ) {
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

        if (
          score < 45
        ) {
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

          score,

          pairing:
            "fallback_candidate_cross"
        });
      }
    }
  }

  /*
   * =========================================================
   * DEDUPLICAÇÃO
   * =========================================================
   */

  const uniquePairs =
    new Map();

  for (
    const pair of pairs
  ) {
    const key =
      `${pair.line1}|${pair.line2}`;

    const existing =
      uniquePairs.get(
        key
      );

    if (
      !existing ||
      Number(
        pair.score || 0
      ) >
        Number(
          existing.score || 0
        )
    ) {
      uniquePairs.set(
        key,
        pair
      );
    }
  }

  const finalPairs =
    [
      ...uniquePairs.values()
    ];

  /*
   * =========================================================
   * ORDENAÇÃO
   * =========================================================
   *
   * Preferimos:
   *
   * 1. maior score;
   * 2. maior confiança;
   * 3. pares que vieram diretamente
   *    de linhas consecutivas do OCR.
   */

  finalPairs.sort(
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
        scoreB !== scoreA
      ) {
        return (
          scoreB -
          scoreA
        );
      }

      const directA =
        a.pairing ===
        "adjacent_ocr_lines"
          ? 1
          : 0;

      const directB =
        b.pairing ===
        "adjacent_ocr_lines"
          ? 1
          : 0;

      if (
        directB !== directA
      ) {
        return (
          directB -
          directA
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

  return {
    candidates,

    pairs:
      finalPairs.slice(
        0,
        20
      )
  };
}
/*
 * =========================================================
 * ALTERNATIVAS
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
    new Set([
      char
    ]);

  if (
    lineNumber === 1
  ) {
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

    return [
      ...alternatives
    ];
  }

  /*
   * =======================================================
   * TD3 — CAMPOS ALFANUMÉRICOS
   * =======================================================
   *
   * Número do passaporte:
   *   0..8
   *
   * Número pessoal:
   *   28..41
   *
   * Estes campos podem legitimamente conter letras,
   * números e <.
   *
   * Por isso NÃO podemos simplesmente transformar
   * letras em números ou números em letras.
   *
   * Geramos apenas ambiguidades OCR plausíveis.
   */
    if (
    (
      index >= 0 &&
      index <= 8
    ) ||
    (
      index >= 28 &&
      index <= 41
    )
  ) {
    /*
     * Confusões OCR tradicionais:
     *
     * O <-> 0
     * I <-> 1
     * L <-> 1
     * Z <-> 2
     * E <-> 3
     * A <-> 4
     * S <-> 5
     * G <-> 6
     * T <-> 7
     * B <-> 8
     */
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

    /*
     * Confusões adicionais encontradas
     * frequentemente em OCR.
     *
     * Importante:
     * nenhuma delas será aceita sem
     * confirmação matemática do MRZ.
     */
    for (
      const item of
        MRZ_OCR_CONFUSIONS[
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
   * Check digits.
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
/*
 * =========================================================
 * RECUPERAÇÃO MATEMÁTICA DOS CAMPOS ALFANUMÉRICOS TD3
 * =========================================================
 *
 * Corrige erros OCR nos campos:
 *
 *   0..8   número do passaporte
 *   28..41 número pessoal
 *
 * A correção só é aceita quando o check digit ICAO
 * correspondente confirma o campo.
 *
 * Isto permite corrigir automaticamente:
 *
 *   O <-> 0
 *   I <-> 1
 *   L <-> 1
 *   Z <-> 2
 *   E <-> 3
 *   A <-> 4
 *   S <-> 5
 *   G <-> 6
 *   T <-> 7
 *   B <-> 8
 *
 * sem assumir que o campo original é numérico.
 */
function recoverTd3AlphanumericCandidates(
  line2,
  maxCandidates = 64
) {
  if (
    !line2 ||
    line2.length !== 44
  ) {
    return [];
  }

  const original =
    line2.split("");

  /*
   * -------------------------------------------------------
   * Campos protegidos pelos check digits
   * -------------------------------------------------------
   */
  const fields = [
    {
      name:
        "passportNumber",

      start:
        0,

      end:
        8,

      checkIndex:
        9
    },

    {
      name:
        "personalNumber",

      start:
        28,

      end:
        41,

      checkIndex:
        42
    }
  ];

  /*
   * -------------------------------------------------------
   * Posições que realmente possuem alternativas OCR.
   * -------------------------------------------------------
   */
  const positions = [];

  for (
    const field of fields
  ) {
    for (
      let index =
        field.start;
      index <=
        field.end;
      index += 1
    ) {
      const alternatives =
        getAlternativesForPosition(
          original,
          index,
          2
        );

      if (
        alternatives.length >
        1
      ) {
        positions.push({
          field,
          index,
          alternatives
        });
      }
    }
  }

  const candidates =
    new Map();

  /*
   * -------------------------------------------------------
   * Função que verifica um candidato completo.
   * -------------------------------------------------------
   */
  function evaluate(
    chars,
    changes
  ) {
    const passportNumber =
      chars.slice(
        0,
        9
      ).join("");

    const personalNumber =
      chars.slice(
        28,
        42
      ).join("");

    const passportCheck =
      calculateMrzCheckDigit(
        passportNumber
      );

    const personalCheck =
      calculateMrzCheckDigit(
        personalNumber
      );

    if (
      passportCheck === null ||
      personalCheck === null
    ) {
      return;
    }

    /*
     * O check digit é reconstruído a partir
     * do campo que acabou de ser validado.
     */
    chars[9] =
      passportCheck;

    chars[42] =
      personalCheck;

    /*
     * O composite TD3 usa:
     *
     * 1-10
     * 14-20
     * 22-43
     *
     * em índices JS:
     *
     * 0..9
     * 13..19
     * 21..42
     */
    const compositeData =
      chars
        .slice(0, 10)
        .concat(
          chars.slice(13, 20)
        )
        .concat(
          chars.slice(21, 43)
        )
        .join("");

    const compositeCheck =
      calculateMrzCheckDigit(
        compositeData
      );

    if (
      compositeCheck === null
    ) {
      return;
    }

    chars[43] =
      compositeCheck;

    const candidate =
      chars.join("");

    /*
     * Revalidação completa dos três campos.
     */
    if (
      calculateMrzCheckDigit(
        candidate.slice(0, 9)
      ) !==
      candidate[9]
    ) {
      return;
    }

    if (
      calculateMrzCheckDigit(
        candidate.slice(28, 42)
      ) !==
      candidate[42]
    ) {
      return;
    }

    const rebuiltComposite =
      calculateMrzCheckDigit(
        candidate
          .slice(0, 10)
          .concat(
            candidate.slice(13, 20)
          )
          .concat(
            candidate.slice(21, 43)
          )
      );

    if (
      rebuiltComposite !==
      candidate[43]
    ) {
      return;
    }

    /*
     * Quanto menos alterações OCR,
     * mais confiável o candidato.
     */
    const key =
      candidate;

    const existing =
      candidates.get(key);

    const changeCount =
      Number(
        changes || 0
      );

    if (
      !existing ||
      changeCount <
        existing.changeCount
    ) {
      candidates.set(
        key,
        {
          line:
            candidate,

          changeCount,

          recoveredPassportNumber:
            candidate.slice(
              0,
              9
            ),

          recoveredPassportCheckDigit:
            candidate[9],

          recoveredPersonalNumber:
            candidate.slice(
              28,
              42
            ),

          recoveredPersonalCheckDigit:
            candidate[42],

          recoveredCompositeCheckDigit:
            candidate[43]
        }
      );
    }
  }

  /*
   * -------------------------------------------------------
   * Primeiro candidato:
   * OCR original, sem alterações.
   * -------------------------------------------------------
   */
  evaluate(
    original.slice(),
    0
  );
  /*
   * -------------------------------------------------------
   * RECUPERAÇÃO UNIVERSAL DE UMA POSIÇÃO
   * -------------------------------------------------------
   *
   * Um passaporte válido pode ter qualquer combinação
   * alfanumérica legal no número do documento.
   *
   * Portanto não devemos depender apenas de:
   *
   * O -> 0
   * I -> 1
   * etc.
   *
   * Testamos todos os caracteres permitidos pela ICAO
   * em cada posição protegida por check digit.
   *
   * A combinação somente entra como candidata quando
   * os check digits confirmam matematicamente o resultado.
   */

  const legalMrzCharacters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

  for (
    const field of
      fields
  ) {
    for (
      let index =
        field.start;
      index <=
        field.end;
      index += 1
    ) {
      for (
        const alternative of
          legalMrzCharacters
      ) {
        if (
          alternative ===
          original[index]
        ) {
          continue;
        }

        const chars =
          original.slice();

        chars[index] =
          alternative;

        evaluate(
          chars,
          1
        );

        if (
          candidates.size >=
          maxCandidates
        ) {
          break;
        }
      }

      if (
        candidates.size >=
        maxCandidates
      ) {
        break;
      }
    }

    if (
      candidates.size >=
      maxCandidates
    ) {
      break;
    }
  }
  /*
   * -------------------------------------------------------
   * Uma alteração.
   * -------------------------------------------------------
   */
  for (
    const position of positions
  ) {
    for (
      const alternative of
        position.alternatives
    ) {
      if (
        alternative ===
        original[
          position.index
        ]
      ) {
        continue;
      }

      const chars =
        original.slice();

      chars[
        position.index
      ] =
        alternative;

      evaluate(
        chars,
        1
      );

      if (
        candidates.size >=
        maxCandidates
      ) {
        break;
      }
    }

    if (
      candidates.size >=
      maxCandidates
    ) {
      break;
    }
  }

  /*
   * -------------------------------------------------------
   * Duas alterações.
   *
   * Este nível cobre, por exemplo:
   *
   *   1 erro no número do passaporte
   *   +
   *   1 erro no número pessoal
   *
   * ou dois erros no mesmo campo.
   * -------------------------------------------------------
   */
  if (
    candidates.size <
    maxCandidates
  ) {
    for (
      let first =
        0;
      first <
        positions.length;
      first += 1
    ) {
      const positionA =
        positions[first];

      for (
        let second =
          first + 1;
        second <
          positions.length;
        second += 1
      ) {
        const positionB =
          positions[second];

        /*
         * Evita combinar duas posições
         * iguais por segurança.
         */
        if (
          positionA.index ===
            positionB.index
        ) {
          continue;
        }

        for (
          const alternativeA of
            positionA.alternatives
        ) {
          if (
            alternativeA ===
            original[
              positionA.index
            ]
          ) {
            continue;
          }

          for (
            const alternativeB of
              positionB.alternatives
          ) {
            if (
              alternativeB ===
              original[
                positionB.index
              ]
            ) {
              continue;
            }

            const chars =
              original.slice();

            chars[
              positionA.index
            ] =
              alternativeA;

            chars[
              positionB.index
            ] =
              alternativeB;

            evaluate(
              chars,
              2
            );

            if (
              candidates.size >=
              maxCandidates
            ) {
              break;
            }
          }

          if (
            candidates.size >=
            maxCandidates
          ) {
            break;
          }
        }

        if (
          candidates.size >=
          maxCandidates
        ) {
          break;
        }
      }

      if (
        candidates.size >=
        maxCandidates
      ) {
        break;
      }
    }
  }

  /*
   * -------------------------------------------------------
   * Ordenação:
   *
   * 0 alterações
   * 1 alteração
   * 2 alterações
   * -------------------------------------------------------
   */
  return [
    ...candidates.values()
  ]
    .sort(
      (a, b) =>
        Number(
          a.changeCount || 0
        ) -
        Number(
          b.changeCount || 0
        )
    )
    .slice(
      0,
      maxCandidates
    );
}
/*
 * =========================================================
 * EXPANSÃO MRZ
 * =========================================================
 */

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

  let variants = [
    normalized
  ];

  /*
   * -------------------------------------------------------
   * SEGUNDA LINHA
   * -------------------------------------------------------
   */

  if (
    lineNumber === 2
  ) {
        /*
     * -----------------------------------------------------
     * CAMPOS ALFANUMÉRICOS
     * -----------------------------------------------------
     *
     * Recupera automaticamente erros OCR no:
     *
     *   - número do passaporte;
     *   - número pessoal;
     *
     * usando os check digits ICAO.
     */
    const alphanumericVariants =
      recoverTd3AlphanumericCandidates(
        normalized,
        Math.min(
          64,
          maxVariants
        )
      );

    for (
      const recovered of
        alphanumericVariants
    ) {
      variants.push(
        recovered.line
      );

      if (
        variants.length >=
        maxVariants
      ) {
        break;
      }
    }
    /*
     * DOB
     */
    const birthDateVariants =
      applyBirthDateCandidates(
        normalized,
        Math.min(
          80,
          maxVariants
        )
      );

    for (
      const recovered of
        birthDateVariants
    ) {
      variants.push(
        recovered.line
      );
    }

    /*
     * EXPIRY DATE
     *
     * NOVO:
     * recuperação dedicada da validade.
     */
    const expiryDateVariants =
      applyExpiryDateCandidates(
        normalized,
        Math.min(
          80,
          maxVariants
        )
      );

    for (
      const recovered of
        expiryDateVariants
    ) {
      variants.push(
        recovered.line
      );
    }

    /*
     * Expansão OCR direta das duas datas.
     *
     * Não incluímos os check digits 19/27 aqui
     * porque os recuperadores dedicados já tratam
     * esses campos.
     */
    const directedDatePositions = [
      13,
      14,
      15,
      16,
      17,
      18,

      21,
      22,
      23,
      24,
      25,
      26
    ];

    let dateVariants = [
      normalized
    ];

    for (
      const index of
        directedDatePositions
    ) {
      const next = [];

      for (
        const current of
          dateVariants
      ) {
        const chars =
          current.split("");

        const alternatives =
          getAlternativesForPosition(
            chars,
            index,
            2
          );

        for (
          const alternative of
            alternatives
        ) {
          const candidate =
            current.split("");

          candidate[index] =
            alternative;

          next.push(
            candidate.join("")
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

      dateVariants =
        [
          ...new Set(next)
        ].slice(
          0,
          maxVariants
        );

      if (
        !dateVariants.length
      ) {
        break;
      }
    }

    for (
      const candidate of
        dateVariants
    ) {
      variants.push(
        candidate
      );

      if (
        variants.length >=
        maxVariants
      ) {
        break;
      }
    }
  }

  /*
   * -------------------------------------------------------
   * EXPANSÃO GERAL
   * -------------------------------------------------------
   */

  const positions = [];

  for (
    let index = 0;
    index < 44;
    index += 1
  ) {
    /*
     * DOB e EXPIRY DATE já possuem recuperação
     * dedicada.
     */
    if (
      lineNumber === 2 &&
      (
        (
          index >= 13 &&
          index <= 19
        ) ||
        (
          index >= 21 &&
          index <= 27
        )
      )
    ) {
      continue;
    }

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
   * Limitamos a expansão geral para preservar
   * desempenho.
   */
  const limitedPositions =
    positions.slice(
      0,
      8
    );

  for (
    const position of
      limitedPositions
  ) {
    const next = [];

    for (
      const current of
        variants
    ) {
      const alternatives =
        getAlternativesForPosition(
          current.split(""),
          position.index,
          lineNumber
        );

      for (
        const alternative of
          alternatives
      ) {
        const candidate =
          current.split("");

        candidate[
          position.index
        ] =
          alternative;

        next.push(
          candidate.join("")
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

    const uniqueNext =
      [
        ...new Set(next)
      ];

    if (
      uniqueNext.length
    ) {
      variants =
        uniqueNext.slice(
          0,
          maxVariants
        );
    }

    if (
      variants.length >=
      maxVariants
    ) {
      break;
    }
  }

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
        background:
          "#ffffff"
      })
      .jpeg({
        quality: 94,
        chromaSubsampling:
          "4:4:4"
      })
      .toBuffer({
        resolveWithObject:
          true
      });

  const normalized =
    processed.data;

  const width =
    processed.info.width;

  const height =
    processed.info.height;

  const variants = [];

  variants.push({
    name:
      "full",

    type:
      "full",

    buffer:
      normalized,

    priority:
      3
  });

  if (
    width &&
    height
  ) {
    /*
     * MRZ principal.
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

      type:
        "mrz",

      buffer:
        primaryColor,

      priority:
        1
    });

    variants.push({
      name:
        "mrz_primary_gray",

      type:
        "mrz",

      buffer:
        primaryGray,

      priority:
        1
    });

    /*
     * MRZ fallback maior.
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

      type:
        "mrz",

      buffer:
        fallbackGray,

      priority:
        2
    });
  }

  variants.sort(
    (a, b) =>
      Number(
        a.priority || 0
      ) -
      Number(
        b.priority || 0
      )
  );

  return {
    variants,
    width,
    height
  };
}

/*
 * =========================================================
 * SERVIÇO OCR
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
          pair.line1?.length ===
            44 &&
          pair.line2?.length ===
            44 &&
          pair.line1[0] ===
            "P" &&
          pair.line1[1] ===
            "<" &&
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

        width:
          null,

        height:
          null
      };
    }

    const allResults = [];
    const mrzSources = [];

    /*
     * =====================================================
     * FASE 1 — MRZ
     * =====================================================
     */

    for (
      const variant of
        prepared.variants
    ) {
      if (
        variant.type ===
        "full"
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
        const basePass of
          passes
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
     */

    if (
      !this.hasStrongMrzCandidate(
        mrzSources
      )
    ) {
      const fullVariant =
        prepared.variants.find(
          variant =>
            variant.type ===
            "full"
        );

      if (
        fullVariant
      ) {
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
          16
        );

      const line2Variants =
        expandMrzLine(
          pair.line2,
          2,
          64
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

      const candidates = [];

      for (
        const line1 of first
      ) {
        for (
          const line2 of second
        ) {
          const passportCheckMatched =
            line2.length === 44 &&
            calculateMrzCheckDigit(
              line2.slice(
                0,
                9
              )
            ) ===
              line2[9];

          const personalCheckMatched =
            line2.length === 44 &&
            calculateMrzCheckDigit(
              line2.slice(
                28,
                42
              )
            ) ===
              line2[42];

          const compositeData =
            line2.length === 44
              ? line2
                  .slice(
                    0,
                    10
                  )
                  .concat(
                    line2.slice(
                      13,
                      20
                    )
                  )
                  .concat(
                    line2.slice(
                      21,
                      43
                    )
                  )
              : "";

          const compositeCheckMatched =
            line2.length === 44 &&
            calculateMrzCheckDigit(
              compositeData
            ) ===
              line2[43];

          const checkDigitBonus =
            (
              passportCheckMatched
                ? 35
                : 0
            ) +
            (
              personalCheckMatched
                ? 35
                : 0
            ) +
            (
              compositeCheckMatched
                ? 50
                : 0
            );

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
              ) +
              checkDigitBonus,

            passportCheckMatched,

            personalCheckMatched,

            compositeCheckMatched,

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
          Number(
            b.score || 0
          ) -
          Number(
            a.score || 0
          )
      );

      expandedPairs.push(
        ...candidates.slice(
          0,
          40
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
              ),
              pairing:
  pair.pairing || null,
            /*
             * DOB
             */
            ocrBirthDate:
              pair.line2
                ? pair.line2.slice(
                    13,
                    19
                  )
                : null,

            ocrBirthCheckDigit:
              pair.line2
                ? pair.line2[19]
                : null,

            recoveredBirthCandidates:
              pair.line2
                ? recoverBirthDateCandidates(
                    pair.line2,
                    10
                  )
                : [],

            /*
             * EXPIRY DATE
             */
            ocrExpiryDate:
              pair.line2
                ? pair.line2.slice(
                    21,
                    27
                  )
                : null,

            ocrExpiryCheckDigit:
              pair.line2
                ? pair.line2[27]
                : null,

            recoveredExpiryCandidates:
              pair.line2
                ? recoverExpiryDateCandidates(
                    pair.line2,
                    10
                  )
                : []
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
