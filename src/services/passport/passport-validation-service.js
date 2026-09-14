const crypto = require("crypto");

function normalize(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeCompact(value) {
  return normalize(value)
    .replace(/[^A-Z0-9]/g, "");
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const compact =
    String(value)
      .replace(/\D/g, "");

  if (
    compact.length !== 6
  ) {
    return null;
  }

  const yy =
    Number(
      compact.slice(0, 2)
    );

  const mm =
    Number(
      compact.slice(2, 4)
    );

  const dd =
    Number(
      compact.slice(4, 6)
    );

  if (
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  const currentYear =
    new Date().getUTCFullYear();

  const currentYY =
    currentYear % 100;

  const century =
    yy <= currentYY
      ? 2000
      : 1900;

  return `${century + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function mrzCheckDigit(value) {
  const weights = [
    7,
    3,
    1
  ];

  let sum = 0;

  for (
    let index = 0;
    index < value.length;
    index++
  ) {
    const char =
      value[index];

    let number;

    if (
      char >= "0" &&
      char <= "9"
    ) {
      number =
        Number(char);
    } else if (
      char >= "A" &&
      char <= "Z"
    ) {
      number =
        char.charCodeAt(0) -
        55;
    } else {
      number = 0;
    }

    sum +=
      number *
      weights[
        index % 3
      ];
  }

  return String(
    sum % 10
  );
}

function validateCheckDigit(
  field,
  checkDigit
) {
  if (
    !field ||
    !/^\d$/.test(
      String(checkDigit || "")
    )
  ) {
    return false;
  }

  return (
    mrzCheckDigit(field) ===
    String(checkDigit)
  );
}

function normalizeMrzLine(line) {
  return String(line || "")
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/[^A-Z0-9<]/g, "");
}

function parsePassportMrz(
  line1,
  line2
) {
  const first =
    normalizeMrzLine(line1);

  const second =
    normalizeMrzLine(line2);

  if (
    first.length < 40 ||
    second.length < 40
  ) {
    throw new Error(
      "Invalid passport MRZ length"
    );
  }

  const documentType =
    first.slice(0, 2);

  const issuingCountry =
    first.slice(2, 5);

  const nameSection =
    first.slice(5);

  const nameParts =
    nameSection.split("<<");

  const surname =
    nameParts[0]
      .replace(/</g, " ")
      .trim();

  const givenNames =
    (nameParts[1] || "")
      .replace(/</g, " ")
      .trim();

  const passportNumber =
    second.slice(0, 9)
      .replace(/</g, "");

  const passportNumberCheck =
    second.slice(9, 10);

  const nationality =
    second.slice(10, 13);

  const dateOfBirthRaw =
    second.slice(13, 19);

  const dateOfBirthCheck =
    second.slice(19, 20);

  const sex =
    second.slice(20, 21);

  const expiryRaw =
    second.slice(21, 27);

  const expiryCheck =
    second.slice(27, 28);

  const personalNumber =
    second.slice(28, 42)
      .replace(/</g, "");

  const finalCheck =
    second.slice(43, 44);

  const composite =
    second.slice(0, 10) +
    second.slice(13, 20) +
    second.slice(21, 28) +
    second.slice(28, 43);

  const dateOfBirth =
    parseDate(
      dateOfBirthRaw
    );

  const passportExpiryDate =
    parseDate(
      expiryRaw
    );

  return {
    documentType,
    issuingCountry,
    surname,
    givenNames,
    fullName:
      `${givenNames} ${surname}`
        .trim(),

    passportNumber,
    nationality,
    dateOfBirth,
    sex,
    passportExpiryDate,
    personalNumber,

    checks: {
      passportNumber:
        validateCheckDigit(
          second.slice(0, 9),
          passportNumberCheck
        ),

      dateOfBirth:
        validateCheckDigit(
          dateOfBirthRaw,
          dateOfBirthCheck
        ),

      expiryDate:
        validateCheckDigit(
          expiryRaw,
          expiryCheck
        ),

      composite:
        validateCheckDigit(
          composite,
          finalCheck
        )
    }
  };
}

function compareField(
  name,
  expected,
  actual
) {
  const left =
    normalizeCompact(
      expected
    );

  const right =
    normalizeCompact(
      actual
    );

  return {
    field: name,
    expected: expected || null,
    actual: actual || null,
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
      const parsed =
        parsePassportMrz(
          line1,
          line2
        );

      const checks =
        Object.values(
          parsed.checks
        );

      const passed =
        checks.every(
          Boolean
        );

      return {
        success: true,
        status:
          passed
            ? "passed"
            : "failed",

        passed,

        data:
          parsed,

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

    const comparisons = [
      compareField(
        "passportNumber",
        client.passportNumber,
        mrzData.passportNumber
      ),

      compareField(
        "nationality",
        client.nationality,
        mrzData.nationality
      ),

      compareField(
        "dateOfBirth",
        client.dateOfBirth,
        mrzData.dateOfBirth
      ),

      compareField(
        "passportExpiryDate",
        client.passportExpiryDate,
        mrzData.passportExpiryDate
      ),

      compareField(
        "passportCountry",
        client.passportCountry,
        mrzData.issuingCountry
      )
    ];

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
    client
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
        mrz,
        comparison: null
      };
    }

    const comparison =
      this.compareWithClient(
        mrz.data,
        client
      );

    return {
      success:
        mrz.passed &&
        comparison.passed,

      status:
        mrz.passed &&
        comparison.passed
          ? "passed"
          : "failed",

      mrz,

      comparison,

      fingerprint:
        crypto
          .createHash("sha256")
          .update(
            JSON.stringify(
              mrz.data
            )
          )
          .digest("hex")
    };
  }
}

module.exports =
  PassportValidationService;

module.exports.parsePassportMrz =
  parsePassportMrz;
