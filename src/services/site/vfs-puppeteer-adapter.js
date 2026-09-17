"use strict";

const puppeteer = require("puppeteer");

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

const AUTH_PATHS = [
"/login",
"/dashboard",
"/application-detail"
];

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
"camera",
"face"
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

this.applicationId = applicationId;

this.browser = null;
this.context = null;
this.page = null;

this.initialized = false;
this.state = "UNKNOWN";

this.domInspector = new VfsDomInspector({
  applicationId: this.applicationId
});

this.lastDomInspection = null;
this.lastCheckpoint = null;
this.lastSlotSnapshot = [];

}

async initialize() {
if (this.initialized && this.page) {
return true;
}

this.browser = await puppeteer.launch({
  headless:
    process.env.PUPPETEER_HEADLESS !== "false",

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
  await this.browser.createBrowserContext();

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
  url: page.url(),
  state: this.state,
  checkpoint:
    this.lastCheckpoint
};

}

/*

* ============================================================
* AUTHENTICATION
* ============================================================
* 
* Não fazemos bypass de CAPTCHA.
* 
* O método detecta o estado oficial da sessão:
* 
* - authenticated
* - login_required
* - captcha_required
* - otp_required
* - unknown
* 
* Se a VFS já estiver autenticada, o Bot1 pode continuar.
  */

async login(application = null) {
await this.navigate(
"${VFS_BASE_URL}/dashboard"
);

await this.detectState();
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
    reason:
      "Official VFS CAPTCHA/security checkpoint is required.",
    state: this.state,
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
    reason:
      "VFS OTP checkpoint detected.",
    state: this.state,
    checkpoint:
      this.lastCheckpoint,
    dom:
      this.getDomSummary()
  };
}

const authenticated =
  this.isAuthenticatedState();

return {
  success: authenticated,
  authenticated,
  requiresUser: !authenticated,

  reason:
    authenticated
      ? null
      : "VFS authentication has not been completed.",

  state: this.state,

  applicationId:
    application?._id?.toString() ||
    this.applicationId,

  checkpoint:
    this.lastCheckpoint,

  dom:
    this.getDomSummary()
};

}

async ensureAuthenticated(application) {
const result =
await this.login(application);

return result;

}

