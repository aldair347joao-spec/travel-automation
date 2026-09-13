class FacialService {
  constructor() {
    this.provider =
      process.env.FACIAL_PROVIDER ||
      null;

    this.apiUrl =
      process.env.FACIAL_API_URL ||
      null;

    this.apiKey =
      process.env.FACIAL_API_KEY ||
      null;

    this.enabled =
      process.env.BIOID_ENABLED === "true" ||
      process.env.FACIAL_ENABLED === "true";

    this.testMode =
      process.env.FACIAL_TEST_MODE === "true";
  }

  isConfigured() {
    return Boolean(
      this.provider &&
      this.apiUrl &&
      this.apiKey
    );
  }

  validatePositions(positions) {
    if (!Array.isArray(positions)) {
      throw new Error(
        "Facial positions must be an array"
      );
    }

    if (positions.length === 0) {
      throw new Error(
        "At least one facial position is required"
      );
    }

    if (positions.length > 10) {
      throw new Error(
        "Maximum of 10 facial positions"
      );
    }

    return true;
  }

  async createProfile({
    clientId,
    positions,
    videoReference
  }) {
    if (!clientId) {
      throw new Error(
        "clientId required"
      );
    }

    this.validatePositions(
      positions
    );

    return {
      success: true,

      clientId,

      provider:
        this.provider ||
        "pending",

      positions:
        positions.length,

      videoReference:
        videoReference ||
        null,

      status:
        this.isConfigured()
          ? "pending_provider"
          : "pending_provider_configuration"
    };
  }

  async verify({
    clientId,
    templateReference
  }) {
    if (!clientId) {
      throw new Error(
        "clientId required"
      );
    }

    if (!templateReference) {
      throw new Error(
        "Facial template reference required"
      );
    }

    if (this.testMode) {
      return {
        success: true,
        verified: true,
        clientId,
        templateReference,
        provider:
          this.provider ||
          "test",
        status: "verified"
      };
    }

    if (!this.enabled) {
      throw new Error(
        "Facial verification is disabled"
      );
    }

    if (!this.isConfigured()) {
      throw new Error(
        "Facial provider is not configured"
      );
    }

    throw new Error(
      `Facial provider adapter not implemented: ${this.provider}`
    );
  }
}

module.exports =
  FacialService;
