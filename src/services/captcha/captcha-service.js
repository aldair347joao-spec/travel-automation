class CaptchaService {
  constructor() {
    this.provider =
      process.env.CAPTCHA_PROVIDER;

    this.apiUrl =
      process.env.CAPTCHA_API_URL;

    this.apiKey =
      process.env.CAPTCHA_API_KEY;
  }

  isConfigured() {
    return Boolean(
      this.provider &&
      this.apiUrl &&
      this.apiKey
    );
  }

  async createChallenge(payload) {
    if (!this.isConfigured()) {
      return {
        status: "not_configured"
      };
    }

    /*
     * Adapter preparado.
     *
     * A implementação específica será feita
     * quando definirmos o contrato autorizado
     * da API de CAPTCHA.
     */

    return {
      status: "ready",
      provider: this.provider
    };
  }

  async getChallengeResult(
    challengeId
  ) {
    if (!challengeId) {
      throw new Error(
        "challengeId required"
      );
    }

    return {
      status: "pending",
      challengeId
    };
  }
}

module.exports =
  CaptchaService;
