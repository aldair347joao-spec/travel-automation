"use strict";

const logger =
  require("../../utils/logger");


/*
 * ============================================================
 * VFS WORKFLOW NAVIGATOR
 * ============================================================
 *
 * O Navigator é o cérebro do fluxo VFS.
 *
 * Responsabilidades:
 *
 * 1. Observar a página atual.
 * 2. Identificar a etapa real do VFS.
 * 3. Detectar checkpoints oficiais.
 * 4. Escolher a próxima ação.
 * 5. Verificar se a ação realmente produziu resultado.
 * 6. Recuperar slots perdidos.
 * 7. Entregar o processo ao Radar/Bot 2 quando
 *    não houver alternativa.
 *
 * IMPORTANTE:
 *
 * O Navigator NÃO contorna CAPTCHA.
 * O Navigator NÃO tenta quebrar mecanismos
 * de segurança da VFS.
 *
 * CAPTCHA e outros checkpoints oficiais são
 * devolvidos ao nível superior como requiresUser.
 *
 * Cada Navigator pertence a UMA candidatura.
 *
 * Nunca usar um Navigator de uma applicationId
 * para controlar outra applicationId.
 */


/*
 * ============================================================
 * ESTADOS DO NAVIGATOR
 * ============================================================
 */

const STATES = Object.freeze({

  UNKNOWN:
    "UNKNOWN",

  LOGIN:
    "LOGIN",

  CAPTCHA:
    "CAPTCHA",

  OTP:
    "OTP",

  DASHBOARD:
    "DASHBOARD",

  NEW_BOOKING:
    "NEW_BOOKING",

  CENTER:
    "CENTER",

  VISA_TYPE:
    "VISA_TYPE",

  AVAILABILITY:
    "AVAILABILITY",

  PAYMENT_METHOD:
    "PAYMENT_METHOD",

  PASSPORT_UPLOAD:
    "PASSPORT_UPLOAD",

  YOUR_DETAILS:
    "YOUR_DETAILS",

  FACIAL:
    "FACIAL",

  SUMMARY:
    "SUMMARY",

  CALENDAR:
    "CALENDAR",

  SERVICES:
    "SERVICES",

  REVIEW:
    "REVIEW",

  PAYMENT:
    "PAYMENT",

  CONFIRMATION:
    "CONFIRMATION"

});


/*
 * ============================================================
 * CHECKPOINTS
 * ============================================================
 */

const CHECKPOINTS = Object.freeze({

  CAPTCHA:
    "CAPTCHA_REQUIRED",

  OTP:
    "OTP_REQUIRED",

  FACIAL:
    "FACIAL_POSITION"

});


/*
 * ============================================================
 * CONFIGURAÇÃO
 * ============================================================
 */

const DEFAULTS = Object.freeze({

  maxSlotRecoveryAttempts:
    Math.max(
      1,
      Number(
        process.env.VFS_SLOT_RECOVERY_ATTEMPTS
      ) || 5
    ),

  inspectionTimeoutMs:
    Math.max(
      3000,
      Number(
        process.env.VFS_NAVIGATOR_INSPECTION_TIMEOUT_MS
      ) || 15000
    ),

  actionTimeoutMs:
    Math.max(
      3000,
      Number(
        process.env.VFS_NAVIGATOR_ACTION_TIMEOUT_MS
      ) || 30000
    ),

  recoveryDelayMs:
    Math.max(
      250,
      Number(
        process.env.VFS_NAVIGATOR_RECOVERY_DELAY_MS
      ) || 500
    )

});


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function normalizeText(
  value
) {

  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLowerCase();

}


function sleep(
  milliseconds
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );

}


