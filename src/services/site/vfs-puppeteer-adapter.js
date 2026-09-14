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
      return;
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
      await this.initialize();
    }

    return this.page;
  }

  async navigate(
    url
  ) {
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
      url:
        page.url(),

      state:
        this.state
    };
  }

  async login(
    credentials = {}
  ) {
    /*
     * Não automatizamos CAPTCHA,
     * MFA indevido ou mecanismos
     * de segurança do VFS.
     *
     * Esta função abre o fluxo
     * oficial e devolve o estado.
     */
    await this.navigate(
      `${VFS_BASE_URL}/dashboard`
    );

    return {
      success:
        true,

      requiresUser:
        true,

      reason:
        "VFS login/security checkpoint must be completed through the official flow.",

      state:
        this.state
    };
  }

  async fillApplication(
    preparedData
  ) {
    const page =
      await this.ensurePage();

    /*
     * Os selectors específicos serão
     * configurados depois de inspeção
     * do DOM real.
     *
     * Não usamos selectors inventados.
     */
    await this.navigate(
      `${VFS_BASE_URL}/application-detail`
    );

    return {
      success:
        true,

      state:
        this.state,

      prepared:
        Boolean(
          preparedData
        )
    };
  }

  async requestOtp() {
    return {
      success:
        true,

      requiresUser:
        true,

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
      success:
        true,

      requiresUser:
        true,

      reason:
        "OTP submission requires selectors from the current VFS DOM."
    };
  }

  async verifyIdentity() {
    await this.navigate(
      `${VFS_BASE_URL}/fv-instructions`
    );

    /*
     * Se o VFS exigir captura facial
     * ao vivo, o sistema deve parar aqui
     * e solicitar a participação do cliente.
     *
     * Não simulamos uma webcam ao vivo
     * com vídeo pré-gravado.
     */
    return {
      success:
        false,

      requiresUser:
        true,

      reason:
        "Facial verification requires the official VFS capture flow."
    };
  }

  async openCalendar() {
    await this.navigate(
      `${VFS_BASE_URL}/services`
    );

    return {
      success:
        true,

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

    /*
     * O adapter deve devolver uma
     * estrutura normalizada.
     *
     * Os selectors/calendário específicos
     * serão preenchidos após inspeção do
     * DOM atual do VFS.
     */
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
    /*
     * Não assumir classes internas
     * do VFS.
     *
     * Esta função fica deliberadamente
     * conservadora até termos os selectors
     * atuais confirmados.
     */
    const currentUrl =
      page.url();

    if (
      !currentUrl.includes(
        "/services"
      )
    ) {
      return [];
    }

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
      success:
        false,

      requiresUser:
        true,

      reason:
        "Calendar selectors must be mapped against the current VFS DOM."
    };
  }

  async continueApplication() {
    await this.navigate(
      `${VFS_BASE_URL}/review-pay`
    );

    return {
      success:
        true,

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
            document.body
              ?.innerText ||
            ""
        )
        .catch(
          () => ""
        );

    return {
      url,
      text
    };
  }

  async getReference() {
    const details =
      await this.getPaymentDetails();

    const match =
      details.url.match(
        /RequestRefNo=([^&]+)/i
      );

    return (
      match
        ? decodeURIComponent(
            match[1]
          )
        : null
    );
  }

  async getEntity() {
    const details =
      await this.getPaymentDetails();

    const match =
      details.url.match(
        /TransactionId=([^&]+)/i
      );

    return (
      match
        ? decodeURIComponent(
            match[1]
          )
        : null
    );
  }

  async finalize() {
    await this.navigate(
      `${VFS_BASE_URL}/book-appointment`
    );

    return {
      success:
        true,

      state:
        this.state
    };
  }

  async parseConfirmation() {
    const page =
      await this.ensurePage();

    const url =
      page.url();

    const parsed =
      new URL(url);

    return {
      paymentStatus:
        parsed.searchParams.get(
          "PaymentStatus"
        ),

      requestReference:
        parsed.searchParams.get(
          "RequestRefNo"
        ),

      transactionId:
        parsed.searchParams.get(
          "TransactionId"
        ),

      token:
        parsed.searchParams.get(
          "token"
        ),

      confirmationUrl:
        url
    };
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
