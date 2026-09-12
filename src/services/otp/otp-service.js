const crypto =
  require("crypto");

class OtpService {
  constructor() {
    this.provider =
      process.env.OTP_PROVIDER;

    this.apiUrl =
      process.env.OTP_API_URL;

    this.apiKey =
      process.env.OTP_API_KEY;
  }

  createRequest(
    applicationId
  ) {
    const requestId =
      crypto.randomUUID();

    return {
      requestId,
      applicationId,

      createdAt:
        new Date(),

      expiresAt:
        new Date(
          Date.now() +
          5 * 60 * 1000
        ),

      status: "waiting"
    };
  }

  async getCode(
    request
  ) {
    if (!request) {
      throw new Error(
        "OTP request required"
      );
    }

    /*
     * O provider real será conectado
     * aqui posteriormente.
     */

    return {
      status: "pending",
      requestId:
        request.requestId
    };
  }

  validateCode(
    code
  ) {
    return (
      typeof code === "string" &&
      /^\d{4,8}$/.test(
        code
      )
    );
  }
}

module.exports =
  OtpService;
