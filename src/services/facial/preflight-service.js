const REQUIRED_POSITIONS = [
  {
    position: 1,
    label: "frontal"
  },
  {
    position: 2,
    label: "left"
  },
  {
    position: 3,
    label: "right"
  },
  {
    position: 4,
    label: "up"
  },
  {
    position: 5,
    label: "down"
  },
  {
    position: 6,
    label: "left_up"
  },
  {
    position: 7,
    label: "right_up"
  },
  {
    position: 8,
    label: "left_down"
  },
  {
    position: 9,
    label: "right_down"
  },
  {
    position: 10,
    label: "frontal_repeat"
  }
];

const MIN_POSITION_SCORE =
  Number(
    process.env.FACIAL_PREFLIGHT_MIN_POSITION_SCORE
  ) || 0.75;

const MIN_OVERALL_SCORE =
  Number(
    process.env.FACIAL_PREFLIGHT_MIN_SCORE
  ) || 0.82;

function clampScore(value) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return null;
  }

  return Math.max(
    0,
    Math.min(1, score)
  );
}

function getExpectedPosition(
  position
) {
  return REQUIRED_POSITIONS.find(
    item =>
      item.position ===
      Number(position)
  );
}

function validatePositions(
  positions
) {
  const issues = [];

  if (!Array.isArray(positions)) {
    return {
      valid: false,
      issues: [
        "positions must be an array"
      ]
    };
  }

  if (
    positions.length !==
    REQUIRED_POSITIONS.length
  ) {
    issues.push(
      `Exactly ${REQUIRED_POSITIONS.length} facial positions are required`
    );
  }

  const seen = new Set();

  for (
    const position of positions
  ) {
    const number = Number(
      position?.position
    );

    const expected =
      getExpectedPosition(
        number
      );

    if (!expected) {
      issues.push(
        `Invalid facial position: ${number}`
      );

      continue;
    }

    if (
      seen.has(number)
    ) {
      issues.push(
        `Duplicate facial position: ${number}`
      );

      continue;
    }

    seen.add(number);

    const qualityScore =
      clampScore(
        position?.qualityScore
      );

    if (
      qualityScore === null
    ) {
      issues.push(
        `Position ${number} has no valid quality score`
      );
    } else if (
      qualityScore <
      MIN_POSITION_SCORE
    ) {
      issues.push(
        `Position ${number} quality is below the minimum`
      );
    }

    if (
      position?.faceDetected !==
      true
    ) {
      issues.push(
        `No face detected in position ${number}`
      );
    }

    if (
      position?.singleFace !==
      true
    ) {
      issues.push(
        `Position ${number} must contain exactly one face`
      );
    }
  }

  for (
    const expected
    of REQUIRED_POSITIONS
  ) {
    if (
      !seen.has(
        expected.position
      )
    ) {
      issues.push(
        `Missing position ${expected.position}: ${expected.label}`
      );
    }
  }

  return {
    valid:
      issues.length === 0,

    issues
  };
}

function calculateAverageScore(
  positions
) {
  if (
    !Array.isArray(positions)
  ) {
    return 0;
  }

  const scores =
    positions
      .map(
        position =>
          clampScore(
            position?.qualityScore
          )
      )
      .filter(
        score =>
          score !== null
      );

  if (!scores.length) {
    return 0;
  }

  return (
    scores.reduce(
      (
        total,
        score
      ) =>
        total + score,
      0
    ) /
    scores.length
  );
}

function evaluate({
  positions,
  passportMatch = null,
  consentAccepted = false
}) {
  const issues = [];

  if (
    consentAccepted !== true
  ) {
    issues.push(
      "Biometric consent has not been accepted"
    );
  }

  const positionResult =
    validatePositions(
      positions
    );

  issues.push(
    ...positionResult.issues
  );

  const averageScore =
    calculateAverageScore(
      positions
    );

  if (
    averageScore <
    MIN_OVERALL_SCORE
  ) {
    issues.push(
      "Overall facial capture quality is below the minimum"
    );
  }

  if (
    passportMatch
  ) {
    if (
      passportMatch.name ===
      false
    ) {
      issues.push(
        "Name does not match the passport data"
      );
    }

    if (
      passportMatch.dateOfBirth ===
      false
    ) {
      issues.push(
        "Date of birth does not match the passport data"
      );
    }

    if (
      passportMatch.passportNumber ===
      false
    ) {
      issues.push(
        "Passport number does not match the passport data"
      );
    }

    if (
      passportMatch.nationality ===
      false
    ) {
      issues.push(
        "Nationality does not match the passport data"
      );
    }
  }

  const passed =
    issues.length === 0;

  return {
    passed,

    status:
      passed
        ? "passed"
        : "requires_user",

    score:
      Number(
        averageScore.toFixed(4)
      ),

    minimumScore:
      MIN_OVERALL_SCORE,

    minimumPositionScore:
      MIN_POSITION_SCORE,

    positionsRequired:
      REQUIRED_POSITIONS.length,

    issues,

    checkedAt:
      new Date()
  };
}

function getInstructions() {
  return {
    positions:
      REQUIRED_POSITIONS,

    requirements: [
      "Use a well-lit environment",
      "Keep the entire face visible",
      "Do not use sunglasses",
      "Remove masks or objects covering the face",
      "Keep only one face inside the frame",
      "Keep the camera stable",
      "Follow each movement slowly",
      "Keep the passport information accurate"
    ]
  };
}

module.exports = {
  REQUIRED_POSITIONS,

  MIN_POSITION_SCORE,

  MIN_OVERALL_SCORE,

  validatePositions,

  calculateAverageScore,

  evaluate,

  getInstructions
};
