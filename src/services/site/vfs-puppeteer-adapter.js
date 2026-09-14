const puppeteer =
  require("puppeteer");

const SiteAdapter =
  require("./site-adapter");

const logger =
  require("../../utils/logger");

const VFS_BASE_URL =
  process.env.VFS_BASE_URL ||
  "https://visa.vfsglobal.com/ago/en/prt";

const DEFAULT_TIMEOUT =
  Number(
    process.env.VFS_NAVIGATION_TIMEOUT_MS
  ) || 45000;

class VfsPuppeteerAdapter
  extends SiteAdapter {

  constructor({
    applicationId
  }) {
    super();

    this.applicationId =
      applicationId;

    this.browser =
      null;

    this.context =
      null;

    this.page =
      null;

    this.initialized =
      false;

    this.state =
      "UNKNOWN";
  }

  async initialize() {
    if (
      this.initialized &&
      this.page
    ) {
      return true;
    }

    this.browser =
      await puppeteer.launch({
        headless:
          process.env.PUPPETEER_HEADLESS !==
          "false",

        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage"
        ],

        defaultViewport: {
          width: 1440,
          height: 900
        }
      });

    this.context =
      await this.browser
        .createBrowserContext();

    this.page =
      await this.context.newPage();

    this.page.setDefaultTimeout(
      DEFAULT_TIMEOUT
    );

    this.page.setDefaultNavigationTimeout(
      DEFAULT_TIMEOUT
    );

    this.page.on(
      "framenavigated",
      () => {
        this.detectState()
          .catch(() => {});
      }
    );

    this.initialized =
      true;

    logger.info(
      "VFS browser initialized",
      {
        applicationId:
          this.applicationId
      }
    );

    return true;
  }

  async ensurePage() {
    if (
      !this.initialized ||
      !this.page
    ) {
      await this.initialize();
    }

    if (
      this.page.isClosed()
    ) {
      await this.close();
      await this.initialize();
    }

    return this.page;
  }

  async navigate(url) {
    const page =
      await this.ensurePage();

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          DEFAULT_TIMEOUT
      }
    );

    await page
      .waitForNetworkIdle({
        idleTime:
          500,

        timeout:
          10000
      })
      .catch(() => {});

    await this.detectState();

    return {
      success: true,

      url:
        page.url(),

      state:
        this.state
    };
  }

  async login() {
    await this.navigate(
      `${VFS_BASE_URL}/dashboard`
    );

    return {
      success: true,

      requiresUser: true,

      reason:
        "VFS login/security checkpoint must be completed through the official flow.",

      state:
        this.state
    };
  }

  async fillApplication(
    application,
    client,
    preparedData
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/application-detail`
    );

    /*
     * Os selectors reais do VFS não
     * devem ser inventados.
     *
     * Os dados ficam preparados no
     * Application e o adapter será
     * expandido quando os selectors
     * reais do DOM forem confirmados.
     */
    return {
      success: true,

      state:
        this.state,

      prepared:
        Boolean(
          preparedData
        ),

      applicationId:
        application?._id?.toString() ||
        this.applicationId,

      clientId:
        client?._id?.toString() ||
        null
    };
  }

  async requestOtp() {
    return {
      success: true,

      requiresUser: true,

      reason:
        "OTP must be requested through the official VFS flow."
    };
  }

  async submitOtp(
    code
  ) {
    if (
      !code ||
      !/^\d{4,8}$/.test(
        String(code)
      )
    ) {
      throw new Error(
        "Invalid OTP format"
      );
    }

    return {
      success: true,

      requiresUser: true,

      reason:
        "OTP submission requires selectors from the current VFS DOM."
    };
  }

  async verifyIdentity() {
    await this.navigate(
      `${VFS_BASE_URL}/fv-instructions`
    );

    /*
     * Não simulamos webcam/liveness.
     * Se o VFS exigir captura facial
     * ao vivo, o cliente participa.
     */
    return {
      success: false,

      requiresUser: true,

      reason:
        "Facial verification requires the official VFS capture flow."
    };
  }

  async openCalendar() {
    await this.navigate(
      `${VFS_BASE_URL}/services`
    );

    return {
      success: true,

      state:
        this.state
    };
  }

  async checkAvailability(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    const slots =
      await this.extractVisibleSlots(
        page,
        application
      );

    return {
      slots
    };
  }

  async extractVisibleSlots(
    page,
    application
  ) {
    const currentUrl =
      page.url();

    if (
      !currentUrl.includes(
        "/services"
      )
    ) {
      return [];
    }

    /*
     * Não assumir classes internas
     * do VFS sem confirmação do DOM.
     */
    return [];
  }

  async selectSlot(
    slot
  ) {
    if (
      !slot ||
      !slot.date
    ) {
      throw new Error(
        "Invalid slot"
      );
    }

    return {
      success: false,

      requiresUser: true,

      reason:
        "Calendar selectors must be mapped against the current VFS DOM."
    };
  }

  async continueApplication() {
    /*
     * O VFS normalmente leva a REVIEW/PAY
     * depois da seleção. Não declaramos
     * pagamento nem confirmação aqui.
     */
    await this.navigate(
      `${VFS_BASE_URL}/review-pay`
    );

    return {
      success: true,

      state:
        this.state
    };
  }

  async getPaymentDetails() {
    const page =
      await this.ensurePage();

    await this.detectState();

    const url =
      page.url();

    const text =
      await page
        .evaluate(
          () =>
            document.body?.innerText ||
            ""
        )
        .catch(
          () => ""
        );

    const urlData =
      this.parseQueryParameters(
        url
      );

    const textReference =
      this.extractTextValue(
        text,
        [
          "RequestRefNo",
          "Reference",
          "Reference No",
          "Payment Reference"
        ]
      );

    const textAmount =
      this.extractTextValue(
        text,
        [
          "Amount",
          "Total Amount",
          "Fee"
        ]
      );

    const textCurrency =
      this.extractTextValue(
        text,
        [
          "Currency"
        ]
      );

    const textDeadline =
      this.extractTextValue(
        text,
        [
          "Deadline",
          "Payment Deadline",
          "Due Date"
        ]
      );

    const paymentStatus =
      urlData.PaymentStatus ||
      this.extractTextValue(
        text,
        [
          "PaymentStatus",
          "Payment Status"
        ]
      ) ||
      null;

    return {
      reference:
        urlData.RequestRefNo ||
        textReference ||
        null,

      transactionId:
        urlData.TransactionId ||
        null,

      entity:
        urlData.TransactionId ||
        null,

      paymentStatus,

      amount:
        textAmount ||
        null,

      currency:
        textCurrency ||
        null,

      deadline:
        textDeadline ||
        null,

      confirmationUrl:
        this.isConfirmationUrl(url)
          ? url
          : null,

      url,

      text
    };
  }

  async getReference() {
    const details =
      await this.getPaymentDetails();

    return (
      details.reference ||
      null
    );
  }

  async getEntity() {
    const details =
      await this.getPaymentDetails();

    return (
      details.entity ||
      null
    );
  }

  async finalizeBooking(
    application,
    payment
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    if (
      this.state !==
      "BOOK_APPOINTMENT"
    ) {
      await this.navigate(
        `${VFS_BASE_URL}/book-appointment`
      );
    }

    /*
     * Não clicamos em controles de
     * pagamento/segurança sem selectors
     * confirmados.
     *
     * A página é aberta e o estado é
     * devolvido para o supervisor.
     */
    await this.detectState();

    const currentUrl =
      page.url();

    if (
      currentUrl.includes(
        "/confirmation"
      )
    ) {
      return {
        success: true,

        state:
          "CONFIRMATION"
      };
    }

    return {
      success: false,

      requiresUser: true,

      reason:
        "The official VFS booking/payment step requires the current confirmed DOM flow.",

      state:
        this.state,

      payment
    };
  }

  async getConfirmation() {
    const page =
      await this.ensurePage();

    await this.detectState();

    const url =
      page.url();

    const parsed =
      this.parseQueryParameters(
        url
      );

    const isConfirmation =
      this.state ===
        "CONFIRMATION" ||
      url.includes(
        "/confirmation"
      );

    if (
      !isConfirmation
    ) {
      return {
        confirmed: false,

        success: false,

        paymentStatus:
          parsed.PaymentStatus ||
          null,

        requestReference:
          parsed.RequestRefNo ||
          null,

        transactionId:
          parsed.TransactionId ||
          null,

        confirmationUrl:
          null
      };
    }

    const paymentStatus =
      parsed.PaymentStatus ||
      null;

    return {
      confirmed:
        String(
          paymentStatus
        ).toLowerCase() ===
        "true",

      success:
        String(
          paymentStatus
        ).toLowerCase() ===
        "true",

      paymentStatus,

      requestReference:
        parsed.RequestRefNo ||
        null,

      transactionId:
        parsed.TransactionId ||
        null,

      confirmationUrl:
        url
    };
  }

  parseQueryParameters(
    url
  ) {
    try {
      const parsed =
        new URL(url);

      return {
        PaymentStatus:
          parsed.searchParams.get(
            "PaymentStatus"
          ),

        RequestRefNo:
          parsed.searchParams.get(
            "RequestRefNo"
          ),

        TransactionId:
          parsed.searchParams.get(
            "TransactionId"
          ),

        token:
          parsed.searchParams.get(
            "token"
          )
      };
    } catch {
      return {};
    }
  }

  isConfirmationUrl(
    url
  ) {
    return url.includes(
      "/confirmation"
    );
  }

  extractTextValue(
    text,
    labels
  ) {
    if (!text) {
      return null;
    }

    const lines =
      text
        .split(/\r?\n/)
        .map(
          line =>
            line.trim()
        )
        .filter(Boolean);

    for (
      const label of labels
    ) {
      const exact =
        new RegExp(
          `^${this.escapeRegex(label)}\\s*[:\\-]\\s*(.+)$`,
          "i"
        );

      const found =
        lines.find(
          line =>
            exact.test(line)
        );

      if (found) {
        const match =
          found.match(exact);

        if (match?.[1]) {
          return match[1].trim();
        }
      }

      const partial =
        lines.find(
          line =>
            line
              .toLowerCase()
              .includes(
                label.toLowerCase()
              )
        );

      if (partial) {
        const value =
          partial
            .replace(
              new RegExp(
                this.escapeRegex(label),
                "i"
              ),
              ""
            )
            .replace(
              /^[:\-\s]+/,
              ""
            )
            .trim();

        if (value) {
          return value;
        }
      }
    }

    return null;
  }

  escapeRegex(
    value
  ) {
    return String(value)
      .replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
  }

  async detectState() {
    if (!this.page) {
      this.state =
        "UNKNOWN";

      return this.state;
    }

    const url =
      this.page.url();

    if (
      url.includes(
        "/dashboard"
      )
    ) {
      this.state =
        "DASHBOARD";
    } else if (
      url.includes(
        "/application-detail"
      )
    ) {
      this.state =
        "APPLICATION_DETAIL";
    } else if (
      url.includes(
        "/your-details"
      )
    ) {
      this.state =
        "YOUR_DETAILS";
    } else if (
      url.includes(
        "/fv-instructions"
      )
    ) {
      this.state =
        "FACIAL";
    } else if (
      url.includes(
        "/services"
      )
    ) {
      this.state =
        "SERVICES";
    } else if (
      url.includes(
        "/review-pay"
      )
    ) {
      this.state =
        "REVIEW_PAY";
    } else if (
      url.includes(
        "/book-appointment"
      )
    ) {
      this.state =
        "BOOK_APPOINTMENT";
    } else if (
      url.includes(
        "/confirmation"
      )
    ) {
      this.state =
        "CONFIRMATION";
    } else {
      this.state =
        "UNKNOWN";
    }

    return this.state;
  }

  async close() {
    try {
      if (
        this.context
      ) {
        await this.context.close();
      }
    } catch {}

    try {
      if (
        this.browser
      ) {
        await this.browser.close();
      }
    } catch {}

    this.page =
      null;

    this.context =
      null;

    this.browser =
      null;

    this.initialized =
      false;

    logger.info(
      "VFS browser closed",
      {
        applicationId:
          this.applicationId
      }
    );
  }
}

module.exports =
  VfsPuppeteerAdapter;