isAuthenticatedState() {
if (
[
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
* APPLICATION
* ============================================================
  */

async fillApplication(
application,
client,
preparedData
) {
await this.navigate(
"${VFS_BASE_URL}/application-detail"
);

await this.detectCheckpoint();

if (
  this.lastCheckpoint?.type ===
  "CAPTCHA_REQUIRED"
) {
  return {
    success: false,
    requiresUser: true,
    captchaRequired: true,
    reason:
      "Official VFS security checkpoint detected.",
    state: this.state,
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
    reason:
      "VFS OTP checkpoint detected.",
    state: this.state,
    checkpoint:
      this.lastCheckpoint,
    dom:
      this.getDomSummary()
  };
}

/*
 * Não enviamos dados para selectors
 * inventados.
 *
 * O DOM real é analisado e campos
 * inequivocamente identificáveis podem
 * ser preenchidos por fillKnownField().
 */

const values =
  this.buildApplicationFieldMap(
    application,
    client,
    preparedData
  );

const fieldResults = [];

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

  fieldResults.push({
    semantic,
    ...result
  });
}

await this.inspectCurrentDom()
  .catch(() => {});

return {
  success: true,
  state: this.state,

  prepared:
    Boolean(preparedData),

  applicationId:
    application?._id?.toString() ||
    this.applicationId,

  clientId:
    client?._id?.toString() ||
    null,

  fields:
    fieldResults,

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

/*

* Preenche apenas quando o DOM fornece
* uma identificação sem ambiguidade.
  */
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
            .replace(/\s+/g, " ");

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

      const elements =
        Array.from(
          document.querySelectorAll(
            "input, select, textarea"
          )
        );

      const candidates =
        elements
          .filter(
            element => {
              const style =
                window.getComputedStyle(
                  element
                );

              if (
                element.disabled ||
                element.readOnly ||
                style.display === "none" ||
                style.visibility === "hidden"
              ) {
                return false;
              }

              const parts = [
                element.getAttribute("name"),
                element.getAttribute("id"),
                element.getAttribute("placeholder"),
                element.getAttribute("aria-label"),
                element.getAttribute("autocomplete")
              ];

              const parentText =
                element.parentElement?.innerText ||
                "";

              parts.push(parentText);

              const haystack =
                normalize(
                  parts.join(" ")
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
        ambiguous: false,

        selectorData: {
          tag:
            element.tagName.toLowerCase(),

          id:
            element.id || null,

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

if (!descriptor?.found) {
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

await page.click(selector);

await page.evaluate(
  targetSelector => {
    const element =
      document.querySelector(
        targetSelector
      );

    if (!element) {
      return;
    }

    element.focus();
  },
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

buildSelector(data) {
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
  reason:
    "VFS OTP checkpoint detected.",
  checkpoint:
    this.lastCheckpoint,
  dom:
    this.getDomSummary()
};

}

async submitOtp(code) {
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

if (!descriptor?.found) {
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

await page.click(selector);

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

if (!submitted.clicked) {
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

return {
  success:
    this.lastCheckpoint?.type !==
    "OTP_REQUIRED",

  otpVerified:
    this.lastCheckpoint?.type !==
    "OTP_REQUIRED",

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
          .replace(/\s+/g, " ");

    const inputs =
      Array.from(
        document.querySelectorAll(
          "input"
        )
      );

    const candidates =
      inputs.filter(
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
                input.parentElement?.innerText
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
          input.id || null,

        name:
          input.name || null
      }
    };
  },
  CHECKPOINT_TERMS.otp
);

}

/*

* ============================================================
* FACIAL FLOW
* ============================================================
* 
* Não simulamos webcam/liveness.
* 
* A função abaixo apenas identifica
* o pedido oficial e devolve a descrição
* semântica encontrada no DOM.
  */

async verifyIdentity() {
await this.navigate(
"${VFS_BASE_URL}/fv-instructions"
);

await this.detectCheckpoint();

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
    position:
      this.lastCheckpoint.position,
    checkpoint:
      this.lastCheckpoint,
    dom:
      this.getDomSummary()
  };
}

return {
  success: false,
  requiresUser: true,
  reason:
    "Facial verification requires the official VFS flow.",
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
            .replace(/\s+/g, " ")
            .trim();

      const text =
        normalize(
          document.body?.innerText ||
          ""
        );

      const matched =
        facialTerms
          .filter(
            term =>
              text.includes(
                normalize(term)
              )
          );

      if (!matched.length) {
        return {
          found: false
        };
      }

      /*
       * A descrição exata é devolvida
       * para o resolver semântico externo.
       */
      return {
        found: true,
        text,
        matched
      };
    },
    CHECKPOINT_TERMS.facial
  );

if (!result?.found) {
  return {
    found: false
  };
}

return {
  found: true,
  description:
    result.text,
  matched:
    result.matched
};

}

/*

* A posição deve ser resolvida pelo
* serviço de identidade usando as
* 10 posições existentes do Client.
* 
* Se houver ambiguidade, NÃO enviamos
* uma imagem errada.
  */
  async handleFacialPositionRequest(
  position,
  imageReference
  ) {
  if (
  !position ||
  !imageReference
  ) {
  return {
  success: false,
  requiresUser: true,
  unresolved: true,
  reason:
  "Facial position or stored image reference is missing."
  };
  }

/*
 * Não fazemos upload de uma imagem
 * arbitrária nem simulamos liveness.
 *
 * O fluxo oficial continua responsável
 * pela captura/verificação facial.
 */
return {
  success: false,
  requiresUser: true,
  unresolved: false,
  reason:
    "Stored facial position can only be supplied when the current official VFS flow explicitly accepts that position as an upload.",
  position
};

}

/*

* ============================================================
* CALENDAR / RADAR
* ============================================================
  */

async openCalendar() {
await this.navigate(
"${VFS_BASE_URL}/services"
);

await this.detectCheckpoint();

if (
  this.lastCheckpoint?.type ===
  "CAPTCHA_REQUIRED"
) {
  return {
    success: false,
    requiresUser: true,
    captchaRequired: true,
    reason:
      "Official VFS security checkpoint detected.",
    checkpoint:
      this.lastCheckpoint,
    dom:
      this.getDomSummary()
  };
}

return {
  success: true,
  state:
    this.state,
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

/*

* Não assumimos classes específicas.
* 
* O método procura elementos cujo
* conteúdo/atributos contenham datas
* e horários reconhecíveis.
* 
* A ação de seleção continua separada
* e exige correspondência inequívoca.
  */
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
                element.tagName.toLowerCase(),

              id:
                element.id || null,

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
    .replace(/\s+/g, " ")
    .trim();

/*
 * ISO / YYYY-MM-DD
 */
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

/*
 * DD/MM/YYYY
 */
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

/*
 * Hora HH:mm
 */
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

    if (seen.has(key)) {
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

const page =
  await this.ensurePage();

const candidates =
  await page.evaluate(
    target => {
      const normalize =
        value =>
          String(value || "")
            .replace(/\s+/g, " ")
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

            const dateParts =
              date.split("-");

            const dateVariants = [
              date,
              `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`,
              `${Number(dateParts[2])}/${Number(dateParts[1])}/${dateParts[0]}`,
              `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
            ];

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
              text.includes(time);

            return (
              hasDate &&
              hasTime
            );
          }
        )
        .map(
          element => ({
            id:
              element.id || null,

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
        slot.time || null
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

return {
  success: true,
  selected:
    slot,
  state:
    this.state,
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

/*
 * Segurança: este adapter aceita apenas
 * um ficheiro local previamente recuperado
 * pelo backend a partir do armazenamento
 * seguro. O frontend nunca fornece o caminho.
 */

const fs =
  require("fs");

const path =
  require("path");

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
  await page.$$("input[type='file']");

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
  await input
    .$eval(
      node =>
        node.getAttribute(
          "accept"
        ) || "",
      {}
    )
    .catch(
      () => ""
    );

/*
 * Se o campo tiver restrições explícitas,
 * não forçamos um ficheiro incompatível.
 */
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
String(accept)
.toLowerCase();

if (
  normalized.includes("*/*")
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
* CONTINUE / PAYMENT
* ============================================================
  */

async continueApplication() {
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
    reason:
      "Official VFS security checkpoint detected.",
    checkpoint:
      this.lastCheckpoint
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

if (!result.clicked) {
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

async getPaymentDetails() {
const page =
await this.ensurePage();

await this.detectState();

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
    textAmount || null,

  currency:
    textCurrency || null,

  deadline:
    textDeadline || null,

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
  return {
    success: false,
    requiresUser: true,
    captchaRequired: true,
    reason:
      "Official VFS security checkpoint detected.",
    checkpoint:
      this.lastCheckpoint
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

if (!action.clicked) {
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

return {
  success: false,
  requiresUser: true,
  reason:
    "VFS did not reach its official confirmation page.",
  state:
    this.state,
  payment,
  dom:
    this.getDomSummary()
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

if (!isConfirmation) {
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
            .replace(/\s+/g, " ");

      const wanted =
        wantedLabels.map(
          normalize
        );

      const elements =
        Array.from(
          document.querySelectorAll(
            "button, a, [role='button']"
          )
        );

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
                text.includes(label)
            );
          }
        )
        .map(
          element => ({
            id:
              element.id || null,

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
            .replace(/\s+/g, " ")
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
        );

      const inputData =
        inputs.map(
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
        inputData.some(
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
                      normalize(term)
                    )
                )
            )
        );

      const captcha =
        has(terms.captcha);

      const facial =
        has(terms.facial);

      return {
        body,
        otpInput,
        captcha,
        facial
      };
    },
    CHECKPOINT_TERMS
  );

if (data.captcha) {
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
  data.body.includes("otp") ||
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

if (data.facial) {
  const facialRequest =
    await this.detectFacialPositionRequest();

  this.lastCheckpoint = {
    type:
      "FACIAL_POSITION",
    reason:
      "Official VFS facial checkpoint detected.",
    request:
      facialRequest
  };

  return this.lastCheckpoint;
}

this.lastCheckpoint = null;

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
        options.includeHtml === true
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

parseQueryParameters(url) {
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

isConfirmationUrl(url) {
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

escapeRegex(value) {
return String(value)
.replace(
/[.*+?^${}()|[]\]/g,
"\$&"
);
}

escapeCss(value) {
return String(value)
.replace(
/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g,
"\$1"
);
}

escapeCssAttribute(value) {
return String(value)
.replace(
/\/g,
"\\"
)
.replace(
/"/g,
'\"'
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
  url.includes("/login")
) {
  this.state =
    "LOGIN";
} else if (
  url.includes("/dashboard")
) {
  this.state =
    "DASHBOARD";
} else if (
  url.includes("/application-detail")
) {
  this.state =
    "APPLICATION_DETAIL";
} else if (
  url.includes("/your-details")
) {
  this.state =
    "YOUR_DETAILS";
} else if (
  url.includes("/fv-instructions")
) {
  this.state =
    "FACIAL";
} else if (
  url.includes("/services")
) {
  this.state =
    "SERVICES";
} else if (
  url.includes("/review-pay")
) {
  this.state =
    "REVIEW_PAY";
} else if (
  url.includes("/book-appointment")
) {
  this.state =
    "BOOK_APPOINTMENT";
} else if (
  url.includes("/confirmation")
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
this.lastDomInspection = null;
this.lastCheckpoint = null;
this.lastSlotSnapshot = [];

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
