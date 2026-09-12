class TelegramService {
  constructor() {
    this.token =
      process.env.TELEGRAM_BOT_TOKEN;

    this.chatId =
      process.env.TELEGRAM_CHAT_ID;
  }

  configured() {
    return Boolean(
      this.token &&
      this.chatId
    );
  }

  async send(message) {
    if (!this.configured()) {
      console.log(
        "[TELEGRAM NOT CONFIGURED]",
        message
      );

      return {
        success: false,
        configured: false
      };
    }

    const response =
      await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id:
              this.chatId,

            text:
              message
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Telegram HTTP ${response.status}`
      );
    }

    return response.json();
  }

  async completed(
    application,
    client
  ) {
    const message = [
      "✅ AGENDAMENTO CONCLUÍDO",
      "",
      `Cliente: ${client.fullName}`,
      `Data: ${application.slot?.date || "-"}`,
      `Hora: ${application.slot?.time || "-"}`,
      `Referência: ${application.result.reference || "-"}`,
      `Entidade: ${application.result.entity || "-"}`,
      "",
      "Travel Automation"
    ].join("\n");

    return this.send(
      message
    );
  }

  async error(
    application,
    message
  ) {
    return this.send(
      [
        "⚠️ ERRO NO AGENDAMENTO",
        "",
        `Processo: ${application._id}`,
        `Erro: ${message}`
      ].join("\n")
    );
  }
}

module.exports =
  TelegramService;
