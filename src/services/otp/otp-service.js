const crypto = require("crypto");

class OtpService {
  constructor() {
    this.provider =
      process.env.OTP_PROVIDER || null;

    this.apiUrl =
      process.env.OTP_API_URL || null;

    this.apiKey =
      process.env.OTP_API_KEY || null;

    this.enabled =
      process.env.OTP_ENABLED === "true";

    this.testMode =
      process.env.OTP_TEST_MODE === "true";

    this.testCode =
      process.env.OTP_TEST_CODE || null;

    this.ttlMs =
      Number(process.env.OTP_TTL_MS) ||
      5 * 60 * 1000;

    this.maxAttempts =
      Number(process.env.OTP_MAX_ATTEMPTS) || 5;
  }

  createRequest(applicationId) {
    const requestId =
      crypto.randomUUID();

    const expiresAt =
      new Date(
        Date.now() + this.ttlMs
      );

    return {
      requestId,
      applicationId,
      createdAt: new Date(),
      expiresAt,
      status: "waiting"
    };
  }

  async requestCode(
    request,
    destination = null
  ) {
    if (!request) {
      throw new Error(
        "OTP request required"
      );
    }

    if (this.testMode) {
      return {
        status: "sent",
        requestId:
          request.requestId,
        expiresAt:
          request.expiresAt,
        destination,
        testMode: true
      };
    }

    if (!this.enabled) {
      throw new Error(
        "OTP service is disabled"
      );
    }

    if (
      !this.provider ||
      !this.apiUrl ||
      !this.apiKey
    ) {
      throw new Error(
        "OTP provider is not configured"
      );
    }

    throw new Error(
      `OTP provider adapter not implemented: ${this.provider}`
    );
  }

  async getCode(request) {
    return this.requestCode(request);
  }

  validateCode(code) {
    return (
      typeof code === "string" &&
      /^\d{4,8}$/.test(
        code.trim()
      )
    );
  }

  async verifyCode({
    request,
    code,
    attempts = 0
  }) {
    if (!request) {
      throw new Error(
        "OTP request required"
      );
    }

    const expiresAt =
      new Date(
        request.expiresAt
      ).getTime();

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return {
        verified: false,
        status: "expired",
        requestId:
          request.requestId
      };
    }

    if (
      attempts >=
      this.maxAttempts
    ) {
      return {
        verified: false,
        status: "failed",
        requestId:
          request.requestId,
        reason:
          "maximum_attempts"
      };
    }

    if (
      !this.validateCode(code)
    ) {
      return {
        verified: false,
        status: "failed",
        requestId:
          request.requestId,
        reason:
          "invalid_format"
      };
    }

    if (!this.testMode) {
      if (!this.enabled) {
        throw new Error(
          "OTP service is disabled"
        );
      }

      throw new Error(
        `OTP verification adapter not implemented: ${
          this.provider || "none"
        }`
      );
    }

    if (!this.testCode) {
      throw new Error(
        "OTP_TEST_CODE is required in test mode"
      );
    }

    const supplied =
      Buffer.from(
        code.trim()
      );

    const expected =
      Buffer.from(
        this.testCode
      );

    const verified =
      supplied.length ===
        expected.length &&
      crypto.timingSafeEqual(
        supplied,
        expected
      );

    return {
      verified,

      status:
        verified
          ? "verified"
          : "failed",

      requestId:
        request.requestId,

      reason:
        verified
          ? null
          : "invalid_code"
    };
  }
}

module.exports = OtpService;
