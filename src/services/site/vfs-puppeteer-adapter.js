"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const {
  getCredentialsForAutomation,
  markAutomationActive
} = require("../admin/admin-control-service");
const SiteAdapter = require("./site-adapter");
const VfsDomInspector = require("./vfs-dom-inspector");
const logger = require("../../utils/logger");

const VFS_BASE_URL =
  process.env.VFS_BASE_URL ||
  "https://visa.vfsglobal.com/ago/en/prt";

const DEFAULT_TIMEOUT =
  Number(process.env.VFS_NAVIGATION_TIMEOUT_MS) || 45000;

const MAX_PASSPORT_BYTES =
  2 * 1024 * 1024;

const CHECKPOINT_TERMS = {
  captcha: [
    "captcha",
    "recaptcha",
    "i'm not a robot",
    "im not a robot",
    "security verification",
    "verify you are human"
  ],

  otp: [
    "otp",
    "one time password",
    "one-time password",
    "verification code",
    "verification otp",
    "security code"
  ],

  passport: [
    "passport",
    "passport copy",
    "passport document",
    "travel document"
  ],

  facial: [
    "facial",
    "face verification",
    "facial verification",
    "facial recognition",
    "liveness",
    "selfie",
    "camera"
  ],

  confirmation: [
    "appointment confirmed",
    "appointment confirmation",
    "booking confirmed",
    "booking confirmation"
  ]
};

class VfsPuppeteerAdapter extends SiteAdapter {
  constructor({ applicationId }) {
    super();

    this.applicationId =
      applicationId;

    this.browser = null;
    this.context = null;
    this.page = null;

    this.initialized = false;
    this.state = "UNKNOWN";

    this.domInspector =
      new VfsDomInspector({
        applicationId:
          this.applicationId
      });

    this.lastDomInspection = null;
    this.lastCheckpoint = null;
    this.lastSlotSnapshot = [];
  }

  /*
   * ============================================================
   * BROWSER
   * ============================================================
   */

  async initialize() {
  if (
    this.initialized &&
    this.page
  ) {
    return true;
  }

  const proxyHost =
    String(
      process.env.VFS_PROXY_HOST || ""
    ).trim();

  const proxyPort =
    String(
      process.env.VFS_PROXY_PORT || ""
    ).trim();

  const proxyUsername =
    String(
      process.env.VFS_PROXY_USERNAME || ""
    ).trim();

  const proxyPassword =
    String(
      process.env.VFS_PROXY_PASSWORD || ""
    ).trim();

  const proxyConfigured =
    Boolean(
      proxyHost &&
      proxyPort
    );

  const browserArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage"
  ];

  if (proxyConfigured) {
    browserArgs.push(
      `--proxy-server=http://${proxyHost}:${proxyPort}`
    );
  }

  this.browser =
    await puppeteer.launch({
      headless:
        process.env.PUPPETEER_HEADLESS !==
        "false",

      args:
        browserArgs,

      defaultViewport: {
        width: 1440,
        height: 900
      }
    });

  this.context =
    await this.browser.createBrowserContext();

  this.page =
    await this.context.newPage();

  if (
    proxyConfigured &&
    proxyUsername &&
    proxyPassword
  ) {
    await this.page.authenticate({
      username:
        proxyUsername,

      password:
        proxyPassword
    });
  }

  this.page.setDefaultTimeout(
    DEFAULT_TIMEOUT
  );

  this.page.setDefaultNavigationTimeout(
    DEFAULT_TIMEOUT
  );

  /*
   * ============================================================
   * TEMPORARY PROXY TEST
   * ============================================================
   *
   * Only runs when:
   *
   * VFS_PROXY_TEST=true
   *
   * Remove the environment variable after the test.
   */

