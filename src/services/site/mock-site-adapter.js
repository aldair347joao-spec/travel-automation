const crypto =
  require("crypto");

const SiteAdapter =
  require("./site-adapter");

class MockSiteAdapter
  extends SiteAdapter {

  constructor() {
    super();

    this.startedAt =
      Date.now();

    this.applicationId =
      null;

    this.slotSelected =
      null;

    this.reference =
      null;

    this.entity =
      null;

    this.transactionId =
      null;

    this.paymentDetails =
      null;

    this.confirmation =
      null;
  }

  async initialize() {
    return {
      success: true
    };
  }

  async login() {
    return {
      success: true
    };
  }

  async fillApplication(
    application
  ) {
    this.applicationId =
      application._id.toString();

    return {
      success: true
    };
  }

  async requestOtp() {
    return {
      required: false
    };
  }

  async submitOtp() {
    return true;
  }

  async verifyIdentity() {
    return {
      success: true,
      verified: true
    };
  }

  async openCalendar() {
    return {
      success: true
    };
  }

  async checkAvailability() {
    const delay =
      Number(
        process.env.MOCK_SLOT_AFTER_MS
      ) || 5000;

    if (
      Date.now() -
        this.startedAt <
      delay
    ) {
      return null;
    }

    return {
      date:
        process.env.MOCK_SLOT_DATE ||
        "2026-10-15",

      time:
        process.env.MOCK_SLOT_TIME ||
        "09:00"
    };
  }

  async selectSlot(
    slot
  ) {
    if (
      !slot ||
      !slot.date
    ) {
      throw new Error(
        "Invalid mock slot"
      );
    }

    this.slotSelected =
      slot;

    return {
      success: true
    };
  }

  async continueApplication() {
    return {
      success: true
    };
  }

  async getPaymentDetails() {
    if (!this.reference) {
      this.reference =
        `TA-${crypto.randomInt(
          10000000,
          99999999
        )}`;
    }

    if (!this.entity) {
      this.entity =
        `ENT-${crypto.randomInt(
          100000,
          999999
        )}`;
    }

    if (!this.transactionId) {
      this.transactionId =
        `TX-${crypto.randomInt(
          10000000,
          99999999
        )}`;
    }

    const paymentStatus =
      String(
        process.env.MOCK_PAYMENT_STATUS ||
        "paid"
      ).toLowerCase();

    this.paymentDetails = {
      reference:
        this.reference,

      entity:
        this.entity,

      transactionId:
        this.transactionId,

      paymentStatus,

      amount:
        process.env.MOCK_PAYMENT_AMOUNT ||
        "50000",

      currency:
        process.env.MOCK_PAYMENT_CURRENCY ||
        "AOA",

      deadline:
        process.env.MOCK_PAYMENT_DEADLINE ||
        null,

      requiresUser:
        paymentStatus !== "paid"
    };

    return this.paymentDetails;
  }

  async getReference() {
    if (!this.reference) {
      await this.getPaymentDetails();
    }

    return this.reference;
  }

  async getEntity() {
    if (!this.entity) {
      await this.getPaymentDetails();
    }

    return this.entity;
  }

  async finalizeBooking() {
    const payment =
      await this.getPaymentDetails();

    if (
      payment.requiresUser
    ) {
      return {
        success: false,

        requiresUser: true,

        reason:
          "Mock payment is still pending."
      };
    }

    this.confirmation = {
      confirmed: true,

      success: true,

      paymentStatus:
        "paid",

      requestReference:
        payment.reference,

      transactionId:
        payment.transactionId,

      confirmationUrl:
        "http://mock.local/confirmation"
    };

    return {
      success: true
    };
  }

  async getConfirmation() {
    if (
      !this.confirmation
    ) {
      const payment =
        await this.getPaymentDetails();

      if (
        payment.requiresUser
      ) {
        return {
          confirmed: false,

          success: false,

          paymentStatus:
            payment.paymentStatus,

          requestReference:
            payment.reference,

          transactionId:
            payment.transactionId
        };
      }

      this.confirmation = {
        confirmed: true,

        success: true,

        paymentStatus:
          "paid",

        requestReference:
          payment.reference,

        transactionId:
          payment.transactionId,

        confirmationUrl:
          "http://mock.local/confirmation"
      };
    }

    return this.confirmation;
  }

  async close() {
    this.slotSelected =
      null;
  }
}

module.exports =
  MockSiteAdapter;
