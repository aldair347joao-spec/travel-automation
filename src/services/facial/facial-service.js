class FacialService {
  constructor() {
    this.provider =
      process.env.FACIAL_PROVIDER;

    this.apiUrl =
      process.env.FACIAL_API_URL;

    this.apiKey =
      process.env.FACIAL_API_KEY;
  }

  isConfigured() {
    return Boolean(
      this.provider &&
      this.apiUrl &&
      this.apiKey
    );
  }

  validatePositions(
    positions
  ) {
    if (
      !Array.isArray(
        positions
      )
    ) {
      throw new Error(
        "Facial positions must be an array"
      );
    }

    if (
      positions.length > 10
    ) {
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
    this.validatePositions(
      positions
    );

    return {
      success: true,

      clientId,

      provider:
        this.provider || "pending",

      positions:
        positions.length,

      videoReference:
        videoReference || null,

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

    return {
      success: true,
      clientId,
      templateReference:
        templateReference || null,
      status: "pending"
    };
  }
}

module.exports =
  FacialService;