  if (
    proxyConfigured &&
    process.env.VFS_PROXY_TEST ===
      "true"
  ) {
    try {
      await this.page.goto(
        "https://ipapi.co/json/",
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            DEFAULT_TIMEOUT
        }
      );

      const proxyInfo =
        await this.page.evaluate(
          () => {
            try {
              return JSON.parse(
                document.body.innerText
              );
            } catch {
              return {
                raw:
                  document.body.innerText
              };
            }
          }
        );

      logger.info(
        "VFS RESIDENTIAL PROXY TEST",
        {
          applicationId:
            this.applicationId,

          proxyEnabled:
            proxyConfigured,

          ip:
            proxyInfo?.ip ||
            null,

          country:
            proxyInfo?.country_name ||
            null,

          countryCode:
            proxyInfo?.country_code ||
            null,

          city:
            proxyInfo?.city ||
            null,

          region:
            proxyInfo?.region ||
            null
        }
      );
    } catch (error) {
      logger.error(
        "VFS RESIDENTIAL PROXY TEST FAILED",
        {
          applicationId:
            this.applicationId,

          proxyEnabled:
            proxyConfigured,

          error:
            error?.message ||
            String(error)
        }
      );
    }
  }

  this.page.on(
    "framenavigated",
    () => {
      this.detectState()
        .catch(() => {});
    }
  );

  this.page.on(
    "close",
    () => {
      this.initialized = false;
      this.page = null;
    }
  );

  this.initialized = true;

  logger.info(
    "VFS browser initialized",
    {
      applicationId:
        this.applicationId,

      proxyEnabled:
        proxyConfigured
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

    if (this.page.isClosed()) {
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
        idleTime: 500,
        timeout: 10000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,
      url:
        page.url(),
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint
    };
  }

  /*
   * ============================================================
   * AUTHENTICATION
   * ============================================================
   *
   * Este adapter NÃO faz bypass de CAPTCHA.
   *
   * Se a VFS apresentar CAPTCHA, o resultado será:
   *
   * CAPTCHA_REQUIRED
   *
   * O fluxo superior decide como aguardar
   * o checkpoint oficial.
   */

  async login(application = null) {
  const page =
    await this.ensurePage();

  const applicationId =
    application?._id?.toString() ||
    this.applicationId;

  if (!applicationId) {
    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      reason:
        "Application ID is required for VFS authentication."
    };
  }

  /*
   * ============================================================
   * ADMIN RELEASE
   * ============================================================
   *
   * As credenciais VFS são obtidas exclusivamente através
   * do controlo administrativo.
   *
   * O adapter nunca procura:
   *
   * VFS_EMAIL
   * VFS_PASSWORD
   *
   * em variáveis globais.
   *
   * Cada aplicação possui as suas próprias credenciais.
   */
  let credentials;

  try {
    credentials =
      await getCredentialsForAutomation(
        applicationId
      );
  } catch (error) {
    logger.warn(
      "VFS automation blocked by administrative control",
      {
        applicationId,
        code:
          error.code || null,
        message:
          error.message
      }
    );

    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      blocked: true,
      code:
        error.code ||
        "ADMIN_RELEASE_REQUIRED",
      reason:
        error.message ||
        "Application is not released for automation."
    };
  }

  if (
    !credentials?.email ||
    !credentials?.password
  ) {
    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      blocked: true,
      code:
        "VFS_CREDENTIALS_REQUIRED",
      reason:
        "VFS credentials are not available."
    };
  }

  const currentUrl =
    page.url();

  /*
   * Se já estamos autenticados, não fazemos
   * novamente o login.
   */
  if (
    this.isAuthenticatedState()
  ) {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS CAPTCHA/security verification is required."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    await markAutomationActive(
      applicationId
    ).catch(() => {});

    return {
      success: true,
      authenticated: true,
      requiresUser: false,
      state:
        this.state,
      applicationId,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * ABRIR LOGIN
   * ============================================================
   */

  if (
    !currentUrl.includes("/login") &&
    !currentUrl.includes("/dashboard") &&
    !currentUrl.includes("/application-detail")
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/dashboard`
    );
  } else {
    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();
  }

  /*
   * Se a navegação já nos colocou numa página
   * autenticada, terminamos aqui.
   */
  if (
    this.isAuthenticatedState()
  ) {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS CAPTCHA/security verification is required."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    await markAutomationActive(
      applicationId
    ).catch(() => {});

    return {
      success: true,
      authenticated: true,
      requiresUser: false,
      state:
        this.state,
      applicationId,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * CAPTCHA
   * ============================================================
   */

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      captchaRequired: true,
      authenticated: false,
      code:
        "CAPTCHA_REQUIRED",
      reason:
        "Official VFS CAPTCHA/security checkpoint is required.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PROCURAR FORMULÁRIO DE LOGIN
   * ============================================================
   */

  const loginForm =
    await this.findVfsLoginFields();

  if (
    !loginForm?.email ||
    !loginForm?.password
  ) {
    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        captchaRequired: true,
        authenticated: false,
        code:
          "CAPTCHA_REQUIRED",
        reason:
          "Official VFS CAPTCHA/security checkpoint is required.",
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    return {
      success: false,
      requiresUser: true,
      authenticated: false,
      code:
        "VFS_LOGIN_FORM_NOT_FOUND",
      reason:
        "Could not find an unambiguous VFS email/password login form.",
      state:
        this.state,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PREENCHER EMAIL
   * ============================================================
   */

  await page.click(
    loginForm.email
  );

  await page.$eval(
    loginForm.email,
    element => {
      element.focus();
      element.value = "";
    }
  );

  await page.type(
    loginForm.email,
    credentials.email,
    {
      delay: 15
    }
  );

  /*
   * ============================================================
   * PREENCHER PASSWORD
   * ============================================================
   */

  await page.click(
    loginForm.password
  );

  await page.$eval(
    loginForm.password,
    element => {
      element.focus();
      element.value = "";
    }
  );

  await page.type(
    loginForm.password,
    credentials.password,
    {
      delay: 15
    }
  );

  /*
   * IMPORTANTE:
   * não registamos email/password nos logs.
   */

  /*
   * ============================================================
   * SUBMETER LOGIN
   * ============================================================
   */

  if (!loginForm.submit) {
    return {
      success: false,
      requiresUser: true,
      authenticated: false,
      code:
        "VFS_LOGIN_SUBMIT_NOT_FOUND",
      reason:
        "Could not find an unambiguous VFS login submit control.",
      state:
        this.state
    };
  }

  await page.click(
    loginForm.submit
  );

  await page
    .waitForNavigation({
      waitUntil:
        "domcontentloaded",
      timeout:
        DEFAULT_TIMEOUT
    })
    .catch(() => {});

  await page
    .waitForNetworkIdle({
      idleTime: 500,
      timeout: 10000
    })
    .catch(() => {});

  await this.detectState();

  await this.inspectCurrentDom()
    .catch(() => {});

  await this.detectCheckpoint();

  /*
   * ============================================================
   * CHECKPOINTS PÓS-LOGIN
   * ============================================================
   */

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      captchaRequired: true,
      authenticated: false,
      code:
        "CAPTCHA_REQUIRED",
      reason:
        "Official VFS CAPTCHA/security checkpoint is required.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  if (
    this.lastCheckpoint?.type ===
    "OTP_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      otpRequired: true,
      authenticated: false,
      code:
        "OTP_REQUIRED",
      reason:
        "VFS OTP checkpoint detected.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * RESULTADO
   * ============================================================
   */

  const authenticated =
    this.isAuthenticatedState();

  if (authenticated) {
    await markAutomationActive(
      applicationId
    ).catch(() => {});
  }

  return {
    success:
      authenticated,

    authenticated,

    requiresUser:
      !authenticated,

    reason:
      authenticated
        ? null
        : "VFS authentication was not completed.",

    state:
      this.state,

    applicationId,

    checkpoint:
      this.lastCheckpoint,

    dom:
      this.getDomSummary()
  };
}
  async ensureAuthenticated(
    application
  ) {
    return this.login(
      application
    );
  }
async findVfsLoginFields() {
  const page =
    await this.ensurePage();

  return page.evaluate(() => {
    const normalize = value =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const visible = element => {
      if (!element) {
        return false;
      }

      const style =
        window.getComputedStyle(
          element
        );

      return (
        !element.disabled &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    const descriptor = element => ({
      tag:
        element.tagName
          .toLowerCase(),

      id:
        element.id || null,

      name:
        element.getAttribute(
          "name"
        ) || null,

      type:
        element.getAttribute(
          "type"
        ) || null,

      placeholder:
        element.getAttribute(
          "placeholder"
        ) || null,

      aria:
        element.getAttribute(
          "aria-label"
        ) || null
    });

    const selectorFor =
      element => {
        if (element.id) {
          return `#${CSS.escape(
            element.id
          )}`;
        }

        if (
          element.getAttribute(
            "name"
          )
        ) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(
            element.getAttribute(
              "name"
            )
          )}"]`;
        }

        return null;
      };

    const inputs =
      Array.from(
        document.querySelectorAll(
          "input"
        )
      ).filter(visible);

    const emailCandidates =
      inputs.filter(element => {
        const type =
          normalize(
            element.getAttribute(
              "type"
            )
          );

        const haystack =
          normalize(
            [
              element.getAttribute(
                "name"
              ),
              element.id,
              element.getAttribute(
                "placeholder"
              ),
              element.getAttribute(
                "aria-label"
              ),
              element.getAttribute(
                "autocomplete"
              ),
              element.parentElement
                ?.innerText
            ].join(" ")
          );

        return (
          type === "email" ||
          type === "text" &&
          (
            haystack.includes(
              "email"
            ) ||
            haystack.includes(
              "e-mail"
            ) ||
            haystack.includes(
              "username"
            ) ||
            haystack.includes(
              "user name"
            )
          )
        );
      });

    const passwordCandidates =
      inputs.filter(element => {
        const type =
          normalize(
            element.getAttribute(
              "type"
            )
          );

        const haystack =
          normalize(
            [
              element.getAttribute(
                "name"
              ),
              element.id,
              element.getAttribute(
                "placeholder"
              ),
              element.getAttribute(
                "aria-label"
              ),
              element.getAttribute(
                "autocomplete"
              ),
              element.parentElement
                ?.innerText
            ].join(" ")
          );

        return (
          type === "password" ||
          haystack.includes(
            "password"
          ) ||
          haystack.includes(
            "pass word"
          )
        );
      });

    if (
      emailCandidates.length !== 1 ||
      passwordCandidates.length !== 1
    ) {
      return {
        email: null,
        password: null,
        submit: null,

        emailCandidates:
          emailCandidates.length,

        passwordCandidates:
          passwordCandidates.length
      };
    }

    const email =
      selectorFor(
        emailCandidates[0]
      );

    const password =
      selectorFor(
        passwordCandidates[0]
      );

    if (
      !email ||
      !password
    ) {
      return {
        email: null,
        password: null,
        submit: null
      };
    }

    /*
     * Procurar o botão apenas dentro do
     * formulário que contém os campos.
     */
    const form =
      emailCandidates[0]
        .closest("form") ||
      passwordCandidates[0]
        .closest("form");

    if (!form) {
      return {
        email,
        password,
        submit: null
      };
    }

    const submitCandidates =
      Array.from(
        form.querySelectorAll(
          "button, input[type='submit']"
        )
      ).filter(visible)
       .filter(element => {
          const type =
            normalize(
              element.getAttribute(
                "type"
              )
            );

          const text =
            normalize(
              [
                element.innerText,
                element.value,
                element.getAttribute(
                  "aria-label"
                ),
                element.getAttribute(
                  "title"
                )
              ].join(" ")
            );

          return (
            type === "submit" ||
            text.includes(
              "login"
            ) ||
            text.includes(
              "log in"
            ) ||
            text.includes(
              "sign in"
            ) ||
            text.includes(
              "entrar"
            ) ||
            text.includes(
              "continue"
            )
          );
        });

    /*
     * Só usamos o botão se existir
     * exatamente um candidato.
     */
    let submit = null;

    if (
      submitCandidates.length === 1
    ) {
      submit =
        selectorFor(
          submitCandidates[0]
        );
    }

    return {
      email,
      password,
      submit
    };
  });
}
  isAuthenticatedState() {
    if (
      [
        "DASHBOARD",
        "APPLICATION_DETAIL",
        "YOUR_DETAILS",
        "FACIAL",
        "SERVICES",
        "REVIEW_PAY",
        "BOOK_APPOINTMENT",
        "CONFIRMATION"
      ].includes(this.state)
    ) {
      return true;
    }

    const inspection =
      this.lastDomInspection;

    if (!inspection) {
      return false;
    }

    const bodyText =
      String(
        inspection.bodyText ||
        inspection.text ||
        ""
      ).toLowerCase();

    const hasAuthenticatedNavigation =
      [
        "dashboard",
        "application",
        "appointment",
        "visa application"
      ].some(
        term =>
          bodyText.includes(term)
      );

    const hasLoginForm =
      Boolean(
        inspection.summary?.loginForm ||
        inspection.loginForm
      );

    return (
      hasAuthenticatedNavigation &&
      !hasLoginForm
    );
  }

  /*
   * ============================================================
   * APPLICATION DATA
   * ============================================================
   */

  async fillApplication(
    application,
    client,
    preparedData
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/application-detail`
    );

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    const values =
      this.buildApplicationFieldMap(
        application,
        client,
        preparedData
      );

    const fields = [];

    for (
      const [semantic, value] of
      Object.entries(values)
    ) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        continue;
      }

      const result =
        await this.fillKnownField(
          semantic,
          String(value)
        );

      fields.push({
        semantic,
        ...result
      });
    }

    await this.inspectCurrentDom()
      .catch(() => {});

    return {
      success: true,
      state:
        this.state,

      prepared:
        Boolean(preparedData),

      applicationId:
        application?._id?.toString() ||
        this.applicationId,

      clientId:
        client?._id?.toString() ||
        null,

      fields,

      dom:
        this.getDomSummary()
    };
  }

  buildApplicationFieldMap(
    application,
    client,
    preparedData
  ) {
    const applicant =
      preparedData?.applicants?.[0] ||
      preparedData?.applicant ||
      {};

    return {
      passportNumber:
        applicant.passportNumber ||
        applicant.passport?.number ||
        client?.passportNumber ||
        null,

      firstName:
        applicant.firstName ||
        applicant.givenName ||
        null,

      lastName:
        applicant.lastName ||
        applicant.surname ||
        null,

      fullName:
        applicant.fullName ||
        client?.fullName ||
        null,

      dateOfBirth:
        applicant.dateOfBirth ||
        client?.dateOfBirth ||
        null,

      nationality:
        applicant.nationality ||
        client?.nationality ||
        null,

      gender:
        applicant.gender ||
        client?.gender ||
        null
    };
  }

  async fillKnownField(
    semantic,
    value
  ) {
    const page =
      await this.ensurePage();

    const descriptor =
      await page.evaluate(
        semanticName => {
          const normalize =
            value =>
              String(value || "")
                .trim()
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                );

          const semanticTerms = {
            passportNumber: [
              "passport number",
              "passport no",
              "passport number*",
              "travel document number"
            ],

            firstName: [
              "first name",
              "given name",
              "given names"
            ],

            lastName: [
              "last name",
              "surname",
              "family name"
            ],

            fullName: [
              "full name",
              "applicant name"
            ],

            dateOfBirth: [
              "date of birth",
              "birth date",
              "dob"
            ],

            nationality: [
              "nationality"
            ],

            gender: [
              "gender",
              "sex"
            ]
          };

          const terms =
            semanticTerms[
              semanticName
            ] || [];

          const candidates =
            Array.from(
              document.querySelectorAll(
                "input, select, textarea"
              )
            ).filter(
              element => {
                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  element.readOnly ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const haystack =
                  normalize(
                    [
                      element.getAttribute(
                        "name"
                      ),
                      element.id,
                      element.getAttribute(
                        "placeholder"
                      ),
                      element.getAttribute(
                        "aria-label"
                      ),
                      element.getAttribute(
                        "autocomplete"
                      ),
                      element.parentElement
                        ?.innerText
                    ].join(" ")
                  );

                return terms.some(
                  term =>
                    haystack.includes(
                      normalize(term)
                    )
                );
              }
            );

          if (
            candidates.length !== 1
          ) {
            return {
              found: false,
              ambiguous:
                candidates.length > 1,
              count:
                candidates.length
            };
          }

          const element =
            candidates[0];

          return {
            found: true,

            selectorData: {
              tag:
                element.tagName
                  .toLowerCase(),

              id:
                element.id ||
                null,

              name:
                element.getAttribute(
                  "name"
                ) || null,

              type:
                element.getAttribute(
                  "type"
                ) || null
            }
          };
        },
        semantic
      );

    if (
      !descriptor?.found
    ) {
      return {
        filled: false,
        ambiguous:
          Boolean(
            descriptor?.ambiguous
          ),
        reason:
          descriptor?.ambiguous
            ? "Multiple possible VFS fields."
            : "No unambiguous VFS field found."
      };
    }

    const selector =
      this.buildSelector(
        descriptor.selectorData
      );

    if (!selector) {
      return {
        filled: false,
        ambiguous: false,
        reason:
          "Could not safely address the VFS field."
      };
    }

    await page.click(
      selector
    );

    await page.$eval(
      selector,
      element => {
        element.value = "";
      }
    );

    await page.type(
      selector,
      value,
      {
        delay: 15
      }
    );

    return {
      filled: true,
      ambiguous: false,
      selector:
        descriptor.selectorData
    };
  }

  /*
   * ============================================================
   * OTP
   * ============================================================
   */

  async requestOtp() {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type !==
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        otpRequired: false,
        reason:
          "VFS is not currently requesting OTP.",
        checkpoint:
          this.lastCheckpoint
      };
    }

    return {
      success: true,
      otpRequired: true,
      requiresUser: false,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  async submitOtp(
    code
  ) {
    if (
      !code ||
      !/^\d{4,8}$/.test(
        String(code).trim()
      )
    ) {
      throw new Error(
        "Invalid OTP format"
      );
    }

    const page =
      await this.ensurePage();

    const descriptor =
      await this.findOtpInput();

    if (
      !descriptor?.found
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          descriptor?.ambiguous
            ? "Multiple OTP fields detected."
            : "No unambiguous OTP field detected.",
        dom:
          this.getDomSummary()
      };
    }

    const selector =
      this.buildSelector(
        descriptor.selectorData
      );

    if (!selector) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "OTP field cannot be addressed safely."
      };
    }

    await page.click(
      selector
    );

    await page.$eval(
      selector,
      element => {
        element.value = "";
      }
    );

    await page.type(
      selector,
      String(code).trim(),
      {
        delay: 20
      }
    );

    const submitted =
      await this.clickUnambiguousAction(
        [
          "verify",
          "verify otp",
          "submit",
          "continue"
        ]
      );

    if (
      !submitted.clicked
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "OTP was entered, but no unambiguous VFS submission action was found.",
        dom:
          this.getDomSummary()
      };
    }

    await page
      .waitForNetworkIdle({
        idleTime: 400,
        timeout: 8000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    const verified =
      this.lastCheckpoint?.type !==
      "OTP_REQUIRED";

    return {
      success:
        verified,

      otpVerified:
        verified,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  async findOtpInput() {
    const page =
      await this.ensurePage();

    return page.evaluate(
      terms => {
        const normalize =
          value =>
            String(value || "")
              .trim()
              .toLowerCase()
              .replace(
                /\s+/g,
                " "
              );

        const candidates =
          Array.from(
            document.querySelectorAll(
              "input"
            )
          ).filter(
            input => {
              if (
                input.disabled ||
                input.readOnly
              ) {
                return false;
              }

              const haystack =
                normalize(
                  [
                    input.name,
                    input.id,
                    input.placeholder,
                    input.getAttribute(
                      "aria-label"
                    ),
                    input.autocomplete,
                    input.parentElement
                      ?.innerText
                  ].join(" ")
                );

              return terms.some(
                term =>
                  haystack.includes(
                    normalize(term)
                  )
              );
            }
          );

        if (
          candidates.length !== 1
        ) {
          return {
            found: false,
            ambiguous:
              candidates.length > 1,
            count:
              candidates.length
          };
        }

        const input =
          candidates[0];

        return {
          found: true,

          selectorData: {
            id:
              input.id ||
              null,

            name:
              input.name ||
              null
          }
        };
      },
      CHECKPOINT_TERMS.otp
    );
  }

  /*
   * ============================================================
   * FACIAL VERIFICATION
   * ============================================================
   *
   * IMPORTANTE:
   *
   * O sistema não:
   * - simula webcam;
   * - falsifica liveness;
   * - contorna CAPTCHA;
   * - injeta imagem numa proteção biométrica;
   * - inventa posições.
   *
   * Ele apenas interpreta o pedido textual
   * apresentado pelo fluxo oficial e encontra,
   * entre as 10 posições já armazenadas do cliente,
   * a posição semanticamente correspondente.
   */

  async verifyIdentity(
    application,
    client
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/fv-instructions`
    );

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS facial-position checkpoint detected.",
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    return {
      success: false,
      requiresUser: true,
      facialRequired: true,
      reason:
        "The official VFS facial verification checkpoint requires the supported facial flow.",
      state:
        this.state,
      dom:
        this.getDomSummary()
    };
  }

  async detectFacialPositionRequest() {
    const page =
      await this.ensurePage();

    const result =
      await page.evaluate(
        facialTerms => {
          const normalize =
            value =>
              String(value || "")
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

          const body =
            normalize(
              document.body?.innerText ||
              ""
            );

          const visibleElements =
            Array.from(
              document.querySelectorAll(
                "body *"
              )
            ).filter(
              element => {
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
              }
            );

          const textCandidates =
            visibleElements
              .map(
                element =>
                  normalize(
                    element.innerText ||
                    element.textContent ||
                    ""
                  )
              )
              .filter(
                text =>
                  text.length > 0 &&
                  text.length <= 500
              );

          const matchedTerms =
            facialTerms.filter(
              term =>
                body.includes(
                  normalize(term)
                )
            );

          if (
            !matchedTerms.length
          ) {
            return {
              found: false
            };
          }

          /*
           * Prefer the smallest visible text block
           * containing a facial keyword. This avoids
           * passing the entire page to the resolver
           * whenever possible.
           */
          const relevant =
            textCandidates
              .filter(
                text =>
                  facialTerms.some(
                    term =>
                      text.includes(
                        normalize(term)
                      )
                  )
              )
              .sort(
                (a, b) =>
                  a.length - b.length
              );

          return {
            found: true,

            description:
              relevant[0] ||
              body,

            pageText:
              body,

            matched:
              matchedTerms
          };
        },
        CHECKPOINT_TERMS.facial
      );

    if (
      !result?.found
    ) {
      return {
        found: false
      };
    }

    return {
      found: true,

      description:
        result.description,

      pageText:
        result.pageText,

      matched:
        result.matched
    };
  }

  /*
   * ============================================================
   * FACIAL POSITION RESOLVER
   * ============================================================
   *
   * O Bot1 chama:
   *
   * handleFacialPositionRequest(
   *   application,
   *   client
   * )
   *
   * e não:
   *
   * handleFacialPositionRequest(
   *   position,
   *   imageReference
   * )
   *
   * A resolução é feita usando as posições
   * 1..10 já existentes no Client.
   */

  async handleFacialPositionRequest(
    application,
    client
  ) {
    if (
      !application ||
      !client
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "Application or client is missing."
      };
    }

    const positions =
      Array.isArray(
        client.facialPositions
      )
        ? client.facialPositions
        : [];

    const validPositions =
      positions.filter(
        position => {
          const number =
            Number(
              position?.position
            );

          return (
            Number.isInteger(
              number
            ) &&
            number >= 1 &&
            number <= 10 &&
            Boolean(
              position?.storageReference
            )
          );
        }
      );

    if (
      !validPositions.length
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "No valid stored facial positions are available.",
        candidates: []
      };
    }

    /*
     * Lê o pedido atual da VFS.
     */
    const request =
      await this.detectFacialPositionRequest();

    if (
      !request.found ||
      !request.description
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "The VFS facial request could not be read unambiguously.",
        candidates: []
      };
    }

    /*
     * O resolver semântico trabalha apenas
     * sobre as posições existentes no Client.
     */
    let FacialService;

    try {
      FacialService =
        require(
          "../facial/facial-service"
        );
    } catch (error) {
      logger.error(
        "Facial service could not be loaded",
        {
          applicationId:
            this.applicationId,
          error:
            error.message
        }
      );

      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "Facial position resolver is unavailable."
      };
    }

    const facialService =
      new FacialService();

    const resolved =
      facialService.resolvePositionRequest(
        {
          request:
            request.description,

          positions:
            validPositions
        }
      );

    /*
     * Sem resolução inequívoca,
     * não escolhemos uma imagem por aproximação.
     */
    if (
      !resolved?.resolved
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",

        reason:
          "The VFS facial request could not be mapped unambiguously to one stored position.",

        request:
          request.description,

        candidates:
          resolved?.candidates ||
          [],

        checkpoint:
          this.lastCheckpoint,

        dom:
          this.getDomSummary()
      };
    }

    const selected =
      validPositions.find(
        position =>
          Number(
            position.position
          ) ===
          Number(
            resolved.position
          )
      );

    if (
      !selected?.storageReference
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",

        reason:
          "Resolved facial position has no secure storage reference.",

        request:
          request.description,

        candidates:
          resolved.candidates ||
          []
      };
    }

    /*
     * Aqui NÃO fazemos upload automático da imagem.
     *
     * O resultado entrega ao fluxo superior
     * a referência segura que corresponde ao
     * pedido da VFS.
     *
     * A entrega efetiva só deve ocorrer caso
     * o checkpoint oficial disponibilize uma
     * operação compatível.
     */
    return {
      success: true,
      requiresUser: false,
      unresolved: false,

      state:
        "FACIAL_POSITION_RESOLVED",

      request:
        request.description,

      position:
        Number(
          selected.position
        ),

      label:
        selected.label ||
        null,

      storageReference:
        selected.storageReference,

      score:
        resolved.score,

      matchedTerms:
        resolved.matchedTerms ||
        [],

      candidates:
        resolved.candidates ||
        [],

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * CALENDAR / RADAR
   * ============================================================
   */

  async openCalendar() {
    await this.navigate(
      `${VFS_BASE_URL}/services`
    );

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    return {
      success: true,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  async checkAvailability(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return {
        slots: [],
        requiresUser: true,
        captchaRequired: true,
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        slots: [],
        requiresUser: true,
        otpRequired: true,
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    const slots =
      await this.extractVisibleSlots(
        page,
        application
      );

    this.lastSlotSnapshot =
      slots;

    return {
      slots,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
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

    const raw =
      await page.evaluate(
        () => {
          const elements =
            Array.from(
              document.querySelectorAll(
                "button, a, [role='button'], [role='option'], td, li, div"
              )
            );

          return elements
            .map(
              element => {
                const text =
                  element.innerText ||
                  element.textContent ||
                  "";

                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                return {
                  text:
                    text.trim(),

                  tag:
                    element.tagName
                      .toLowerCase(),

                  id:
                    element.id ||
                    null,

                  name:
                    element.getAttribute(
                      "name"
                    ) || null,

                  role:
                    element.getAttribute(
                      "role"
                    ) || null,

                  disabled:
                    Boolean(
                      element.disabled
                    ),

                  visible:
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden"
                };
              }
            )
            .filter(
              item =>
                item.visible &&
                !item.disabled &&
                item.text
            );
        }
      );

    const results = [];

    for (
      const item of raw
    ) {
      const parsed =
        this.parseSlotText(
          item.text
        );

      if (!parsed) {
        continue;
      }

      results.push({
        date:
          parsed.date,

        time:
          parsed.time,

        label:
          item.text,

        selectorData: {
          id:
            item.id,

          name:
            item.name,

          role:
            item.role,

          tag:
            item.tag
        }
      });
    }

    return this.deduplicateSlots(
      results
    );
  }

  parseSlotText(text) {
    if (!text) {
      return null;
    }

    const value =
      String(text)
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    let match =
      value.match(
        /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/
      );

    let date = null;

    if (match) {
      date =
        `${match[1]}-${String(
          match[2]
        ).padStart(2, "0")}-${String(
          match[3]
        ).padStart(2, "0")}`;
    }

    if (!date) {
      match =
        value.match(
          /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/
        );

      if (match) {
        date =
          `${match[3]}-${String(
            match[2]
          ).padStart(2, "0")}-${String(
            match[1]
          ).padStart(2, "0")}`;
      }
    }

    const timeMatch =
      value.match(
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      );

    const time =
      timeMatch
        ? `${String(
            timeMatch[1]
          ).padStart(2, "0")}:${timeMatch[2]}`
        : null;

    if (!date) {
      return null;
    }

    return {
      date,
      time
    };
  }

  deduplicateSlots(
    slots
  ) {
    const seen =
      new Set();

    return slots.filter(
      slot => {
        const key =
          `${slot.date}|${slot.time || ""}`;

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );
  }

  async revalidateSlot(
    slot
  ) {
    const result =
      await this.checkAvailability(
        null
      );

    const found =
      result.slots.find(
        candidate =>
          candidate.date ===
            slot.date &&
          (
            !slot.time ||
            candidate.time ===
              slot.time
          )
      );

    return {
      success:
        Boolean(found),

      slot:
        found || null,

      state:
        this.state,

      slots:
        result.slots
    };
  }

  async selectSlot(
    slot,
    application
  ) {
    if (
      !slot ||
      !slot.date
    ) {
      throw new Error(
        "Invalid slot"
      );
    }

    const page =
      await this.ensurePage();

    const candidates =
      await page.evaluate(
        target => {
          const normalize =
            value =>
              String(value || "")
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .toLowerCase();

          const elements =
            Array.from(
              document.querySelectorAll(
                "button, a, [role='button'], [role='option'], td, li"
              )
            );

          const date =
            normalize(
              target.date
            );

          const time =
            normalize(
              target.time || ""
            );

          const dateParts =
            date.split("-");

          const dateVariants = [
            date,

            `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`,

            `${Number(
              dateParts[2]
            )}/${dateParts[1]}/${dateParts[0]}`,

            `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
          ];

          return elements
            .filter(
              element => {
                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const text =
                  normalize(
                    element.innerText ||
                    element.textContent ||
                    ""
                  );

                const hasDate =
                  dateVariants.some(
                    variant =>
                      text.includes(
                        normalize(
                          variant
                        )
                      )
                  );

                const hasTime =
                  !time ||
                  text.includes(
                    time
                  );

                return (
                  hasDate &&
                  hasTime
                );
              }
            )
            .map(
              element => ({
                id:
                  element.id ||
                  null,

                name:
                  element.getAttribute(
                    "name"
                  ) || null,

                text:
                  (
                    element.innerText ||
                    element.textContent ||
                    ""
                  ).trim()
              })
            );
        },
        {
          date:
            slot.date,

          time:
            slot.time ||
            null
        }
      );

    if (
      candidates.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          candidates.length === 0
            ? "The requested slot is no longer visible."
            : "Multiple VFS elements match the requested slot.",

        candidates
      };
    }

    const selector =
      this.buildSelector(
        candidates[0]
      );

    if (!selector) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "The matched VFS slot has no safe selector."
      };
    }

    await page.click(
      selector
    );

    await page
      .waitForNetworkIdle({
        idleTime: 400,
        timeout: 8000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,

      selected:
        slot,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * DOCUMENT UPLOAD
   * ============================================================
   */

  async uploadPassport(
    passportPath,
    metadata = {}
  ) {
    if (!passportPath) {
      return {
        success: false,
        reason:
          "Passport storage reference is missing."
      };
    }

    const stat =
      await fs.promises.stat(
        passportPath
      );

    if (
      stat.size >
      MAX_PASSPORT_BYTES
    ) {
      throw new Error(
        "Passport document exceeds 2 MB limit"
      );
    }

    const page =
      await this.ensurePage();

    const inputs =
      await page.$$(
        "input[type='file']"
      );

    if (
      inputs.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          inputs.length === 0
            ? "No passport upload input detected."
            : "Multiple upload inputs detected; passport target is ambiguous.",

        dom:
          this.getDomSummary()
      };
    }

    const input =
      inputs[0];

    const accept =
      await input.evaluate(
        node =>
          node.getAttribute(
            "accept"
          ) || ""
      ).catch(
        () => ""
      );

    if (
      accept &&
      !this.acceptsPassportFile(
        accept,
        path.extname(
          passportPath
        )
      )
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "The VFS upload field does not accept the stored passport file type.",
        accept
      };
    }

    await input.uploadFile(
      passportPath
    );

    return {
      success: true,
      uploaded: true,
      size:
        stat.size,
      metadata
    };
  }

  acceptsPassportFile(
    accept,
    extension
  ) {
    const normalized =
      String(
        accept
      ).toLowerCase();

    if (
      normalized.includes(
        "*/*"
      )
    ) {
      return true;
    }

    if (
      extension === ".pdf" &&
      normalized.includes(
        "application/pdf"
      )
    ) {
      return true;
    }

    if (
      [".jpg", ".jpeg"].includes(
        extension
      ) &&
      (
        normalized.includes(
          "image/jpeg"
        ) ||
        normalized.includes(
          "image/*"
        )
      )
    ) {
      return true;
    }

    if (
      extension === ".png" &&
      (
        normalized.includes(
          "image/png"
        ) ||
        normalized.includes(
          "image/*"
        )
      )
    ) {
      return true;
    }

    return false;
  }

  /*
   * ============================================================
   * CONTINUE
   * ============================================================
   */

  async continueApplication(
    application
  ) {
    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS facial-position checkpoint detected before continuation.",
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    const result =
      await this.clickUnambiguousAction(
        [
          "continue",
          "proceed",
          "next"
        ]
      );

    if (
      !result.clicked
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "No unambiguous VFS continue action was found.",
        dom:
          this.getDomSummary()
      };
    }

    const page =
      await this.ensurePage();

    await page
      .waitForNetworkIdle({
        idleTime: 500,
        timeout: 10000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PAYMENT
   * ============================================================
   */

  async getPaymentDetails(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    const url =
      page.url();

    const text =
      await page.evaluate(
        () =>
          document.body?.innerText ||
          ""
      ).catch(
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
        this.extractTextValue(
          text,
          [
            "Entity",
            "Entity Number"
          ]
        ) ||
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
        this.isConfirmationUrl(
          url
        )
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
    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    if (
      this.state ===
      "CONFIRMATION"
    ) {
      return {
        success: true,
        state:
          this.state
      };
    }

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        otpRequired: true,
        reason:
          "VFS is requesting OTP before final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS requested facial verification before final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    const action =
      await this.clickUnambiguousAction(
        [
          "book appointment",
          "confirm appointment",
          "confirm booking",
          "submit",
          "continue"
        ]
      );

    if (
      !action.clicked
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          "The final VFS booking action could not be identified unambiguously.",

        state:
          this.state,

        payment,

        dom:
          this.getDomSummary()
      };
    }

    const page =
      await this.ensurePage();

    await page
      .waitForNetworkIdle({
        idleTime: 700,
        timeout: 15000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.state ===
      "CONFIRMATION"
    ) {
      return {
        success: true,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        otpRequired: true,
        reason:
          "VFS requested OTP during final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS requested facial verification during final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    return {
      success: false,
      requiresUser: true,

      reason:
        "VFS did not reach its official confirmation page.",

      state:
        this.state,

      payment,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  async getConfirmation(
    application
  ) {
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

    const confirmed =
      String(
        paymentStatus
      ).toLowerCase() ===
        "true" ||
      this.state ===
        "CONFIRMATION";

    return {
      confirmed,

      success:
        confirmed,

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

  /*
   * ============================================================
   * SAFE DOM ACTIONS
   * ============================================================
   */

  async clickUnambiguousAction(
    labels
  ) {
    const page =
      await this.ensurePage();

    const candidates =
      await page.evaluate(
        wantedLabels => {
          const normalize =
            value =>
              String(value || "")
                .trim()
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                );

          const wanted =
            wantedLabels.map(
              normalize
            );

          return Array.from(
            document.querySelectorAll(
              "button, a, [role='button']"
            )
          )
            .filter(
              element => {
                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const text =
                  normalize(
                    [
                      element.innerText,
                      element.getAttribute(
                        "aria-label"
                      ),
                      element.getAttribute(
                        "title"
                      )
                    ].join(" ")
                  );

                return wanted.some(
                  label =>
                    text === label ||
                    text.includes(
                      label
                    )
                );
              }
            )
            .map(
              element => ({
                id:
                  element.id ||
                  null,

                name:
                  element.getAttribute(
                    "name"
                  ) || null,

                text:
                  (
                    element.innerText ||
                    element.getAttribute(
                      "aria-label"
                    ) ||
                    ""
                  ).trim()
              })
            );
        },
        labels
      );

    if (
      candidates.length !== 1
    ) {
      return {
        clicked: false,

        ambiguous:
          candidates.length > 1,

        candidates
      };
    }

    const selector =
      this.buildSelector(
        candidates[0]
      );

    if (!selector) {
      return {
        clicked: false,
        ambiguous: false,
        reason:
          "Matched action has no safe selector."
      };
    }

    await page.click(
      selector
    );

    return {
      clicked: true,
      selector,
      candidate:
        candidates[0]
    };
  }

  /*
   * ============================================================
   * CHECKPOINT DETECTION
   * ============================================================
   */

  async detectCheckpoint() {
    const page =
      await this.ensurePage();

    const data =
      await page.evaluate(
        terms => {
          const normalize =
            value =>
              String(value || "")
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();

          const body =
            normalize(
              document.body?.innerText ||
              ""
            );

          const inputs =
            Array.from(
              document.querySelectorAll(
                "input, textarea, select"
              )
            ).map(
              element => ({
                type:
                  normalize(
                    element.getAttribute(
                      "type"
                    )
                  ),

                name:
                  normalize(
                    element.getAttribute(
                      "name"
                    )
                  ),

                id:
                  normalize(
                    element.id
                  ),

                placeholder:
                  normalize(
                    element.getAttribute(
                      "placeholder"
                    )
                  ),

                aria:
                  normalize(
                    element.getAttribute(
                      "aria-label"
                    )
                  )
              })
            );

          const has =
            list =>
              list.some(
                term =>
                  body.includes(
                    normalize(term)
                  )
              );

          const otpInput =
            inputs.some(
              input =>
                [
                  input.name,
                  input.id,
                  input.placeholder,
                  input.aria
                ].some(
                  value =>
                    terms.otp.some(
                      term =>
                        value.includes(
                          normalize(
                            term
                          )
                        )
                    )
                )
            );

          return {
            body,
            otpInput,

            captcha:
              has(
                terms.captcha
              ),

            facial:
              has(
                terms.facial
              )
          };
        },
        CHECKPOINT_TERMS
      );

    if (
      data.captcha
    ) {
      this.lastCheckpoint = {
        type:
          "CAPTCHA_REQUIRED",

        reason:
          "Official VFS CAPTCHA/security verification detected."
      };

      return this.lastCheckpoint;
    }

    if (
      data.otpInput ||
      data.body.includes(
        "otp"
      ) ||
      data.body.includes(
        "one time password"
      )
    ) {
      this.lastCheckpoint = {
        type:
          "OTP_REQUIRED",

        reason:
          "Official VFS OTP checkpoint detected."
      };

      return this.lastCheckpoint;
    }

    if (
      data.facial
    ) {
      const request =
        await this.detectFacialPositionRequest();

      this.lastCheckpoint = {
        type:
          "FACIAL_POSITION",

        reason:
          "Official VFS facial checkpoint detected.",

        request
      };

      return this.lastCheckpoint;
    }

    this.lastCheckpoint =
      null;

    return null;
  }

  /*
   * ============================================================
   * DOM INSPECTION
   * ============================================================
   */

  async inspectCurrentDom(
    options = {}
  ) {
    const page =
      await this.ensurePage();

    const inspection =
      await this.domInspector.inspect(
        page,
        {
          includeHtml:
            options.includeHtml ===
            true
        }
      );

    this.lastDomInspection =
      inspection;

    return inspection;
  }

  getLastDomInspection() {
    return (
      this.lastDomInspection ||
      null
    );
  }

  getDomSummary() {
    const inspection =
      this.lastDomInspection;

    if (!inspection) {
      return null;
    }

    return {
      url:
        inspection.url ||
        null,

      title:
        inspection.title ||
        null,

      inspectedAt:
        inspection.inspectedAt ||
        null,

      summary:
        inspection.summary ||
        null
    };
  }

  async getCurrentDomInspection() {
    if (
      !this.lastDomInspection
    ) {
      await this.inspectCurrentDom();
    }

    return this.lastDomInspection;
  }

  /*
   * ============================================================
   * HELPERS
   * ============================================================
   */

  checkpointResult(
    type,
    reason
  ) {
    return {
      success: false,

      requiresUser: true,

      captchaRequired:
        type ===
        "CAPTCHA_REQUIRED",

      otpRequired:
        type ===
        "OTP_REQUIRED",

      facialRequired:
        type ===
        "FACIAL_POSITION",

      reason,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
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
    return String(
      url || ""
    ).includes(
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
      String(text)
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
          `^${this.escapeRegex(
            label
          )}\\s*[:\\-]\\s*(.+)$`,
          "i"
        );

      const found =
        lines.find(
          line =>
            exact.test(line)
        );

      if (found) {
        const match =
          found.match(
            exact
          );

        if (
          match?.[1]
        ) {
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
                this.escapeRegex(
                  label
                ),
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
    return String(
      value
    ).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
  }

  escapeCss(
    value
  ) {
    return String(
      value
    ).replace(
      /([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g,
      "\\$1"
    );
  }

  escapeCssAttribute(
    value
  ) {
    return String(
      value
    )
      .replace(
        /\\/g,
        "\\\\"
      )
      .replace(
        /"/g,
        '\\"'
      );
  }

  buildSelector(
    data
  ) {
    if (!data) {
      return null;
    }

    if (data.id) {
      return `#${this.escapeCss(
        data.id
      )}`;
    }

    if (data.name) {
      return `[name="${this.escapeCssAttribute(
        data.name
      )}"]`;
    }

    return null;
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
        "/login"
      )
    ) {
      this.state =
        "LOGIN";
    } else if (
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
      if (this.context) {
        await this.context.close();
      }
    } catch {}

    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {}

    this.page = null;
    this.context = null;
    this.browser = null;

    this.initialized = false;
    this.state = "UNKNOWN";

    this.lastDomInspection =
      null;

    this.lastCheckpoint =
      null;

    this.lastSlotSnapshot =
      [];

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
