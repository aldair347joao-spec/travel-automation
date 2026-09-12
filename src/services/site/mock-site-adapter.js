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

    this.slotSelected = null;

    this.reference = null;

    this.entity = null;
  }

  async initialize() {
    return true;
  }

  async login() {
    return true;
  }

  async fillApplication(
    application
  ) {
    this.applicationId =
      application._id.toString();

    return true;
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
    return true;
  }

  async openCalendar() {
    return true;
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
    this.slotSelected =
      slot;

    return true;
  }

  async continueApplication() {
    return true;
  }

  async getReference() {
    if (!this.reference) {
      this.reference =
        `TA-${crypto.randomInt(
          10000000,
          99999999
        )}`;
    }

    return this.reference;
  }

  async getEntity() {
    if (!this.entity) {
      this.entity =
        `ENT-${crypto.randomInt(
          100000,
          999999
        )}`;
    }

    return this.entity;
  }

  async close() {
    this.slotSelected = null;
  }
}

module.exports =
  MockSiteAdapter;