function safeDate(
  value
) {

  if (!value) {
    return null;
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;

}


function slotKey(
  slot
) {

  if (!slot) {
    return "";
  }

  return [
    slot.date || "",
    slot.time || "",
    slot.id || ""
  ].join("|");

}


function uniqueSlots(
  slots
) {

  const seen =
    new Set();

  return (
    Array.isArray(slots)
      ? slots
      : []
  ).filter(
    slot => {

      const key =
        slotKey(
          slot
        );

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(
        key
      );

      return true;

    }
  );

}


/*
 * ============================================================
 * STATE ALIASES
 * ============================================================
 *
 * O VFS pode mudar texto ou URL.
 *
 * Por isso o Navigator não depende de um único nome.
 * ============================================================
 */

const STATE_ALIASES = Object.freeze({

  LOGIN: [
    "login",
    "sign in",
    "signin",
    "log in",
    "authentication"
  ],

  DASHBOARD: [
    "dashboard",
    "home",
    "main page",
    "main menu"
  ],

  NEW_BOOKING: [
    "start new booking",
    "start booking",
    "new booking",
    "iniciar nova reserva",
    "nova reserva",
    "book now",
    "appointment"
  ],

  CENTER: [
    "visa application centre",
    "visa application center",
    "application centre",
    "application center",
    "visa centre",
    "visa center",
    "luanda"
  ],

  VISA_TYPE: [
    "visa type",
    "visa category",
    "visa category/type",
    "schengen",
    "national visa",
    "national"
  ],

  AVAILABILITY: [
    "availability",
    "appointment availability",
    "no appointments",
    "appointment slots",
    "slots available",
    "continue"
  ],

  PAYMENT_METHOD: [
    "payment method",
    "payment",
    "select payment",
    "payment option"
  ],

  PASSPORT_UPLOAD: [
    "passport",
    "travel document",
    "upload document",
    "upload passport",
    "document upload"
  ],

  YOUR_DETAILS: [
    "your details",
    "applicant details",
    "personal details",
    "contact details",
    "phone",
    "email"
  ],

  FACIAL: [
    "facial",
    "facial verification",
    "face verification",
    "liveness",
    "selfie"
  ],

  SUMMARY: [
    "summary",
    "application summary",
    "review details",
    "applicant summary"
  ],

  CALENDAR: [
    "appointment calendar",
    "calendar",
    "select date",
    "select appointment",
    "choose date"
  ],

  SERVICES: [
    "services",
    "additional services",
    "service selection"
  ],

  REVIEW: [
    "review",
    "review & pay",
    "review and pay",
    "review application"
  ],

  PAYMENT: [
    "payment",
    "make payment",
    "payment details",
    "entity",
    "reference number",
    "request reference"
  ],

  CONFIRMATION: [
    "confirmation",
    "appointment confirmed",
    "booking confirmed",
    "successfully booked"
  ]

});


/*
 * ============================================================
 * URL STATE
 * ============================================================
 */

function stateFromUrl(
  url
) {

  const value =
    normalizeText(
      url
    );

  if (
    value.includes(
      "/login"
    )
  ) {
    return STATES.LOGIN;
  }

  if (
    value.includes(
      "/dashboard"
    )
  ) {
    return STATES.DASHBOARD;
  }

  if (
    value.includes(
      "/application-detail"
    )
  ) {
    return STATES.NEW_BOOKING;
  }

  if (
    value.includes(
      "/your-details"
    )
  ) {
    return STATES.YOUR_DETAILS;
  }

  if (
    value.includes(
      "/fv-instructions"
    )
  ) {
    return STATES.FACIAL;
  }

  if (
    value.includes(
      "/services"
    )
  ) {
    return STATES.SERVICES;
  }

  if (
    value.includes(
      "/review-pay"
    )
  ) {
    return STATES.REVIEW;
  }

  if (
    value.includes(
      "/book-appointment"
    )
  ) {
    return STATES.PAYMENT;
  }

  if (
    value.includes(
      "/confirmation"
    )
  ) {
    return STATES.CONFIRMATION;
  }

  return STATES.UNKNOWN;

}


/*
 * ============================================================
 * ALIAS MATCHING
 * ============================================================
 */

function aliasScore(
  text,
  aliases
) {

  const normalized =
    normalizeText(
      text
    );

  if (!normalized) {
    return 0;
  }

  let score = 0;

  for (
    const alias of aliases
  ) {

    const normalizedAlias =
      normalizeText(
        alias
      );

    if (!normalizedAlias) {
      continue;
    }

    if (
      normalized ===
      normalizedAlias
    ) {
      score += 10;
      continue;
    }

    if (
      normalized.includes(
        normalizedAlias
      )
    ) {
      score += 4;
    }

  }

  return score;

}


/*
 * ============================================================
 * CLASSIFICAÇÃO
 * ============================================================
 */

function classifyState(
  observation
) {

  const urlState =
    stateFromUrl(
      observation.url
    );

  /*
   * Checkpoints sempre têm prioridade.
   */

  if (
    observation.checkpoint?.type ===
    CHECKPOINTS.CAPTCHA
  ) {
    return STATES.CAPTCHA;
  }

  if (
    observation.checkpoint?.type ===
    CHECKPOINTS.OTP
  ) {
    return STATES.OTP;
  }

  if (
    observation.checkpoint?.type ===
    CHECKPOINTS.FACIAL
  ) {
    return STATES.FACIAL;
  }

  /*
   * A URL é uma evidência forte.
   */

  if (
    urlState !==
    STATES.UNKNOWN
  ) {

    /*
     * /services pode representar
     * disponibilidade, calendário ou serviços.
     *
     * O DOM decide entre eles.
     */
    if (
      urlState !==
      STATES.SERVICES
    ) {
      return urlState;
    }

  }

  const parts = [
    observation.title,
    observation.bodyText,
    ...(observation.buttons || []),
    ...(observation.inputs || []),
    ...(observation.selects || [])
  ];

  let bestState =
    STATES.UNKNOWN;

  let bestScore =
    0;

  for (
    const [state, aliases]
    of Object.entries(
      STATE_ALIASES
    )
  ) {

    const score =
      parts.reduce(
        (
          total,
          part
        ) =>
          total +
          aliasScore(
            part,
            aliases
          ),
        0
      );

    if (
      score >
      bestScore
    ) {

      bestScore =
        score;

      bestState =
        state;

    }

  }

  /*
   * Se estamos em /services e o DOM
   * contém datas/horários, é calendário.
   */

  if (
    urlState ===
      STATES.SERVICES &&
    (
      observation.hasCalendar ||
      observation.hasSlots
    )
  ) {
    return STATES.CALENDAR;
  }

  /*
   * Serviços reais.
   */

  if (
    urlState ===
      STATES.SERVICES
  ) {
    return STATES.SERVICES;
  }

  return bestState;

}


/*
 * ============================================================
 * VFS NAVIGATOR
 * ============================================================
 */

class VfsNavigator {

  constructor(
    site,
    options = {}
  ) {

    if (!site) {
      throw new Error(
        "VfsNavigator requires a VFS site adapter."
      );
    }

    this.site =
      site;

    this.applicationId =
      options.applicationId ||
      site.applicationId ||
      null;

    if (!this.applicationId) {
      throw new Error(
        "VfsNavigator requires applicationId."
      );
    }

    this.logger =
      options.logger ||
      logger;

    this.config = {

      ...DEFAULTS,

      ...(options.config || {})

    };

    this.state =
      STATES.UNKNOWN;

    this.previousState =
      STATES.UNKNOWN;

    this.lastObservation =
      null;

    this.lastAction =
      null;

    this.lastDecision =
      null;

    this.lastError =
      null;

    this.history =
      [];

    this.failedSlots =
      new Set();

    this.recoveryAttempts =
      0;

    this.createdAt =
      new Date();

  }


  /*
   * ==========================================================
   * APPLICATION ID PROTECTION
   * ==========================================================
   */

  assertApplication(
    application
  ) {

    const applicationId =
      application?._id?.toString?.() ||
      application?.id?.toString?.() ||
      this.applicationId;

    if (
      String(applicationId) !==
      String(this.applicationId)
    ) {

      throw new Error(
        `Navigator/application mismatch: navigator=${this.applicationId} application=${applicationId}`
      );

    }

    return true;

  }


  /*
   * ==========================================================
   * OBSERVE
   * ==========================================================
   */

  async inspect(
    application = null
  ) {

    this.assertApplication(
      application
    );

    const page =
      this.site.page;

    let url =
      "";

    let title =
      "";

    let bodyText =
      "";

    let buttons =
      [];

    let inputs =
      [];

    let selects =
      [];

    let hasCalendar =
      false;

    let hasSlots =
      false;

    if (
      page &&
      !page.isClosed()
    ) {

      url =
        page.url();

      try {

        title =
          await page.title();

      } catch {
        title =
          "";
      }

    }

    /*
     * O adapter já possui um inspector oficial.
     */

    if (
      typeof this.site.inspectCurrentDom ===
      "function"
    ) {

      try {

        await this.site.inspectCurrentDom();

      } catch (
        error
      ) {

        this.logger.warn(
          "Navigator DOM inspection failed",
          {
            applicationId:
              this.applicationId,

            error:
              error.message
          }
        );

      }

    }

    const dom =
      this.site.lastDomInspection ||
      this.site.getDomSummary?.() ||
      null;

    if (dom) {

      bodyText =
        dom.bodyText ||
        dom.text ||
        dom.visibleText ||
        "";

      buttons =
        Array.isArray(
          dom.buttons
        )
          ? dom.buttons.map(
              item =>
                typeof item ===
                  "string"
                  ? item
                  : (
                      item?.text ||
                      item?.label ||
                      item?.ariaLabel ||
                      ""
                    )
            )
          : [];

      inputs =
        Array.isArray(
          dom.inputs
        )
          ? dom.inputs.map(
              item =>
                typeof item ===
                  "string"
                  ? item
                  : [
                      item?.name,
                      item?.id,
                      item?.label,
                      item?.placeholder,
                      item?.text
                    ]
                      .filter(Boolean)
                      .join(" ")
            )
          : [];

      selects =
        Array.isArray(
          dom.selects
        )
          ? dom.selects.map(
              item =>
                typeof item ===
                  "string"
                  ? item
                  : [
                      item?.name,
                      item?.id,
                      item?.label,
                      item?.text
                    ]
                      .filter(Boolean)
                      .join(" ")
            )
          : [];

    }

    /*
     * Fallback direto no DOM.
     */

    if (
      page &&
      !page.isClosed()
    ) {

      try {

        const direct =
          await page.evaluate(
            () => {

              const normalize =
                value =>
                  String(
                    value || ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();

              const visible =
                element => {

                  if (!element) {
                    return false;
                  }

                  const rect =
                    element.getBoundingClientRect();

                  const style =
                    window.getComputedStyle(
                      element
                    );

                  return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden"
                  );

                };

              const body =
                normalize(
                  document.body?.innerText ||
                  ""
                );

              const buttonData =
                Array.from(
                  document.querySelectorAll(
                    "button, a, [role='button']"
                  )
                )
                  .filter(
                    visible
                  )
                  .map(
                    element =>
                      normalize(
                        element.innerText ||
                        element.textContent ||
                        element.getAttribute(
                          "aria-label"
                        ) ||
                        ""
                      )
                  )
                  .filter(Boolean);

              const inputData =
                Array.from(
                  document.querySelectorAll(
                    "input, textarea"
                  )
                )
                  .filter(
                    visible
                  )
                  .map(
                    element =>
                      [
                        element.name,
                        element.id,
                        element.placeholder,
                        element.getAttribute(
                          "aria-label"
                        )
                      ]
                        .filter(Boolean)
                        .join(" ")
                  );

              const selectData =
                Array.from(
                  document.querySelectorAll(
                    "select"
                  )
                )
                  .filter(
                    visible
                  )
                  .map(
                    element =>
                      [
                        element.name,
                        element.id
                      ]
                        .filter(Boolean)
                        .join(" ")
                  );

              const hasDate =
                /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(
                  body
                ) ||
                /\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b/.test(
                  body
                );

              const hasTime =
                /\b([01]?\d|2[0-3]):[0-5]\d\b/.test(
                  body
                );

              return {
                body,
                buttons:
                  buttonData,
                inputs:
                  inputData,
                selects:
                  selectData,
                hasCalendar:
                  hasDate &&
                  hasTime,
                hasSlots:
                  hasDate &&
                  hasTime
              };

            }
          );

        bodyText =
          direct.body ||
          bodyText;

        buttons =
          direct.buttons?.length
            ? direct.buttons
            : buttons;

        inputs =
          direct.inputs?.length
            ? direct.inputs
            : inputs;

        selects =
          direct.selects?.length
            ? direct.selects
            : selects;

        hasCalendar =
          direct.hasCalendar;

        hasSlots =
          direct.hasSlots;

      } catch (
        error
      ) {

        this.logger.warn(
          "Navigator direct DOM read failed",
          {
            applicationId:
              this.applicationId,

            error:
              error.message
          }
        );

      }

    }

    /*
     * Checkpoint oficial.
     */

    let checkpoint =
      this.site.lastCheckpoint ||
      null;

    if (
      typeof this.site.detectCheckpoint ===
      "function"
    ) {

      try {

        checkpoint =
          await this.site.detectCheckpoint();

      } catch (
        error
      ) {

        this.logger.warn(
          "Navigator checkpoint detection failed",
          {
            applicationId:
              this.applicationId,

            error:
              error.message
          }
        );

      }

    }

    /*
     * Adapter state.
     */

    let adapterState =
      this.site.state ||
      STATES.UNKNOWN;

    if (
      typeof this.site.detectState ===
      "function"
    ) {

      try {

        adapterState =
          await this.site.detectState();

      } catch {}

    }

    const observation = {

      applicationId:
        this.applicationId,

      url,

      title,

      bodyText,

      buttons,

      inputs,

      selects,

      hasCalendar,

      hasSlots,

      checkpoint,

      adapterState,

      inspectedAt:
        new Date()

    };

    this.previousState =
      this.state;

    this.state =
      classifyState(
        observation
      );

    this.lastObservation =
      observation;

    this.record(
      "OBSERVE",
      {
        state:
          this.state,

        adapterState,

        checkpoint:
          checkpoint?.type ||
          null,

        url
      }
    );

    return observation;

  }


  /*
   * ==========================================================
   * DECIDE
   * ==========================================================
   */

  decide(
    observation = this.lastObservation,
    application = null
  ) {

    this.assertApplication(
      application
    );

    if (!observation) {

      return {
        action:
          "INSPECT"
      };

    }

    const checkpoint =
      observation.checkpoint;

    /*
     * Checkpoints oficiais têm prioridade.
     */

    if (
      checkpoint?.type ===
      CHECKPOINTS.CAPTCHA
    ) {

      return this.decision(
        STATES.CAPTCHA,
        "WAIT_FOR_USER",
        "Official CAPTCHA checkpoint detected."
      );

    }

    if (
      checkpoint?.type ===
      CHECKPOINTS.OTP
    ) {

      return this.decision(
        STATES.OTP,
        "HANDLE_OTP",
        "Official OTP checkpoint detected."
      );

    }

    if (
      checkpoint?.type ===
      CHECKPOINTS.FACIAL
    ) {

      return this.decision(
        STATES.FACIAL,
        "HANDLE_FACIAL",
        "Official facial instruction detected."
      );

    }

    switch (
      this.state
    ) {

      case STATES.LOGIN:

        return this.decision(
          this.state,
          "LOGIN",
          "VFS login page detected."
        );

      case STATES.DASHBOARD:

        return this.decision(
          this.state,
          "START_NEW_BOOKING",
          "VFS dashboard detected."
        );

      case STATES.NEW_BOOKING:

        return this.decision(
          this.state,
          "INSPECT_BOOKING_FORM",
          "Booking entry detected."
        );

      case STATES.CENTER:

        return this.decision(
          this.state,
          "SET_CENTER",
          "Visa centre step detected."
        );

      case STATES.VISA_TYPE:

        return this.decision(
          this.state,
          "SET_VISA_TYPE",
          "Visa type step detected."
        );

      case STATES.AVAILABILITY:

        return this.decision(
          this.state,
          "CHECK_AVAILABILITY",
          "Appointment availability step detected."
        );

      case STATES.PAYMENT_METHOD:

        return this.decision(
          this.state,
          "CONTINUE",
          "Payment-method step detected."
        );

      case STATES.PASSPORT_UPLOAD:

        return this.decision(
          this.state,
          "UPLOAD_PASSPORT",
          "Passport upload step detected."
        );

      case STATES.YOUR_DETAILS:

        return this.decision(
          this.state,
          "FILL_DETAILS",
          "Applicant details step detected."
        );

      case STATES.FACIAL:

        return this.decision(
          this.state,
          "HANDLE_FACIAL",
          "Facial verification step detected."
        );

      case STATES.SUMMARY:

        return this.decision(
          this.state,
          "CONTINUE",
          "Application summary detected."
        );

      case STATES.CALENDAR:

        return this.decision(
          this.state,
          "SELECT_SLOT",
          "Appointment calendar detected."
        );

      case STATES.SERVICES:

        return this.decision(
          this.state,
          "CONTINUE",
          "Services step detected."
        );

      case STATES.REVIEW:

        return this.decision(
          this.state,
          "SELECT_REVIEW_OPTIONS",
          "Review step detected."
        );

      case STATES.PAYMENT:

        return this.decision(
          this.state,
          "EXTRACT_PAYMENT",
          "Payment page detected."
        );

      case STATES.CONFIRMATION:

        return this.decision(
          this.state,
          "COMPLETE",
          "VFS confirmation detected."
        );

      default:

        return this.decision(
          STATES.UNKNOWN,
          "REINSPECT",
          "Navigator could not confidently classify the page."
        );

    }

  }


  /*
   * ==========================================================
   * DECISION OBJECT
   * ==========================================================
   */

  decision(
    state,
    action,
    reason
  ) {

    const decision = {

      applicationId:
        this.applicationId,

      state,

      action,

      reason,

      at:
        new Date()

    };

    this.lastDecision =
      decision;

    this.record(
      "DECISION",
      decision
    );

    return decision;

  }


  /*
   * ==========================================================
   * GENERIC CONTINUE
   * ==========================================================
   */

  async continue(
    application
  ) {

    this.assertApplication(
      application
    );

    if (
      typeof this.site.continueApplication !==
      "function"
    ) {

      throw new Error(
        "VFS adapter does not provide continueApplication()."
      );

    }

    const result =
      await this.site.continueApplication(
        application
      );

    this.record(
      "CONTINUE",
      {
        success:
          result?.success !== false,

        state:
          result?.state ||
          null,

        checkpoint:
          result?.checkpoint?.type ||
          null
      }
    );

    return result;

  }


  /*
   * ==========================================================
   * SLOT SNAPSHOT
   * ==========================================================
   */

  async getAvailableSlots(
    application
  ) {

    this.assertApplication(
      application
    );

    if (
      typeof this.site.checkAvailability !==
      "function"
    ) {

      throw new Error(
        "VFS adapter does not provide checkAvailability()."
      );

    }

    const result =
      await this.site.checkAvailability(
        application
      );

    const slots =
      uniqueSlots(
        result?.slots || []
      );

    this.record(
      "AVAILABILITY",
      {
        count:
          slots.length,

        requiresUser:
          result?.requiresUser === true,

        captchaRequired:
          result?.captchaRequired === true,

        otpRequired:
          result?.otpRequired === true
      }
    );

    return {

      ...result,

      slots

    };

  }


  /*
   * ==========================================================
   * REMEMBER FAILED SLOT
   * ==========================================================
   */

  rememberFailedSlot(
    slot
  ) {

    const key =
      slotKey(
        slot
      );

    if (key) {
      this.failedSlots.add(
        key
      );
    }

  }


  /*
   * ==========================================================
   * SLOT FILTER
   * ==========================================================
   */

  filterUsableSlots(
    slots,
    application
  ) {

    const candidates =
      uniqueSlots(
        slots
      )
      .filter(
        slot =>
          !this.failedSlots.has(
            slotKey(
              slot
            )
          )
      );

    /*
     * Preferências existentes da candidatura
     * continuam a ser respeitadas pelo adapter/Bot 2.
     *
     * O Navigator não inventa preferências.
     */

    if (
      application?.preferredDates
    ) {

      const start =
        safeDate(
          application.preferredDates.start
        );

      const end =
        safeDate(
          application.preferredDates.end
        );

      if (
        start &&
        end
      ) {

        return candidates.filter(
          slot => {

            const date =
              safeDate(
                `${slot.date}T00:00:00`
              );

            if (!date) {
              return false;
            }

            return (
              date >= start &&
              date <= end
            );

          }
        );

      }

    }

    return candidates;

  }


  /*
   * ==========================================================
   * CHOOSE ALTERNATIVE
   * ==========================================================
   *
   * Ordem:
   *
   * 1. outra hora no mesmo dia;
   * 2. outro dia disponível.
   *
   * Nunca reutiliza uma vaga que já falhou.
   */

  chooseAlternativeSlot(
    slots,
    failedSlot,
    application
  ) {

    const usable =
      this.filterUsableSlots(
        slots,
        application
      );

    if (
      !usable.length
    ) {
      return null;
    }

    const failedDate =
      failedSlot?.date ||
      null;

    const sameDay =
      usable.filter(
        slot =>
          failedDate &&
          slot.date ===
            failedDate
      );

    if (
      sameDay.length
    ) {

      /*
       * Se houver horário, usamos primeiro
       * outra hora no mesmo dia.
       */

      const differentTime =
        sameDay.find(
          slot =>
            slotKey(slot) !==
            slotKey(failedSlot)
        );

      if (
        differentTime
      ) {
        return differentTime;
      }

    }

    /*
     * Depois procuramos outro dia.
     */

    const otherDay =
      usable.find(
        slot =>
          slot.date !==
          failedDate
      );

    return (
      otherDay ||
      usable[0] ||
      null
    );

  }


  /*
   * ==========================================================
   * RECUPERAÇÃO DE SLOT
   * ==========================================================
   */

  async recoverCalendarSlot(
    application,
    failedSlot = null,
    options = {}
  ) {

    this.assertApplication(
      application
    );

    const maxAttempts =
      Math.max(
        1,
        Number(
          options.maxAttempts
        ) ||
        this.config.maxSlotRecoveryAttempts
      );

    let currentFailedSlot =
      failedSlot ||
      application?.slot ||
      null;

    this.rememberFailedSlot(
      currentFailedSlot
    );

    this.recoveryAttempts =
      0;

    this.record(
      "SLOT_RECOVERY_STARTED",
      {
        failedSlot:
          currentFailedSlot
            ? slotKey(
                currentFailedSlot
              )
            : null,

        maxAttempts

      }
    );


    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt++
    ) {

      this.recoveryAttempts =
        attempt;

      await sleep(
        this.config.recoveryDelayMs
      );

      const availability =
        await this.getAvailableSlots(
          application
        );


      /*
       * Checkpoint oficial.
       */

      if (
        availability?.requiresUser ===
        true
      ) {

        this.record(
          "SLOT_RECOVERY_CHECKPOINT",
          {
            attempt,

            checkpoint:
              availability.checkpoint
                ?.type ||
              null
          }
        );

        return {

          success:
            false,

          requiresUser:
            true,

          officialCheckpoint:
            true,

          checkpoint:
            availability.checkpoint ||
            null

        };

      }


      const slots =
        availability.slots ||
        [];


      /*
       * Nenhuma vaga.
       *
       * Não ficamos presos em loop.
       * O Radar/Bot 2 assume.
       */

      if (
        slots.length === 0
      ) {

        this.record(
          "SLOT_RECOVERY_NO_AVAILABILITY",
          {
            attempt
          }
        );

        return {

          success:
            false,

          slotLost:
            true,

          handoffToRadar:
            true,

          reason:
            "No alternative appointment slot is currently available."

        };

      }


      const alternative =
        this.chooseAlternativeSlot(
          slots,
          currentFailedSlot,
          application
        );


      if (
        !alternative
      ) {

        this.record(
          "SLOT_RECOVERY_NO_ALTERNATIVE",
          {
            attempt
          }
        );

        return {

          success:
            false,

          slotLost:
            true,

          handoffToRadar:
            true,

          reason:
            "No usable alternative appointment slot was found."

        };

      }


      this.record(
        "SLOT_RECOVERY_ALTERNATIVE",
        {
          attempt,

          slot:
            slotKey(
              alternative
            )
        }
      );


      /*
       * Tentar selecionar a nova vaga.
       */

      if (
        typeof this.site.selectSlot !==
        "function"
      ) {

        return {

          success:
            false,

          handoffToRadar:
            true,

          reason:
            "VFS adapter does not provide selectSlot()."

        };

      }


      let selected;

      try {

        selected =
          await this.site.selectSlot(
            alternative,
            application
          );

      } catch (
        error
      ) {

        this.rememberFailedSlot(
          alternative
        );

        currentFailedSlot =
          alternative;

        this.lastError =
          error;

        this.record(
          "SLOT_RECOVERY_SELECTION_ERROR",
          {
            attempt,

            slot:
              slotKey(
                alternative
              ),

            error:
              error.message
          }
        );

        continue;

      }


      if (
        selected?.success !==
        false
      ) {

        /*
         * Guardar a nova vaga na candidatura.
         */

        application.slot =
          selected?.slot ||
          alternative;

        application.workflow =
          application.workflow ||
          {};

        application.workflow.lastEvent =
          "NAVIGATOR_SLOT_RECOVERED";

        application.workflow.lastReason =
          "Navigator selected an alternative appointment slot.";

        application.workflow.slotRecoveryAttempts =
          attempt;

        application.workflow.slotRecoveredAt =
          new Date();


        this.record(
          "SLOT_RECOVERED",
          {
            attempt,

            slot:
              slotKey(
                application.slot
              )
          }
        );


        return {

          success:
            true,

          slotRecovered:
            true,

          slot:
            application.slot,

          attempts:
            attempt

        };

      }


      /*
       * A seleção falhou.
       *
       * Não insistimos na mesma vaga.
       */

      this.rememberFailedSlot(
        alternative
      );

      currentFailedSlot =
        alternative;


      this.record(
        "SLOT_RECOVERY_SELECTION_FAILED",
        {
          attempt,

          slot:
            slotKey(
              alternative
            ),

          reason:
            selected?.reason ||
            "VFS rejected the selected slot."
        }
      );

    }


    /*
     * Esgotou as tentativas.
     */

    this.record(
      "SLOT_RECOVERY_EXHAUSTED",
      {
        attempts:
          this.recoveryAttempts
      }
    );

    return {

      success:
        false,

      slotLost:
        true,

      handoffToRadar:
        true,

      attempts:
        this.recoveryAttempts,

      reason:
        "Navigator exhausted appointment recovery attempts."

    };

  }


  /*
   * ==========================================================
   * SLOT LOSS
   * ==========================================================
   */

  async handleSlotLoss(
    application,
    failedSlot = null
  ) {

    this.assertApplication(
      application
    );

    const result =
      await this.recoverCalendarSlot(
        application,
        failedSlot
      );

    if (
      result?.slotRecovered
    ) {

      return result;

    }

    /*
     * Sem alternativa:
     * o Bot 2/Radar deve assumir.
     */

    if (
      result?.handoffToRadar
    ) {

      this.record(
        "HANDOFF_TO_RADAR",
        {
          reason:
            result.reason ||
            "Navigator could not recover an appointment slot."
        }
      );

      return {

        ...result,

        handoffToRadar:
          true,

        applicationId:
          this.applicationId

      };

    }

    return result;

  }


  /*
   * ==========================================================
   * VERIFY CURRENT PAGE
   * ==========================================================
   */

  async verify(
    application
  ) {

    this.assertApplication(
      application
    );

    const observation =
      await this.inspect(
        application
      );

    const decision =
      this.decide(
        observation,
        application
      );

    this.record(
      "VERIFY",
      {
        state:
          this.state,

        action:
          decision.action
      }
    );

    return {

      observation,

      decision,

      state:
        this.state,

      checkpoint:
        observation.checkpoint ||
        null

    };

  }


  /*
   * ==========================================================
   * HISTORY
   * ==========================================================
   */

  record(
    event,
    data = {}
  ) {

    const entry = {

      event,

      applicationId:
        this.applicationId,

      at:
        new Date(),

      data

    };

    this.history.push(
      entry
    );

    /*
     * Mantemos memória limitada.
     *
     * Não queremos que um processo longo
     * torne a aplicação pesada.
     */

    if (
      this.history.length >
      100
    ) {

      this.history =
        this.history.slice(
          -100
        );

    }

    this.lastAction =
      event;

    return entry;

  }


  /*
   * ==========================================================
   * STATUS
   * ==========================================================
   */

  status() {

    return {

      applicationId:
        this.applicationId,

      state:
        this.state,

      previousState:
        this.previousState,

      recoveryAttempts:
        this.recoveryAttempts,

      failedSlots:
        Array.from(
          this.failedSlots
        ),

      lastAction:
        this.lastAction,

      lastDecision:
        this.lastDecision,

      lastError:
        this.lastError
          ? {
              message:
                this.lastError.message,

              name:
                this.lastError.name
            }
          : null,

      lastObservation:
        this.lastObservation
          ? {
              url:
                this.lastObservation.url,

              adapterState:
                this.lastObservation
                  .adapterState,

              checkpoint:
                this.lastObservation
                  .checkpoint
                  ?.type ||
                null
            }
          : null,

      history:
        this.history.slice(
          -20
        )

    };

  }

}


module.exports = {

  STATES,

  CHECKPOINTS,

  VfsNavigator

};
