const crypto = require("crypto");

function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCompact(value) {
  return normalize(value)
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeMrzLine(line) {
  return String(line || "")
    .toUpperCase()
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/\s/g, "")
    .replace(/[^A-Z0-9<]/g, "");
}

/**
 * Parses an MRZ date according to its semantic purpose.
 *
 * MRZ dates contain YYMMDD.
 *
 * Expiry dates:
 *   Passport expiry dates are treated as 2000-2099.
 *
 * Date of birth:
 *   Uses a plausible-age window so both 19xx and 20xx
 *   birth years can be represented correctly.
 */
function parseMrzDate(value, kind = "generic") {
  if (!value) {
    return null;
  }

  const compact = String(value).replace(/\D/g, "");

  if (compact.length !== 6) {
    return null;
  }

  const yy = Number(compact.slice(0, 2));
  const mm = Number(compact.slice(2, 4));
  const dd = Number(compact.slice(4, 6));

  if (
    !Number.isInteger(yy) ||
    !Number.isInteger(mm) ||
    !Number.isInteger(dd) ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  const currentYear = new Date().getUTCFullYear();

  let year;

  if (kind === "expiry") {
    year = 2000 + yy;
  } else if (kind === "birth") {
    const year2000 = 2000 + yy;
    const year1900 = 1900 + yy;

    const age2000 = currentYear - year2000;
    const age1900 = currentYear - year1900;

    /*
     * A passport holder's birth year should normally produce
     * an age between 0 and 120.
     *
     * Prefer the 2000s interpretation when both are possible
     * only for the genuinely younger person.
     */
    if (age2000 >= 0 && age2000 <= 120) {
      year = year2000;
    } else if (age1900 >= 0 && age1900 <= 120) {
      year = year1900;
    } else {
      return null;
    }
  } else {
    /*
     * Generic fallback compatible with the historical behavior,
     * but constrained to plausible dates.
     */
    const year2000 = 2000 + yy;
    const year1900 = 1900 + yy;

    const age2000 = currentYear - year2000;

    if (age2000 >= 0 && age2000 <= 120) {
      year = year2000;
    } else {
      year = year1900;
    }
  }

  const date = new Date(
    Date.UTC(year, mm - 1, dd)
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null;
  }

  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * Kept for compatibility with existing callers.
 *
 * Generic six-digit MRZ dates are interpreted using the
 * birth-date rules because they are the safest interpretation
 * for historical data.
 */
function parseDate(value) {
  return parseMrzDate(value, "generic");
}

function normalizeDateForComparison(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();

  /*
   * MRZ YYMMDD
   */
  if (/^\d{6}$/.test(text)) {
    return parseMrzDate(text, "generic");
  }

  /*
   * ISO date.
   */
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return text;
  }

  /*
   * Common DD/MM/YYYY and DD-MM-YYYY formats.
   */
  const europeanMatch = text.match(
    /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/
  );

  if (europeanMatch) {
    const day = Number(europeanMatch[1]);
    const month = Number(europeanMatch[2]);
    const year = Number(europeanMatch[3]);

    const parsed = new Date(
      Date.UTC(year, month - 1, day)
    );

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function compareDate(expected, actual) {
  const left = normalizeDateForComparison(expected);
  const right = normalizeDateForComparison(actual);

  return {
    expected: expected || null,
    actual: actual || null,
    match: Boolean(left && right && left === right)
  };
}

function mrzCharacterValue(char) {
  if (char >= "0" && char <= "9") {
    return Number(char);
  }

  if (char >= "A" && char <= "Z") {
    return char.charCodeAt(0) - 55;
  }

  if (char === "<") {
    return 0;
  }

  return null;
}

function mrzCheckDigit(value) {
  const weights = [7, 3, 1];

  let sum = 0;

  for (let index = 0; index < value.length; index += 1) {
    const valueNumber = mrzCharacterValue(value[index]);

    if (valueNumber === null) {
      return null;
    }

    sum += valueNumber * weights[index % 3];
  }

  return String(sum % 10);
}

function validateCheckDigit(field, checkDigit) {
  if (
    !field ||
    !/^\d$/.test(String(checkDigit || ""))
  ) {
    return false;
  }

  const expected = mrzCheckDigit(field);

  return expected === String(checkDigit);
}

function isValidTd3Line(line) {
  return /^[A-Z0-9<]{44}$/.test(line);
}

function normalizeNameTokens(value) {
  return normalize(value)
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeName(value) {
  return normalizeNameTokens(value).join("");
}

function compareNames(expected, actual) {
  const expectedTokens = normalizeNameTokens(expected);
  const actualTokens = normalizeNameTokens(actual);

  if (
    expectedTokens.length === 0 ||
    actualTokens.length === 0
  ) {
    return false;
  }

  const expectedSet = new Set(expectedTokens);
  const actualSet = new Set(actualTokens);

  if (expectedSet.size !== actualSet.size) {
    return false;
  }

  if (expectedSet.size !== expectedTokens.length) {
    /*
     * Duplicate tokens make token-set comparison unsafe.
     * Fall back to the compact normalized representation.
     */
    return normalizeName(expected) === normalizeName(actual);
  }

  for (const token of expectedSet) {
    if (!actualSet.has(token)) {
      return false;
    }
  }

  return true;
}

/**
 * ISO nationality/country normalization.
 *
 * MRZ normally contains ISO alpha-3 codes.
 * Existing client records may contain:
 *
 * AGO
 * AO
 * Angola
 * Angolano
 * Angolana
 * República de Angola
 *
 * The same approach is used for common values from
 * other countries without weakening unknown values.
 */
const COUNTRY_ALIASES = {
  AGO: "AGO",
  AO: "AGO",
  ANGOLA: "AGO",
  ANGOLANO: "AGO",
  ANGOLANA: "AGO",
  REPUBLICADEANGOLA: "AGO",
  REPUBLICAANGOLA: "AGO",

  PRT: "PRT",
  PT: "PRT",
  PORTUGAL: "PRT",
  PORTUGUES: "PRT",
  PORTUGUESA: "PRT",

  BRA: "BRA",
  BR: "BRA",
  BRASIL: "BRA",
  BRASILEIRO: "BRA",
  BRASILEIRA: "BRA",

  MOZ: "MOZ",
  MZ: "MOZ",
  MOCAMBIQUE: "MOZ",
  MOCAMBICANO: "MOZ",
  MOCAMBICANA: "MOZ",

  CPV: "CPV",
  CV: "CPV",
  CABOVERDE: "CPV",
  CABOVERDIANO: "CPV",
  CABOVERDIANA: "CPV",

  STP: "STP",
  SAOTOME: "STP",
  SAOTOMEEPRINCIPE: "STP",

  GNB: "GNB",
  GUINEBISSAU: "GNB",

  FRA: "FRA",
  FR: "FRA",
  FRANCA: "FRA",
  FRANCES: "FRA",
  FRANCESA: "FRA",

  DEU: "DEU",
  DE: "DEU",
  ALEMANHA: "DEU",
  ALEMAO: "DEU",
  ALEMA: "DEU",

  ESP: "ESP",
  ES: "ESP",
  ESPANHA: "ESP",
  ESPANHOL: "ESP",
  ESPANHOLA: "ESP",

  ITA: "ITA",
  IT: "ITA",
  ITALIA: "ITA",
  ITALIANO: "ITA",
  ITALIANA: "ITA",

  GBR: "GBR",
  GB: "GBR",
  UK: "GBR",
  REINOUNIDO: "GBR",

  USA: "USA",
  US: "USA",
  ESTADOSUNIDOS: "USA",
  AMERICANO: "USA",
  AMERICANA: "USA",

  CAN: "CAN",
  CA: "CAN",
  CANADA: "CAN",

  ZAF: "ZAF",
  ZA: "ZAF",
  AFRICADOSUL: "ZAF",

  CHN: "CHN",
  CN: "CHN",
  CHINA: "CHN",

  IND: "IND",
  IN: "IND",
  INDIA: "IND"
};

function normalizeCountry(value) {
  const compact = normalizeCompact(value);

  if (!compact) {
    return "";
  }

  return COUNTRY_ALIASES[compact] || compact;
}

function parsePassportMrz(line1, line2) {
  const first = normalizeMrzLine(line1);
  const second = normalizeMrzLine(line2);

  if (!isValidTd3Line(first)) {
    throw new Error(
      "Invalid TD3 MRZ first line: expected 44 characters"
    );
  }

  if (!isValidTd3Line(second)) {
    throw new Error(
      "Invalid TD3 MRZ second line: expected 44 characters"
    );
  }

  if (first[0] !== "P") {
    throw new Error(
      "MRZ does not identify a passport document"
    );
  }

  const documentType = first.slice(0, 2);

  const issuingCountry = first.slice(2, 5);

  const nameSection = first.slice(5, 44);

  const nameParts = nameSection.split("<<");

  const surname = (nameParts[0] || "")
    .replace(/</g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const givenNames = (nameParts[1] || "")
    .replace(/</g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fullName = `${givenNames} ${surname}`.trim();

  const passportNumberRaw = second.slice(0, 9);

  const passportNumber = passportNumberRaw
    .replace(/</g, "")
    .trim();

  const passportNumberCheck = second.slice(9, 10);

  const nationality = second.slice(10, 13);

  const dateOfBirthRaw = second.slice(13, 19);

  const dateOfBirthCheck = second.slice(19, 20);

  const sex = second.slice(20, 21);

  const expiryRaw = second.slice(21, 27);

  const expiryCheck = second.slice(27, 28);

  const personalNumberRaw = second.slice(28, 42);

  const personalNumber = personalNumberRaw
    .replace(/</g, "")
    .trim();

  const personalNumberCheck = second.slice(42, 43);

  const finalCheck = second.slice(43, 44);

  const composite =
    second.slice(0, 10) +
    second.slice(13, 20) +
    second.slice(21, 28) +
    second.slice(28, 43);

  const dateOfBirth = parseMrzDate(
    dateOfBirthRaw,
    "birth"
  );

  const passportExpiryDate = parseMrzDate(
    expiryRaw,
    "expiry"
  );

  if (!dateOfBirth) {
    throw new Error(
      "Invalid passport date of birth in MRZ"
    );
  }

  if (!passportExpiryDate) {
    throw new Error(
      "Invalid passport expiry date in MRZ"
    );
  }

  const checks = {
    passportNumber: validateCheckDigit(
      passportNumberRaw,
      passportNumberCheck
    ),

    dateOfBirth: validateCheckDigit(
      dateOfBirthRaw,
      dateOfBirthCheck
    ),

    expiryDate: validateCheckDigit(
      expiryRaw,
      expiryCheck
    ),

    personalNumber: validateCheckDigit(
      personalNumberRaw,
      personalNumberCheck
    ),

    composite: validateCheckDigit(
      composite,
      finalCheck
    )
  };

  return {
    documentType,
    issuingCountry,
    surname,
    givenNames,
    fullName,
    passportNumber,
    nationality,
    dateOfBirth,
    sex,
    passportExpiryDate,
    personalNumber,
    checks
  };
}

/*
 * The image alone cannot prove that the NFC
 * chip is functional.
 *
 * Therefore:
 *
 * legacy     = old model explicitly identified
 * electronic = new electronic model explicitly identified
 * unknown    = insufficient evidence
 */
function normalizePassportType(value) {
  const type = normalizeCompact(value);

  if (
    type === "ELECTRONIC" ||
    type === "EPASSPORT" ||
    type === "EPASSPORT" ||
    type === "BIOMETRIC"
  ) {
    return "electronic";
  }

  if (
    type === "LEGACY" ||
    type === "OLD" ||
    type === "OLDMODEL" ||
    type === "STANDARD"
  ) {
    return "legacy";
  }

  return "unknown";
}

function detectPassportType({
  declaredType,
  ocrText,
  documentType,
  issuingCountry
} = {}) {
  const declared = normalizePassportType(
    declaredType
  );

  if (declared !== "unknown") {
    return {
      type: declared,
      confidence: 1,
      source: "declared"
    };
  }

  const text = normalize(
    ocrText
  );

  const compact = normalizeCompact(
    ocrText
  );

  /*
   * These signals are intentionally conservative.
   *
   * OCR cannot prove NFC/chip functionality.
   */
  const electronicSignals = [
    "ELECTRONIC",
    "ELECTRONICPASSPORT",
    "EPASSPORT",
    "PASSAPORTEELECTRONICO"
  ];

  const hasElectronicSignal =
    electronicSignals.some(
      signal =>
        compact.includes(signal)
    );

  if (
    issuingCountry === "AGO" &&
    hasElectronicSignal
  ) {
    return {
      type: "electronic",
      confidence: 0.9,
      source: "ocr"
    };
  }

  /*
   * A valid passport without a reliable model
   * signal remains unknown instead of being guessed.
   */
  if (
    documentType &&
    String(documentType)
      .toUpperCase()
      .startsWith("P")
  ) {
    return {
      type: "unknown",
      confidence: 0,
      source: "insufficient_evidence"
    };
  }

  if (text) {
    return {
      type: "unknown",
      confidence: 0,
      source: "insufficient_evidence"
    };
  }

  return {
    type: "unknown",
    confidence: 0,
    source: "not_available"
  };
}

function isExpired(dateValue) {
  if (!dateValue) {
    return true;
  }

  const expiry = new Date(
    `${dateValue}T23:59:59.999Z`
  );

  return (
    Number.isNaN(expiry.getTime()) ||
    expiry.getTime() < Date.now()
  );
}

function compareField(
  name,
  expected,
  actual
) {
  const left =
    normalizeCompact(expected);

  const right =
    normalizeCompact(actual);

  return {
    field: name,

    expected:
      expected || null,

    actual:
      actual || null,

    match:
      Boolean(left) &&
      Boolean(right) &&
      left === right
  };
}

function compareCountryField(
  name,
  expected,
  actual
) {
  const left =
    normalizeCountry(expected);

  const right =
    normalizeCountry(actual);

  return {
    field: name,

    expected:
      expected || null,

    actual:
      actual || null,

    normalizedExpected:
      left || null,

    normalizedActual:
      right || null,

    match:
      Boolean(left) &&
      Boolean(right) &&
      left === right
  };
}

class PassportValidationService {
  validateMrz({
    line1,
    line2
  }) {
    try {
      const data =
        parsePassportMrz(
          line1,
          line2
        );

      const checks =
        data.checks;

      const passed =
        Object.values(checks)
          .every(Boolean);

      return {
        success: true,

        status:
          passed
            ? "passed"
            : "failed",

        passed,

        data,

        errors:
          passed
            ? []
            : [
                "One or more MRZ check digits are invalid"
              ]
      };
    } catch (error) {
      return {
        success: false,

        status: "failed",

        passed: false,

        data: null,

        errors: [
          error.message
        ]
      };
    }
  }

  compareWithClient(
    mrzData,
    client
  ) {
    if (
      !mrzData ||
      !client
    ) {
      return {
        passed: false,

        comparisons: [],

        mismatches: [
          "Missing MRZ or client data"
        ]
      };
    }

    const comparisons = [];

    comparisons.push(
      compareField(
        "passportNumber",
        client.passportNumber,
        mrzData.passportNumber
      )
    );

    comparisons.push(
      compareCountryField(
        "nationality",
        client.nationality,
        mrzData.nationality
      )
    );

    comparisons.push(
      compareDate(
        client.dateOfBirth,
        mrzData.dateOfBirth
      )
    );

    comparisons[
      comparisons.length - 1
    ].field = "dateOfBirth";

    comparisons.push(
      compareDate(
        client.passportExpiryDate,
        mrzData.passportExpiryDate
      )
    );

    comparisons[
      comparisons.length - 1
    ].field =
      "passportExpiryDate";

    comparisons.push(
      compareCountryField(
        "passportCountry",
        client.passportCountry,
        mrzData.issuingCountry
      )
    );

    /*
     * MRZ names are commonly represented as:
     *
     * SURNAME<<GIVEN<NAMES
     *
     * while the client may contain:
     *
     * GIVEN NAMES SURNAME
     *
     * Compare normalized tokens instead of requiring
     * the exact order.
     */
    if (client.fullName) {
      comparisons.push({
        field: "fullName",

        expected:
          client.fullName,

        actual:
          mrzData.fullName,

        match:
          compareNames(
            client.fullName,
            mrzData.fullName
          )
      });
    }

    const mismatches =
      comparisons
        .filter(
          item =>
            !item.match
        )
        .map(
          item =>
            item.field
        );

    return {
      passed:
        mismatches.length === 0,

      comparisons,

      mismatches
    };
  }

  validateExpiry(
    mrzData
  ) {
    if (
      !mrzData ||
      !mrzData.passportExpiryDate
    ) {
      return {
        passed: false,
        expired: true,
        reason:
          "Passport expiry date is unavailable"
      };
    }

    const expired =
      isExpired(
        mrzData.passportExpiryDate
      );

    return {
      passed: !expired,

      expired,

      expiryDate:
        mrzData.passportExpiryDate,

      reason:
        expired
          ? "Passport is expired"
          : null
    };
  }

  compareOcrWithMrz({
    ocr,
    mrzData
  }) {
    if (
      !ocr ||
      !mrzData
    ) {
      return {
        passed: false,

        comparisons: [],

        mismatches: [
          "OCR or MRZ data is missing"
        ]
      };
    }

    const comparisons = [];

    if (ocr.passportNumber) {
      comparisons.push(
        compareField(
          "passportNumber",
          ocr.passportNumber,
          mrzData.passportNumber
        )
      );
    }

    if (ocr.nationality) {
      comparisons.push(
        compareCountryField(
          "nationality",
          ocr.nationality,
          mrzData.nationality
        )
      );
    }

    if (ocr.dateOfBirth) {
      const result =
        compareDate(
          ocr.dateOfBirth,
          mrzData.dateOfBirth
        );

      comparisons.push({
        field: "dateOfBirth",

        expected:
          ocr.dateOfBirth,

        actual:
          mrzData.dateOfBirth,

        match:
          result.match
      });
    }

    if (ocr.passportExpiryDate) {
      const result =
        compareDate(
          ocr.passportExpiryDate,
          mrzData.passportExpiryDate
        );

      comparisons.push({
        field:
          "passportExpiryDate",

        expected:
          ocr.passportExpiryDate,

        actual:
          mrzData.passportExpiryDate,

        match:
          result.match
      });
    }

    if (ocr.fullName) {
      comparisons.push({
        field: "fullName",

        expected:
          ocr.fullName,

        actual:
          mrzData.fullName,

        match:
          compareNames(
            ocr.fullName,
            mrzData.fullName
          )
      });
    }

    const mismatches =
      comparisons
        .filter(
          item =>
            !item.match
        )
        .map(
          item =>
            item.field
        );

    return {
      passed:
        mismatches.length === 0,

      comparisons,

      mismatches
    };
  }

  validate({
    line1,
    line2,
    client,
    ocr = null,
    passportType = null,
    ocrText = null
  }) {
    const mrz =
      this.validateMrz({
        line1,
        line2
      });

    if (!mrz.success) {
      return {
        success: false,

        status: "failed",

        passportType:
          "unknown",

        mrz,

        comparison: null,

        expiry: null,

        ocrComparison: null,

        issues: mrz.errors
      };
    }

    const detectedType =
      detectPassportType({
        declaredType:
          passportType,

        ocrText,

        documentType:
          mrz.data.documentType,

        issuingCountry:
          mrz.data.issuingCountry
      });

    const comparison =
      this.compareWithClient(
        mrz.data,
        client
      );

    const expiry =
      this.validateExpiry(
        mrz.data
      );

    let ocrComparison = null;

    if (ocr) {
      ocrComparison =
        this.compareOcrWithMrz({
          ocr,
          mrzData:
            mrz.data
        });
    }

    const issues = [];

    if (!mrz.passed) {
      issues.push(
        "MRZ check digits are invalid"
      );
    }

    if (!comparison.passed) {
      issues.push(
        ...comparison.mismatches.map(
          field =>
            `Client/MRZ mismatch: ${field}`
        )
      );
    }

    if (!expiry.passed) {
      issues.push(
        expiry.reason ||
        "Passport expiry validation failed"
      );
    }

    if (
      ocrComparison &&
      !ocrComparison.passed
    ) {
      issues.push(
        ...ocrComparison.mismatches.map(
          field =>
            `OCR/MRZ mismatch: ${field}`
        )
      );
    }

    /*
     * Unknown passport model is a review signal,
     * not a documentary rejection.
     */
    if (
      detectedType.type === "unknown"
    ) {
      issues.push(
        "Passport model could not be determined automatically"
      );
    }

    const hardValidationPassed =
      mrz.passed &&
      comparison.passed &&
      expiry.passed &&
      (
        !ocrComparison ||
        ocrComparison.passed
      );

    const finalStatus =
      hardValidationPassed
        ? (
            detectedType.type ===
            "unknown"
              ? "requires_user"
              : "passed"
          )
        : "failed";

    return {
      success:
        finalStatus ===
        "passed",

      status:
        finalStatus,

      passed:
        finalStatus ===
        "passed",

      passportType:
        detectedType.type,

      passportTypeDetection:
        detectedType,

      mrz,

      comparison,

      expiry,

      ocrComparison,

      issues,

      fingerprint:
        crypto
          .createHash("sha256")
          .update(
            JSON.stringify({
              mrz:
                mrz.data,

              passportType:
                detectedType.type
            })
          )
          .digest("hex")
    };
  }
}

module.exports =
  PassportValidationService;

module.exports.parsePassportMrz =
  parsePassportMrz;

module.exports.detectPassportType =
  detectPassportType;
