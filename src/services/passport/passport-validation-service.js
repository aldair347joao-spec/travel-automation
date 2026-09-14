const crypto = require("crypto");

function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
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

function parseDate(value) {
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
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  const currentYear = new Date().getUTCFullYear();
  const currentYY = currentYear % 100;

  const century = yy <= currentYY ? 2000 : 1900;

  const year = century + yy;

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

function normalizeName(value) {
  return normalizeCompact(value)
    .replace(/[^A-Z]/g, "");
}

function normalizeDateForComparison(value) {
  if (!value) {
    return null;
  }

  const parsed = parseDate(value);

  if (parsed) {
    return parsed;
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
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

  const dateOfBirth = parseDate(dateOfBirthRaw);

  const passportExpiryDate = parseDate(expiryRaw);

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
 * legacy    = old model explicitly identified
 * electronic = new electronic model explicitly identified
 * unknown   = insufficient evidence
 */
function normalizePassportType(value) {
  const type = normalizeCompact(value);

  if (
    type === "ELECTRONIC" ||
    type === "E-PASSPORT" ||
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
   * We do NOT claim NFC/chip verification from OCR.
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
   * If the document is clearly a passport but
   * no reliable model signal is available,
   * leave it unknown instead of guessing.
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
      compareField(
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
      compareField(
        "passportCountry",
        client.passportCountry,
        mrzData.issuingCountry
      )
    );

    /*
     * Name is useful but should be normalized
     * separately because MRZ names contain
     * separators and may have ordering differences.
     */
    if (client.fullName) {
      const clientName =
        normalizeName(
          client.fullName
        );

      const mrzName =
        normalizeName(
          mrzData.fullName
        );

      comparisons.push({
        field: "fullName",

        expected:
          client.fullName,

        actual:
          mrzData.fullName,

        match:
          Boolean(
            clientName &&
            mrzName
          ) &&
          (
            clientName === mrzName ||
            mrzName.includes(clientName) ||
            clientName.includes(mrzName)
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
        compareField(
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
      const ocrName =
        normalizeName(
          ocr.fullName
        );

      const mrzName =
        normalizeName(
          mrzData.fullName
        );

      comparisons.push({
        field: "fullName",

        expected:
          ocr.fullName,

        actual:
          mrzData.fullName,

        match:
          Boolean(
            ocrName &&
            mrzName
          ) &&
          (
            ocrName === mrzName ||
            ocrName.includes(mrzName) ||
            mrzName.includes(ocrName)
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
     * We don't require passportType to be known
     * to validate the MRZ itself.
     *
     * Unknown model becomes a review signal,
     * not an automatic rejection.
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

    /*
     * If everything documentary is correct but
     * the model is unknown, require review rather
     * than rejecting a potentially valid passport.
     */
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
