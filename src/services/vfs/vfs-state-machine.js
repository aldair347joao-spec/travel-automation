const STATES = Object.freeze({
  UNKNOWN: "UNKNOWN",
  DASHBOARD: "DASHBOARD",
  APPLICATION_DETAIL: "APPLICATION_DETAIL",
  YOUR_DETAILS: "YOUR_DETAILS",
  FACIAL: "FACIAL",
  SERVICES: "SERVICES",
  CALENDAR: "CALENDAR",
  SLOT_FOUND: "SLOT_FOUND",
  REVIEW_PAY: "REVIEW_PAY",
  BOOK_APPOINTMENT: "BOOK_APPOINTMENT",
  CONFIRMATION: "CONFIRMATION",
  REQUIRES_USER: "REQUIRES_USER"
});

function fromUrl(url = "") {
  const value = String(url).toLowerCase();

  if (value.includes("/confirmation")) {
    return STATES.CONFIRMATION;
  }

  if (value.includes("/book-appointment")) {
    return STATES.BOOK_APPOINTMENT;
  }

  if (value.includes("/review-pay")) {
    return STATES.REVIEW_PAY;
  }

  if (value.includes("/services")) {
    return STATES.SERVICES;
  }

  if (value.includes("/fv-instructions")) {
    return STATES.FACIAL;
  }

  if (value.includes("/your-details")) {
    return STATES.YOUR_DETAILS;
  }

  if (value.includes("/application-detail")) {
    return STATES.APPLICATION_DETAIL;
  }

  if (value.includes("/dashboard")) {
    return STATES.DASHBOARD;
  }

  return STATES.UNKNOWN;
}

function detect({ url = "", markers = [] } = {}) {
  const urlState = fromUrl(url);

  if (urlState !== STATES.UNKNOWN) {
    return urlState;
  }

  const text = markers
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("review & pay") ||
    text.includes("review and pay")
  ) {
    return STATES.REVIEW_PAY;
  }

  if (text.includes("book appointment")) {
    return STATES.BOOK_APPOINTMENT;
  }

  if (
    text.includes("facial") ||
    text.includes("facial verification")
  ) {
    return STATES.FACIAL;
  }

  if (
    text.includes("appointment calendar") ||
    text.includes("select date")
  ) {
    return STATES.CALENDAR;
  }

  if (
    text.includes("service") ||
    text.includes("additional service")
  ) {
    return STATES.SERVICES;
  }

  return STATES.UNKNOWN;
}

const transitions = Object.freeze({
  [STATES.UNKNOWN]: Object.values(STATES),

  [STATES.DASHBOARD]: [
    STATES.APPLICATION_DETAIL,
    STATES.REQUIRES_USER
  ],

  [STATES.APPLICATION_DETAIL]: [
    STATES.YOUR_DETAILS,
    STATES.REQUIRES_USER
  ],

  [STATES.YOUR_DETAILS]: [
    STATES.FACIAL,
    STATES.SERVICES,
    STATES.REQUIRES_USER
  ],

  [STATES.FACIAL]: [
    STATES.YOUR_DETAILS,
    STATES.SERVICES,
    STATES.REQUIRES_USER
  ],

  [STATES.SERVICES]: [
    STATES.CALENDAR,
    STATES.REQUIRES_USER
  ],

  [STATES.CALENDAR]: [
    STATES.SLOT_FOUND,
    STATES.REQUIRES_USER
  ],

  [STATES.SLOT_FOUND]: [
    STATES.REVIEW_PAY,
    STATES.CALENDAR,
    STATES.REQUIRES_USER
  ],

  [STATES.REVIEW_PAY]: [
    STATES.BOOK_APPOINTMENT,
    STATES.REQUIRES_USER
  ],

  [STATES.BOOK_APPOINTMENT]: [
    STATES.CONFIRMATION,
    STATES.REQUIRES_USER
  ],

  [STATES.CONFIRMATION]: [],

  [STATES.REQUIRES_USER]: []
});

function canTransition(from, to) {
  if (from === to) {
    return true;
  }

  return Boolean(
    transitions[from]?.includes(to)
  );
}

class VfsStateMachine {
  constructor(initialState = STATES.UNKNOWN) {
    this.state = initialState;
    this.history = [];
  }

  transition(nextState, metadata = {}) {
    if (!canTransition(this.state, nextState)) {
      throw new Error(
        `Invalid VFS state transition: ${this.state} -> ${nextState}`
      );
    }

    const previous = this.state;

    this.state = nextState;

    this.history.push({
      from: previous,
      to: nextState,
      at: new Date(),
      metadata
    });

    return this.state;
  }

  detectAndTransition(input = {}) {
    const detected = detect(input);

    if (
      detected === STATES.UNKNOWN ||
      detected === this.state
    ) {
      return this.state;
    }

    if (
      canTransition(
        this.state,
        detected
      )
    ) {
      return this.transition(
        detected,
        {
          detected: true
        }
      );
    }

    this.history.push({
      from: this.state,
      to: detected,
      at: new Date(),
      metadata: {
        detected: true,
        transitionRejected: true
      }
    });

    return this.state;
  }

  reset(state = STATES.UNKNOWN) {
    this.state = state;
    this.history = [];

    return this.state;
  }

  status() {
    return {
      state: this.state,
      history: this.history.slice(-20)
    };
  }
}

module.exports = {
  STATES,
  fromUrl,
  detect,
  canTransition,
  VfsStateMachine
};
