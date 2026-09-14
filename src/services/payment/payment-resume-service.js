const logger =
  require("../../utils/logger");

function isPaidStatus(status) {
  if (
    status === null ||
    status === undefined
  ) {
    return false;
  }

  const normalized =
    String(status)
      .trim()
      .toLowerCase();

  return [
    "true",
    "paid",
    "success",
    "successful",
    "completed",
    "confirmed",
    "approved"
  ].includes(normalized);
}

function normalizePaymentDetails(
  details = {}
) {
  return {
    reference:
      details.reference ??
      details.requestReference ??
      details.RequestRefNo ??
      null,

    entity:
      details.entity ??
      details.transactionId ??
      details.TransactionId ??
      null,

    transactionId:
      details.transactionId ??
      details.TransactionId ??
      null,

    paymentStatus:
      details.paymentStatus ??
      details.PaymentStatus ??
      null,

    amount:
      details.amount ??
      details.paymentAmount ??
      null,

    currency:
      details.currency ??
      details.paymentCurrency ??
      null,

    deadline:
      details.deadline ??
      details.paymentDeadline ??
      null,

    confirmationUrl:
      details.confirmationUrl ??
      null,

    requiresUser:
      details.requiresUser === true
  };
}

class PaymentResumeService {
  constructor({
    adapter,
    timeoutMs = 30000
  }) {
    this.adapter =
      adapter;

    this.timeoutMs =
      Number(timeoutMs) || 30000;
  }

  async withTimeout(
    promise,
    operation
  ) {
    let timer;

    const timeout =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(() => {
              reject(
                new Error(
                  `${operation} timed out after ${this.timeoutMs}ms`
                )
              );
            }, this.timeoutMs);
        }
      );

    try {
      return await Promise.race([
        promise,
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async resume(
    application
  ) {
    if (!application) {
      throw new Error(
        "Application is required"
      );
    }

    /*
     * O adapter pode implementar uma
     * recuperação específica da sessão
     * oficial.
     *
     * Não inventamos esse fluxo caso
     * o adapter não o suporte.
     */
    if (
      typeof this.adapter.resumePayment ===
      "function"
    ) {
      return this.resumeThroughAdapter(
        application
      );
    }

    /*
     * Compatibilidade com adapters
     * que conseguem recuperar o estado
     * diretamente através da página
     * atual.
     */
    return this.resumeFromPaymentState(
      application
    );
  }

  async resumeThroughAdapter(
    application
  ) {
    const result =
      await this.withTimeout(
        this.adapter.resumePayment(
          application
        ),
        "Payment session recovery"
      );

    if (
      result &&
      result.requiresUser === true
    ) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          result.reason ||
          "Payment recovery requires user action.",

        payment:
          result.payment ||
          null,

        confirmation:
          null
      };
    }

    return this.finishFromAdapterResult(
      application,
      result || {}
    );
  }

  async resumeFromPaymentState(
    application
  ) {
    /*
     * Reabrimos o adapter apenas quando
     * ele ainda consegue recuperar a
     * página/estado da aplicação.
     */
    await this.withTimeout(
      this.adapter.initialize(),
      "Payment session initialization"
    );

    const rawPayment =
      await this.withTimeout(
        this.adapter.getPaymentDetails(
          application,
          application.client
        ),
        "Payment details recovery"
      );

    const payment =
      normalizePaymentDetails(
        rawPayment
      );

    if (
      payment.requiresUser === true
    ) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          "Payment still requires user action.",

        payment,

        confirmation:
          null
      };
    }

    if (
      payment.paymentStatus === null ||
      payment.paymentStatus === undefined
    ) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          "Payment status could not be independently verified.",

        payment,

        confirmation:
          null
      };
    }

    if (
      !isPaidStatus(
        payment.paymentStatus
      )
    ) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          "Payment has not been confirmed.",

        payment,

        confirmation:
          null
      };
    }

    const finalization =
      await this.withTimeout(
        this.adapter.finalizeBooking(
          application,
          payment
        ),
        "Booking finalization"
      );

    if (
      finalization?.success === false
    ) {
      if (
        finalization.requiresUser === true
      ) {
        return {
          success: true,

          requiresUser: true,

          completed: false,

          reason:
            finalization.reason ||
            "Finalization requires user action.",

          payment,

          confirmation:
            null
        };
      }

      throw new Error(
        finalization.reason ||
        "Booking finalization failed"
      );
    }

    const confirmation =
      await this.withTimeout(
        this.adapter.getConfirmation(
          application,
          payment,
          finalization
        ),
        "Booking confirmation"
      );

    const normalizedConfirmation =
      normalizePaymentDetails(
        confirmation || {}
      );

    const confirmed =
      confirmation?.confirmed === true ||
      confirmation?.success === true ||
      (
        confirmation?.paymentStatus !=
          null &&
        isPaidStatus(
          confirmation.paymentStatus
        )
      );

    if (!confirmed) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          "Booking was not independently confirmed.",

        payment,

        confirmation
      };
    }

    return {
      success: true,

      requiresUser: false,

      completed: true,

      payment,

      confirmation:
        normalizedConfirmation,

      rawConfirmation:
        confirmation
    };
  }

  async finishFromAdapterResult(
    application,
    result
  ) {
    if (
      result.completed === true
    ) {
      return result;
    }

    if (
      result.requiresUser === true
    ) {
      return {
        success: true,

        requiresUser: true,

        completed: false,

        reason:
          result.reason ||
          "Payment recovery requires user action.",

        payment:
          result.payment ||
          null,

        confirmation:
          result.confirmation ||
          null
      };
    }

    if (
      result.payment
    ) {
      const payment =
        normalizePaymentDetails(
          result.payment
        );

      if (
        !isPaidStatus(
          payment.paymentStatus
        )
      ) {
        return {
          success: true,

          requiresUser: true,

          completed: false,

          reason:
            "Payment is not confirmed.",

          payment,

          confirmation:
            null
        };
      }
    }

    return result;
  }
}

module.exports =
  PaymentResumeService;
