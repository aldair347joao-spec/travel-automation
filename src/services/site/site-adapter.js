class SiteAdapter {
  async initialize() {
    throw new Error(
      "initialize() not implemented"
    );
  }

  async login() {
    throw new Error(
      "login() not implemented"
    );
  }

  async fillApplication(
    application,
    client,
    preparedData
  ) {
    throw new Error(
      "fillApplication() not implemented"
    );
  }

  async requestOtp() {
    throw new Error(
      "requestOtp() not implemented"
    );
  }

  async submitOtp(
    code
  ) {
    throw new Error(
      "submitOtp() not implemented"
    );
  }

  async verifyIdentity(
    application,
    client
  ) {
    throw new Error(
      "verifyIdentity() not implemented"
    );
  }

  async openCalendar(
    application
  ) {
    throw new Error(
      "openCalendar() not implemented"
    );
  }

  async checkAvailability(
    application
  ) {
    throw new Error(
      "checkAvailability() not implemented"
    );
  }

  async selectSlot(
    slot,
    application
  ) {
    throw new Error(
      "selectSlot() not implemented"
    );
  }

  async continueApplication(
    application
  ) {
    throw new Error(
      "continueApplication() not implemented"
    );
  }

  /*
   * Compatibilidade com o fluxo
   * anterior.
   */
  async getReference() {
    throw new Error(
      "getReference() not implemented"
    );
  }

  async getEntity() {
    throw new Error(
      "getEntity() not implemented"
    );
  }

  /*
   * Nova etapa:
   *
   * REVIEW_PAY
   *     ↓
   * PAYMENT DETAILS
   *
   * Deve retornar, quando disponível:
   * - reference
   * - entity
   * - transactionId
   * - paymentStatus
   * - amount
   * - currency
   * - deadline
   */
  async getPaymentDetails(
    application
  ) {
    throw new Error(
      "getPaymentDetails() not implemented"
    );
  }

  /*
   * Nova etapa:
   *
   * BOOK_APPOINTMENT
   *
   * Importante:
   * esta função NÃO deve assumir que
   * a marcação foi concluída apenas
   * porque a página foi aberta.
   *
   * O resultado precisa indicar
   * explicitamente:
   * - success
   * - requiresUser
   * - reason
   * - state
   */
  async finalizeBooking(
    application,
    payment
  ) {
    throw new Error(
      "finalizeBooking() not implemented"
    );
  }

  /*
   * Confirmação final:
   *
   * /confirmation
   *
   * Deve validar o resultado real
   * da marcação/pagamento.
   */
  async getConfirmation(
    application
  ) {
    throw new Error(
      "getConfirmation() not implemented"
    );
  }

  /*
   * Encerramento da sessão.
   *
   * Os adapters que utilizarem browser,
   * context ou outros recursos podem
   * sobrescrever este método.
   */
  async close() {}
}

module.exports =
  SiteAdapter;
