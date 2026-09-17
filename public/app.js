(() => {
"use strict";

/* =========================================================
TRAVEL AUTOMATION
APP CONTROLLER
=========================================================

 FLUXO PRINCIPAL

   01 PASSAPORTE
        ↓
   OCR + MRZ + validação
        ↓
   PERFIL CRIADO AUTOMATICAMENTE
        ↓
   02 IDENTIDADE
        ↓
   RECONHECIMENTO FACIAL
        ↓
   03 CANDIDATURA
        ↓
   OTP → VFS → RADAR → VAGA
        ↓
   04 ACOMPANHAMENTO

 IMPORTANTE:
 - Não existe login nesta interface.
 - O passaporte é a porta de entrada.
 - Não existe criação manual de perfil como etapa inicial.
 - O backend continua responsável pela autenticação técnica
   quando AUTH_ENABLED estiver ativo.
 - Não duplica a lógica de passport-first.js.
 - Não duplica a lógica da facial-preflight-ui.js.

========================================================= */

/* =========================================================
STATE
========================================================= */

const state = {
clients: [],
applications: [],

selectedClientId: null,
selectedClient: null,

passportValidation: null,

facialReady: false,

currentStage: "passport",

csrfToken: null,

loading: false

};

/* =========================================================
DOM
========================================================= */

const $ = (id) =>
document.getElementById(id);

/* =========================================================
GLOBAL HELPERS
========================================================= */

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&")
.replaceAll("<", "<")
.replaceAll(">", ">")
.replaceAll('"', """)
.replaceAll("'", "'");
}

function formatDate(value) {
if (!value) {
return "—";
}

const date = new Date(value);

if (Number.isNaN(date.getTime())) {
  return String(value);
}

return new Intl.DateTimeFormat(
  "pt-PT",
  {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }
).format(date);

}

function getClientId(client) {
return (
client?._id ||
client?.id ||
null
);
}

function getClientName(client) {
return (
client?.fullName ||
client?.name ||
"Viajante"
);
}

function getClientById(clientId) {
return state.clients.find(
client =>
String(
getClientId(client)
) === String(clientId)
);
}

function showToast(
message,
type = "info"
) {
const container =
$("toastContainer");

if (!container) {
  console[
    type === "error"
      ? "error"
      : "log"
  ](
    "[TRAVEL AUTOMATION]",
    message
  );

  return;
}

const toast =
  document.createElement("div");

toast.className =
  `toast ${type}`;

toast.textContent =
  message;

container.appendChild(toast);

requestAnimationFrame(() => {
  toast.classList.add("show");
});

setTimeout(() => {
  toast.style.opacity = "0";
  toast.style.transform =
    "translateY(8px)";

  setTimeout(() => {
    toast.remove();
  }, 250);
}, 4000);

}

function setText(
id,
value
) {
const element = $(id);

if (element) {
  element.textContent =
    value;
}

}

function setHidden(
id,
hidden
) {
const element = $(id);

if (element) {
  element.hidden =
    Boolean(hidden);
}

}

function setDisabled(
id,
disabled
) {
const element = $(id);

if (element) {
  element.disabled =
    Boolean(disabled);
}

}

/* =========================================================
CONNECTION
========================================================= */

function setConnection(
online,
text
) {
const element =
$("connectionText");

if (!element) {
  return;
}

element.textContent =
  text ||
  (
    online
      ? "Sistema operacional"
      : "Sistema indisponível"
  );

element.classList.toggle(
  "online",
  Boolean(online)
);

element.classList.toggle(
  "offline",
  !online
);

}

/* =========================================================
CSRF
========================================================= */

function getCookie(name) {
const cookies =
document.cookie.split(";");

for (
  const cookie of cookies
) {
  const [
    key,
    ...parts
  ] =
    cookie
      .trim()
      .split("=");

  if (key === name) {
    return decodeURIComponent(
      parts.join("=")
    );
  }
}

return null;

}

function getCsrfToken() {
return (
state.csrfToken ||
getCookie("csrf_token") ||
getCookie("csrfToken") ||
null
);
}

/* =========================================================
API
========================================================= */

async function api(
url,
options = {}
) {
const method =
String(
options.method ||
"GET"
).toUpperCase();

const isFormData =
  options.body instanceof FormData;

const config = {
  credentials: "include",
  ...options,

  headers: {
    ...(isFormData
      ? {}
      : {
          "Content-Type":
            "application/json"
        }),

    ...(options.headers || {})
  }
};

const csrf =
  getCsrfToken();

if (
  csrf &&
  [
    "POST",
    "PUT",
    "PATCH",
    "DELETE"
  ].includes(method)
) {
  config.headers[
    "x-csrf-token"
  ] = csrf;
}

const response =
  await fetch(
    url,
    config
  );

const contentType =
  response.headers.get(
    "content-type"
  ) || "";

let data;

if (
  contentType.includes(
    "application/json"
  )
) {
  data =
    await response.json();
} else {
  data =
    await response.text();
}

if (!response.ok) {
  const message =
    typeof data === "object"
      ? (
          data?.message ||
          data?.error ||
          "Erro na operação."
        )
      : (
          data ||
          "Erro na operação."
        );

  const error =
    new Error(message);

  error.status =
    response.status;

  error.data =
    data;

  throw error;
}

return data;

}

/* =========================================================
APP VISIBILITY
========================================================= */

function showApp() {
$("appView")
?.classList
.remove("hidden");
}

/* =========================================================
USER INTERFACE
=========================================================

 Não existe autenticação visual.
 Mantemos apenas compatibilidade com
 qualquer elemento antigo que ainda esteja
 presente no HTML.

========================================================= */

function updateUserInterface() {
const userName =
$("userName");

if (userName) {
  userName.textContent =
    "Travel Automation";
}

}

/* =========================================================
CLIENT SELECTORS
========================================================= */

function renderClientSelectors() {
const selectors = [
$("passportClientSelect"),
$("applicationClient"),
$("identityClient")
].filter(Boolean);

selectors.forEach(
  selector => {
    const current =
      selector.value;

    selector.innerHTML = `
      <option value="">
        Selecionar viajante
      </option>

      ${state.clients
        .map(client => {
          const id =
            getClientId(client);

          const name =
            getClientName(client);

          return `
            <option
              value="${escapeHtml(id)}"
            >
              ${escapeHtml(name)}
            </option>
          `;
        })
        .join("")}
    `;

    if (current) {
      selector.value =
        current;
    }

    if (
      state.selectedClientId
    ) {
      selector.value =
        state.selectedClientId;
    }
  }
);

}

/* =========================================================
CLIENTS
========================================================= */

async function loadClients() {
try {
const response =
await api(
"/api/clients"
);

  state.clients =
    Array.isArray(response)
      ? response
      : (
          response?.clients ||
          response?.data ||
          []
        );

  renderClientSelectors();

  updateClientCount();

  if (
    state.selectedClientId
  ) {
    const client =
      getClientById(
        state.selectedClientId
      );

    if (client) {
      state.selectedClient =
        client;

      updateSelectedClient();

      await loadPassportStatus(
        state.selectedClientId
      );
    }
  }

  updateReadiness();

} catch (error) {
  console.error(
    "[CLIENTS]",
    error
  );

  showToast(
    "Não foi possível carregar os viajantes.",
    "error"
  );
}

}

function updateClientCount() {
setText(
"clientCount",
state.clients.length
);
}

/* =========================================================
SELECT CLIENT
========================================================= */

async function selectClient(
clientId,
source = "application"
) {
if (!clientId) {
state.selectedClientId =
null;

  state.selectedClient =
    null;

  state.passportValidation =
    null;

  state.facialReady =
    false;

  updateSelectedClient();
  updateIdentityGate();
  updateReadiness();

  return;
}

const client =
  getClientById(clientId);

if (!client) {
  return;
}

state.selectedClientId =
  String(clientId);

state.selectedClient =
  client;

[
  "applicationClient",
  "identityClient",
  "passportClientSelect"
].forEach(id => {
  const select =
    $(id);

  if (select) {
    select.value =
      state.selectedClientId;
  }
});

updateSelectedClient();

await loadPassportStatus(
  state.selectedClientId
);

updateIdentityGate();
updateReadiness();
updateFacialModuleSelection();

addActivity(
  "Viajante preparado",
  `${getClientName(client)} está selecionado para a operação.`,
  "blue"
);

}

/* =========================================================
SELECTED CLIENT CARD
========================================================= */

function updateSelectedClient() {
const card =
$("selectedClientCard");

const name =
  $("selectedClientName");

const passport =
  $("selectedClientPassport");

if (
  !state.selectedClient
) {
  card?.classList.add(
    "empty"
  );

  setText(
    "selectedClientName",
    "Nenhum viajante"
  );

  setText(
    "selectedClientPassport",
    "O passaporte será usado para criar o perfil automaticamente."
  );

  return;
}

card?.classList.remove(
  "empty"
);

const client =
  state.selectedClient;

const fullName =
  getClientName(client);

setText(
  "selectedClientName",
  fullName
);

setText(
  "selectedClientPassport",
  client.passportNumber
    ? `Passaporte ${client.passportNumber}`
    : "Passaporte validado"
);

const avatar =
  $("selectedClientAvatar") ||
  card?.querySelector(
    ".selected-client-avatar"
  );

if (avatar) {
  avatar.textContent =
    fullName
      .split(/\s+/)
      .slice(0, 2)
      .map(
        part =>
          part
            .charAt(0)
            .toUpperCase()
      )
      .join("");
}

}

/* =========================================================
PASSPORT STATUS
========================================================= */

async function loadPassportStatus(
clientId
) {
if (!clientId) {
return;
}

try {
  const response =
    await api(
      `/api/passports/${encodeURIComponent(
        clientId
      )}/status`
    );

  state.passportValidation =
    response?.passportValidation ||
    null;

  renderPassportValidation();

  updateIdentityGate();
  updateReadiness();

} catch (error) {
  console.debug(
    "[PASSPORT STATUS]",
    error.message
  );

  state.passportValidation =
    null;

  updateIdentityGate();
  updateReadiness();
}

}

function renderPassportValidation() {
const validation =
state.passportValidation;

if (!validation) {
  resetPassportChecks();
  return;
}

const passed =
  validation.status ===
    "passed" ||
  validation.ready === true;

setDocumentCheck(
  "passportCheckMrz",
  validation.mrzValid === true
);

setDocumentCheck(
  "passportCheckMatch",
  validation.clientMatch === true
);

setDocumentCheck(
  "passportCheckExpiry",
  validation.expired !== true
);

setDocumentCheck(
  "passportCheckStorage",
  passed
);

setPassportPanelStatus(
  passed
    ? "APROVADO"
    : "CORRIGIR",
  passed
    ? "success"
    : "error"
);

}

function setDocumentCheck(
id,
status
) {
const element =
$(id);

if (!element) {
  return;
}

element.classList.remove(
  "pass",
  "fail",
  "pending"
);

if (status === true) {
  element.classList.add(
    "pass"
  );

  element.textContent =
    "✓";
} else if (
  status === false
) {
  element.classList.add(
    "fail"
  );

  element.textContent =
    "!";
} else {
  element.classList.add(
    "pending"
  );

  element.textContent =
    "—";
}

}

function resetPassportChecks() {
[
"passportCheckFile",
"passportCheckMrz",
"passportCheckMatch",
"passportCheckExpiry",
"passportCheckStorage"
].forEach(id => {
setDocumentCheck(
id,
null
);
});

setPassportPanelStatus(
  "AGUARDANDO",
  "blue"
);

}

function setPassportPanelStatus(
text,
type = "blue"
) {
const element =
$("passportPanelStatus");

if (!element) {
  return;
}

element.textContent =
  text;

element.className =
  `panel-status ${type}`;

}

/* =========================================================
PASSPORT RESULT
========================================================= */

function renderPassportResult(
passed,
passport
) {
const result =
$("passportResultState");

const title =
  $("passportResultTitle");

if (!result) {
  return;
}

if (passed) {
  result.className =
    "passport-result-state success";

  result.innerHTML = `
    <div class="result-state-icon">
      ✓
    </div>

    <div>
      <strong>
        Passaporte validado
      </strong>

      <span>
        O perfil do viajante foi criado automaticamente.
        A próxima etapa é a verificação de identidade.
      </span>
    </div>
  `;

  if (title) {
    title.textContent =
      "Perfil criado automaticamente";
  }
} else {
  result.className =
    "passport-result-state error";

  result.innerHTML = `
    <div class="result-state-icon">
      !
    </div>

    <div>
      <strong>
        Correção necessária
      </strong>

      <span>
        O passaporte não pode liberar a operação
        enquanto a validação não estiver concluída.
      </span>
    </div>
  `;

  if (title) {
    title.textContent =
      "Correção necessária";
  }
}

if (!passport) {
  return;
}

const extracted =
  $("passportExtractedData");

if (extracted) {
  extracted.hidden =
    false;
}

setText(
  "passportExtractedType",
  passport.passportType ||
  passport.type ||
  "—"
);

setText(
  "passportExtractedMrz",
  passport.mrzValid === true
    ? "Válida"
    : "Não validada"
);

setText(
  "passportExtractedMatch",
  passport.clientMatch === true
    ? "Confirmada"
    : "Perfil criado"
);

setText(
  "passportExtractedExpiry",
  passport.expired === true
    ? "Expirado"
    : "Válido"
);

const issuesBox =
  $("passportIssues");

const issues =
  Array.isArray(
    passport.issues
  )
    ? passport.issues
    : [];

if (
  issuesBox &&
  issues.length
) {
  issuesBox.hidden =
    false;

  issuesBox.innerHTML = `
    <strong>
      O que precisa de atenção
    </strong>

    <ul>
      ${issues
        .slice(0, 8)
        .map(
          issue =>
            `<li>${escapeHtml(issue)}</li>`
        )
        .join("")}
    </ul>
  `;
} else if (issuesBox) {
  issuesBox.hidden =
    true;
}

}

/* =========================================================
IDENTITY
========================================================= */

function setupIdentityEvents() {
const identitySelect =
$("identityClient");

identitySelect?.addEventListener(
  "change",
  async event => {
    await selectClient(
      event.target.value,
      "identity"
    );

    updateFacialModuleSelection();
  }
);

const applicationSelect =
  $("applicationClient");

applicationSelect?.addEventListener(
  "change",
  async event => {
    await selectClient(
      event.target.value,
      "application"
    );

    updateFacialModuleSelection();
  }
);

/*
 * O facial-preflight-ui.js cria o
 * Identity Center dinamicamente.
 */
setTimeout(
  moveFacialPanel,
  500
);

setInterval(
  monitorFacialResult,
  1000
);

}

function moveFacialPanel() {
const panel =
$("facialPreflightPanel");

const mount =
  $("facialMount") ||
  $("facialPreflightMount");

if (
  panel &&
  mount &&
  panel.parentElement !==
    mount
) {
  mount.appendChild(
    panel
  );
}

updateFacialModuleSelection();

}

function updateFacialModuleSelection() {
if (!state.selectedClientId) {
return;
}

const identity =
  $("identityClient");

const application =
  $("applicationClient");

if (identity) {
  identity.value =
    state.selectedClientId;
}

if (application) {
  application.value =
    state.selectedClientId;
}

}

function updateIdentityGate() {
const selected =
Boolean(
state.selectedClient
);

const passportPassed =
  state.passportValidation?.status ===
    "passed" ||
  state.passportValidation?.ready ===
    true;

const facePassed =
  state.facialReady === true;

const message =
  $("identityGateMessage");

const summary =
  $("identityClientSummary");

if (summary) {
  const strong =
    summary.querySelector(
      "strong"
    );

  if (strong) {
    strong.textContent =
      selected
        ? getClientName(
            state.selectedClient
          )
        : "Nenhum viajante selecionado";
  }
}

if (!message) {
  return;
}

message.classList.remove(
  "ready",
  "bad"
);

if (!selected) {
  message.innerHTML = `
    <div>!</div>

    <span>
      O viajante será criado automaticamente
      a partir do passaporte.
    </span>
  `;

  return;
}

if (!passportPassed) {
  message.classList.add(
    "bad"
  );

  message.innerHTML = `
    <div>!</div>

    <span>
      O passaporte ainda não foi aprovado.
      A identidade só pode avançar depois da
      validação documental.
    </span>
  `;

  return;
}

if (facePassed) {
  message.classList.add(
    "ready"
  );

  message.innerHTML = `
    <div>✓</div>

    <span>
      Identidade preparada.
      O viajante está apto para a candidatura.
    </span>
  `;

  return;
}

message.innerHTML = `
  <div>!</div>

  <span>
    Passaporte aprovado.
    Execute agora a verificação facial.
  </span>
`;

}

/* =========================================================
FACIAL RESULT MONITOR
========================================================= */

function monitorFacialResult() {
const result =
$("identityResult");

const applicationForm =
  $("applicationForm");

if (!result) {
  return;
}

const resultPassed =
  result.classList.contains(
    "passed"
  );

const backendPassed =
  applicationForm
    ?.dataset
    ?.facialPreflight ===
    "passed";

/*
 * O módulo facial pode atualizar
 * apenas o DOM ou também o dataset.
 *
 * Quando o backend marcar o preflight
 * como aprovado, consideramos a etapa
 * preparada.
 */
if (
  resultPassed &&
  (
    backendPassed ||
    applicationForm?.dataset
      ?.facialPreflight
      === undefined
  )
) {
  state.facialReady =
    true;
}

if (
  result.classList.contains(
    "failed"
  )
) {
  state.facialReady =
    false;
}

const status =
  $("facialPanelStatus");

if (status) {
  if (state.facialReady) {
    status.textContent =
      "APROVADA";

    status.className =
      "panel-status";
  } else if (
    result.classList.contains(
      "failed"
    )
  ) {
    status.textContent =
      "CORRIGIR";

    status.className =
      "panel-status blue";
  } else {
    status.textContent =
      "AGUARDANDO";

    status.className =
      "panel-status blue";
  }
}

updateIdentityGate();
updateReadiness();

}

/* =========================================================
APPLICATIONS
========================================================= */

async function loadApplications() {
try {
const response =
await api(
"/api/applications"
);

  state.applications =
    Array.isArray(response)
      ? response
      : (
          response?.applications ||
          response?.data ||
          []
        );

  renderApplications();
  updateApplicationStats();
  updateReadiness();

} catch (error) {
  console.error(
    "[APPLICATIONS]",
    error
  );

  state.applications =
    [];

  renderApplications();
  updateApplicationStats();
}

}

function getStatusLabel(
status
) {
const labels = {
created:
"Criada",

  preparing:
    "Preparando",

  otp_required:
    "OTP necessário",

  otp_verified:
    "OTP verificado",

  identity_verification:
    "Verificação de identidade",

  calendar:
    "Calendário",

  waiting_for_slot:
    "No radar",

  slot_received:
    "Vaga encontrada",

  continuing:
    "A continuar",

  completed:
    "Concluída",

  error:
    "Erro",

  cancelled:
    "Cancelada"
};

return (
  labels[status] ||
  status ||
  "Desconhecido"
);

}

function getApplicationClientName(
application
) {
const client =
application?.client ||
application?.clientData ||
null;

if (
  typeof client ===
  "string"
) {
  const found =
    getClientById(client);

  return (
    getClientName(found)
  );
}

return (
  client?.fullName ||
  client?.name ||
  "Viajante"
);

}

function renderApplications() {
const container =
$("applicationsList");

if (!container) {
  return;
}

if (
  !state.applications.length
) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">
        ○
      </div>

      <strong>
        Nenhuma candidatura
      </strong>

      <span>
        A candidatura aparecerá aqui
        depois de o passaporte e a identidade
        estarem preparados.
      </span>
    </div>
  `;

  return;
}

container.innerHTML =
  state.applications
    .map(application => {
      const id =
        application._id ||
        application.id;

      const status =
        application.status ||
        "created";

      return `
        <article
          class="application-item"
          data-application-id="${escapeHtml(id)}"
        >
          <div>
            <strong>
              ${escapeHtml(
                getApplicationClientName(
                  application
                )
              )}
            </strong>

            <span>
              ${
                escapeHtml(
                  application.visaType ||
                  "Candidatura"
                )
              }
            </span>
          </div>

          <div>
            <span class="application-status">
              ${escapeHtml(
                getStatusLabel(
                  status
                )
              )}
            </span>

            <small>
              ${escapeHtml(
                formatDate(
                  application.createdAt
                )
              )}
            </small>
          </div>
        </article>
      `;
    })
    .join("");

}

function updateApplicationStats() {
const count =
state.applications.length;

setText(
  "applicationCount",
  count
);

const prepared =
  state.applications.filter(
    application =>
      [
        "preparing",
        "otp_required",
        "otp_verified",
        "identity_verification",
        "calendar",
        "waiting_for_slot",
        "slot_received",
        "continuing"
      ].includes(
        application.status
      )
  ).length;

setText(
  "preparedCount",
  prepared
);

const monitoring =
  state.applications.filter(
    application =>
      [
        "waiting_for_slot",
        "slot_received"
      ].includes(
        application.status
      )
  ).length;

setText(
  "monitoringCount",
  monitoring
);

}

/* =========================================================
CREATE APPLICATION
========================================================= */

function setupApplicationEvents() {
const form =
$("applicationForm");

if (!form) {
  return;
}

form.addEventListener(
  "submit",
  handleApplicationSubmit
);

const select =
  $("applicationClient");

select?.addEventListener(
  "change",
  async event => {
    await selectClient(
      event.target.value,
      "application"
    );
  }
);

}

async function handleApplicationSubmit(
event
) {
event.preventDefault();

if (state.loading) {
  return;
}

if (
  !state.selectedClientId
) {
  showToast(
    "O viajante ainda não foi preparado.",
    "error"
  );

  return;
}

const passportPassed =
  state.passportValidation?.status ===
    "passed" ||
  state.passportValidation?.ready ===
    true;

if (!passportPassed) {
  showToast(
    "Valide primeiro o passaporte.",
    "error"
  );

  return;
}

if (
  !state.facialReady
) {
  showToast(
    "Conclua primeiro a preparação da identidade.",
    "error"
  );

  return;
}

const visaType =
  String(
    $("applicationVisaType")
      ?.value ||
    ""
  )
    .trim()
    .toUpperCase();

const visaCenter =
  String(
    $("applicationVisaCenter")
      ?.value ||
    ""
  )
    .trim();

const travelPurpose =
  String(
    $("applicationTravelPurpose")
      ?.value ||
    ""
  )
    .trim();

const start =
  $("preferredStartDate")
    ?.value ||
  null;

const end =
  $("preferredEndDate")
    ?.value ||
  null;

const preferredTime =
  $("preferredTime")
    ?.value ||
  null;

if (
  ![
    "SCHENGEN",
    "NACIONAL"
  ].includes(
    visaType
  )
) {
  showToast(
    "Selecione SCHENGEN ou NACIONAL.",
    "error"
  );

  return;
}

state.loading =
  true;

setDisabled(
  "applicationSubmitButton",
  true
);

setApplicationPanelStatus(
  "A CRIAR",
  "blue"
);

try {
  const idempotencyKey =
    (
      window.crypto &&
      typeof window.crypto.randomUUID ===
        "function"
    )
      ? window.crypto.randomUUID()
      : `travel-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  const payload = {
    clientId:
      state.selectedClientId,

    clientIds: [
      state.selectedClientId
    ],

    bookingMode:
      "SINGLE",

    visaType,

    visaCenter:
      visaCenter || null,

    travelPurpose:
      travelPurpose || null,

    preferredDates: {
      start,
      end
    },

    preferredTime:
      preferredTime || null,

    preferredWeekdays:
      [],

    idempotencyKey
  };

  const response =
    await api(
      "/api/applications",
      {
        method: "POST",

        headers: {
          "Idempotency-Key":
            idempotencyKey
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const application =
    response?.application ||
    response?.data ||
    response;

  if (
    !application
  ) {
    throw new Error(
      "O servidor não devolveu a candidatura criada."
    );
  }

  state.applications.unshift(
    application
  );

  renderApplications();
  updateApplicationStats();

  setApplicationPanelStatus(
    "CRIADA",
    "success"
  );

  updatePipeline(
    true,
    true,
    true,
    true
  );

  updateReadiness();

  addActivity(
    "Candidatura criada",
    `Candidatura de ${getClientName(
      state.selectedClient
    )} criada com sucesso.`,
    "green"
  );

  showToast(
    "Candidatura criada com sucesso.",
    "success"
  );

  setTimeout(
    () => {
      $("verificationSection")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
    },
    300
  );

} catch (error) {
  console.error(
    "[APPLICATION CREATE]",
    error
  );

  setApplicationPanelStatus(
    "CORRIGIR",
    "error"
  );

  showToast(
    error.message ||
    "Não foi possível criar a candidatura.",
    "error"
  );

} finally {
  state.loading =
    false;

  setDisabled(
    "applicationSubmitButton",
    false
  );
}

}

function setApplicationPanelStatus(
text,
type = "blue"
) {
const element =
$("applicationPanelStatus");

if (!element) {
  return;
}

element.textContent =
  text;

element.className =
  `panel-status ${type}`;

}

/* =========================================================
READINESS
========================================================= */

function updateReadiness() {
const clientReady =
Boolean(
state.selectedClient
);

const passportReady =
  state.passportValidation?.status ===
    "passed" ||
  state.passportValidation?.ready ===
    true;

const identityReady =
  state.facialReady ===
  true;

const applicationReady =
  state.applications.some(
    application =>
      application?.client &&
      String(
        typeof application.client ===
          "object"
          ? application.client._id
          : application.client
      ) ===
      String(
        state.selectedClientId
      )
  );

const operationReady =
  state.applications.some(
    application =>
      [
        "preparing",
        "otp_required",
        "otp_verified",
        "identity_verification",
        "calendar",
        "waiting_for_slot",
        "slot_received",
        "continuing",
        "completed"
      ].includes(
        application?.status
      )
  );

const values = [
  [
    "readinessClient",
    clientReady
  ],
  [
    "readinessPassport",
    passportReady
  ],
  [
    "readinessIdentity",
    identityReady
  ],
  [
    "readinessApplication",
    applicationReady
  ],
  [
    "readinessOperation",
    operationReady
  ]
];

values.forEach(
  ([id, ready]) => {
    const element =
      $(id);

    if (!element) {
      return;
    }

    element.textContent =
      ready
        ? "Pronto"
        : "Pendente";

    element.classList.toggle(
      "ready",
      ready
    );

    element.classList.toggle(
      "pending",
      !ready
    );
  }
);

const scoreParts =
  [
    clientReady,
    passportReady,
    identityReady,
    applicationReady
  ];

const score =
  Math.round(
    (
      scoreParts.filter(
        Boolean
      ).length /
      scoreParts.length
    ) * 100
  );

setText(
  "readinessScore",
  `${score}%`
);

updatePipeline(
  clientReady,
  passportReady,
  identityReady,
  applicationReady
);

updateVfsGate(
  clientReady,
  passportReady,
  identityReady,
  applicationReady
);

}

/* =========================================================
PIPELINE
========================================================= */

function updatePipeline(
clientReady,
passportReady,
identityReady,
applicationReady
) {
const stages = [
[
"bot1State",
passportReady,
"Passaporte"
],

  [
    "bot2State",
    identityReady,
    "Identidade"
  ],

  [
    "supervisorState",
    applicationReady,
    "Candidatura"
  ]
];

stages.forEach(
  ([id, ready, label]) => {
    const element =
      $(id);

    if (!element) {
      return;
    }

    element.textContent =
      ready
        ? "PRONTO"
        : "AGUARDANDO";

    element.classList.toggle(
      "ready",
      ready
    );

    element.classList.toggle(
      "pending",
      !ready
    );
  }
);

const pipelineVfs =
  $("pipelineVfs");

if (pipelineVfs) {
  pipelineVfs.textContent =
    applicationReady
      ? "CANDIDATURA"
      : "BLOQUEADO";
}

updateBotCenter(
  passportReady,
  identityReady,
  applicationReady
);

}

function updateBotCenter(
passportReady,
identityReady,
applicationReady
) {
updateBot(
"bot1Indicator",
"bot1Progress",
"bot1LastAction",
passportReady,
passportReady
? 100
: 0,
passportReady
? "Passaporte validado"
: "Aguardando passaporte"
);

updateBot(
  "bot2Indicator",
  "bot2Progress",
  "bot2LastAction",
  identityReady,
  identityReady
    ? 100
    : 0,
  identityReady
    ? "Identidade preparada"
    : "Aguardando identidade"
);

updateBot(
  "supervisorIndicator",
  "supervisorProgress",
  "supervisorLastAction",
  applicationReady,
  applicationReady
    ? 100
    : 0,
  applicationReady
    ? "Candidatura criada"
    : "Aguardando candidatura"
);

}

function updateBot(
indicatorId,
progressId,
actionId,
ready,
progress,
action
) {
const indicator =
$(indicatorId);

if (indicator) {
  indicator.classList.toggle(
    "active",
    ready
  );

  indicator.classList.toggle(
    "pending",
    !ready
  );
}

const progressElement =
  $(progressId);

if (progressElement) {
  progressElement.style.width =
    `${Math.max(
      0,
      Math.min(
        100,
        progress
      )
    )}%`;
}

setText(
  actionId,
  action
);

}

/* =========================================================
VFS GATE
========================================================= */

function updateVfsGate(
clientReady,
passportReady,
identityReady,
applicationReady
) {
setGateCheck(
"gateClientCheck",
clientReady
);

setGateCheck(
  "gatePassportCheck",
  passportReady
);

setGateCheck(
  "gateFaceCheck",
  identityReady
);

setGateCheck(
  "gateOperationCheck",
  applicationReady
);

const gateReady =
  clientReady &&
  passportReady &&
  identityReady &&
  applicationReady;

const icon =
  $("vfsGateIcon");

const title =
  $("vfsGateTitle");

const description =
  $("vfsGateDescription");

const heroStatus =
  $("heroGateStatus");

const heroMessage =
  $("heroGateMessage");

const heroProgress =
  $("heroRouteProgress");

const notice =
  $("applicationSecurityNotice");

if (icon) {
  icon.textContent =
    gateReady
      ? "✓"
      : "!";
}

if (title) {
  title.textContent =
    gateReady
      ? "Operação preparada"
      : "Operação bloqueada";
}

if (description) {
  description.textContent =
    gateReady
      ? "Passaporte, identidade e candidatura estão preparados para a próxima fase."
      : "Complete as etapas anteriores para liberar a próxima fase.";
}

if (heroStatus) {
  heroStatus.textContent =
    gateReady
      ? "PREPARADO"
      : "EM PREPARAÇÃO";
}

if (heroMessage) {
  heroMessage.textContent =
    gateReady
      ? "O processo pode seguir para a operação."
      : "A plataforma está a preparar o processo automaticamente.";
}

if (heroProgress) {
  const completed =
    [
      passportReady,
      identityReady,
      applicationReady
    ].filter(Boolean)
      .length;

  heroProgress.style.width =
    `${Math.round(
      (completed / 3) * 100
    )}%`;
}

if (notice) {
  notice.textContent =
    gateReady
      ? "Todos os requisitos internos desta etapa estão preparados."
      : "A candidatura só pode avançar depois da validação documental e de identidade.";
}

const submit =
  $("applicationSubmitButton");

if (submit) {
  submit.disabled =
    !(
      clientReady &&
      passportReady &&
      identityReady
    );
}

const panelStatus =
  $("applicationPanelStatus");

if (
  panelStatus &&
  !gateReady
) {
  panelStatus.textContent =
    identityReady
      ? "PRONTO PARA CANDIDATURA"
      : "AGUARDANDO IDENTIDADE";
}

}

function setGateCheck(
id,
ready
) {
const element =
$(id);

if (!element) {
  return;
}

element.classList.remove(
  "ready",
  "pending",
  "pass",
  "fail"
);

element.classList.add(
  ready
    ? "ready"
    : "pending"
);

const text =
  element.querySelector(
    "span"
  );

if (text) {
  text.textContent =
    ready
      ? "Concluído"
      : "Pendente";
}

}

/* =========================================================
ACTIVITY FEED
========================================================= */

function addActivity(
title,
description,
type = "blue"
) {
const feed =
$("activityFeed");

if (!feed) {
  return;
}

const item =
  document.createElement(
    "div"
  );

item.className =
  `activity-item ${type}`;

item.innerHTML = `
  <div class="activity-dot"></div>

  <div>
    <strong>
      ${escapeHtml(title)}
    </strong>

    <span>
      ${escapeHtml(description)}
    </span>

    <small>
      ${new Intl.DateTimeFormat(
        "pt-PT",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(new Date())}
    </small>
  </div>
`;

feed.prepend(item);

while (
  feed.children.length >
  12
) {
  feed.lastElementChild.remove();
}

}

/* =========================================================
NAVIGATION
========================================================= */

function setupNavigation() {
const links =
document.querySelectorAll(
"[data-section], [data-target]"
);

links.forEach(
  link => {
    link.addEventListener(
      "click",
      event => {
        const target =
          link.dataset.section ||
          link.dataset.target;

        if (!target) {
          return;
        }

        const section =
          $(target) ||
          document.querySelector(
            `#${CSS.escape(target)}`
          );

        if (!section) {
          return;
        }

        event.preventDefault();

        section.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    );
  }
);

}

/* =========================================================
REFRESH
========================================================= */

async function refreshDashboard() {
setConnection(
true,
"A sincronizar sistema..."
);

try {
  await Promise.all([
    loadClients(),
    loadApplications()
  ]);

  setConnection(
    true,
    "Sistema operacional"
  );

} catch (error) {
  console.error(
    "[REFRESH]",
    error
  );

  setConnection(
    false,
    "Backend indisponível"
  );
}

}

/* =========================================================
REFRESH BUTTON
========================================================= */

function setupRefreshButton() {
$("refreshButton")
?.addEventListener(
"click",
async () => {
if (state.loading) {
return;
}

      await refreshDashboard();

      showToast(
        "Sistema atualizado.",
        "success"
      );
    }
  );

}

/* =========================================================
PASSPORT-FIRST COMPATIBILITY
=========================================================

 NÃO adicionamos aqui outro listener ao
 passportFile.

 A responsabilidade de:

   ficheiro
   ↓
   /api/passports/import
   ↓
   OCR
   ↓
   MRZ
   ↓
   criação automática do cliente

 pertence ao passport-first.js atual.

 Depois que ele cria o cliente, ele altera
 applicationClient / identityClient.
 Os listeners deste arquivo capturam essa
 mudança e sincronizam o estado.

========================================================= */

function observePassportFirstSelection() {
const selectors = [
$("applicationClient"),
$("identityClient"),
$("passportClientSelect")
].filter(Boolean);

selectors.forEach(
  selector => {
    selector.addEventListener(
      "change",
      async event => {
        const id =
          event.target.value;

        if (!id) {
          return;
        }

        /*
         * passport-first.js pode criar o
         * cliente e alterar o selector
         * antes de o /api/clients ter sido
         * atualizado localmente.
         *
         * Tentamos sincronizar primeiro
         * pela lista atual e, se necessário,
         * fazemos nova leitura.
         */
        let client =
          getClientById(id);

        if (!client) {
          await loadClients();

          client =
            getClientById(id);
        }

        if (client) {
          await selectClient(
            id,
            "passport-first"
          );
        }
      }
    );
  }
);

}

/* =========================================================
FORM COMPATIBILITY
========================================================= */

function disableManualClientCreation() {
const form =
$("clientForm");

if (!form) {
  return;
}

/*
 * O perfil agora nasce do passaporte.
 *
 * Não apagamos o formulário do DOM para
 * preservar IDs/classes do HTML.
 *
 * Apenas o retiramos do fluxo inicial.
 */
form.dataset.mode =
  "automatic-passport";

form.classList.add(
  "automatic-profile-only"
);

}

/* =========================================================
STAGE MANAGEMENT
========================================================= */

function calculateCurrentStage() {
const passportReady =
state.passportValidation?.status ===
"passed" ||
state.passportValidation?.ready ===
true;

const identityReady =
  state.facialReady === true;

const applicationReady =
  state.applications.some(
    application => {
      const client =
        application?.client;

      const id =
        typeof client ===
          "object"
          ? client?._id
          : client;

      return (
        String(id) ===
        String(
          state.selectedClientId
        )
      );
    }
  );

if (!state.selectedClient) {
  return "passport";
}

if (!passportReady) {
  return "passport";
}

if (!identityReady) {
  return "identity";
}

if (!applicationReady) {
  return "application";
}

return "monitoring";

}

function updateCurrentStage() {
state.currentStage =
calculateCurrentStage();

document.body.dataset.stage =
  state.currentStage;

const stageMap = {
  passport: 0,
  identity: 1,
  application: 2,
  monitoring: 3
};

const current =
  stageMap[
    state.currentStage
  ];

if (
  current === undefined
) {
  return;
}

const pipeline =
  document.querySelectorAll(
    "[data-stage]"
  );

pipeline.forEach(
  element => {
    const value =
      Number(
        element.dataset.stage
      );

    element.classList.toggle(
      "active",
      value === current
    );

    element.classList.toggle(
      "completed",
      value < current
    );
  }
);

}

/* =========================================================
OBSERVERS
========================================================= */

function setupObservers() {
const observer =
new MutationObserver(
() => {
moveFacialPanel();
monitorFacialResult();
updateCurrentStage();
}
);

observer.observe(
  document.body,
  {
    childList: true,
    subtree: true
  }
);

}

/* =========================================================
GLOBAL API
========================================================= */

/*

* passport-first.js e outros módulos podem
* usar window.showToast.
  */
  window.showToast =
  showToast;

window.TravelAutomation =
{
state,

  refresh:
    refreshDashboard,

  selectClient,

  loadClients,

  loadApplications,

  updateReadiness,

  updateIdentityGate,

  addActivity,

  showToast
};

/* =========================================================
EVENTS
========================================================= */

function setupEvents() {
setupRefreshButton();
setupIdentityEvents();
setupApplicationEvents();
setupNavigation();

observePassportFirstSelection();

disableManualClientCreation();

}

/* =========================================================
INIT
========================================================= */

async function init() {
console.log(
"[TRAVEL AUTOMATION] Inicializando aplicação..."
);

/*
 * Sem login.
 */
showApp();

updateUserInterface();

setConnection(
  true,
  "A ligar ao sistema..."
);

setupEvents();

setupObservers();

updateReadiness();
updateIdentityGate();
updateCurrentStage();

/*
 * O passport-first.js pode ainda não
 * ter criado nenhum cliente.
 *
 * Carregamos o estado existente.
 */
await refreshDashboard();

/*
 * Depois da sincronização, tentamos
 * detectar novamente o painel facial.
 */
moveFacialPanel();
updateFacialModuleSelection();

updateReadiness();
updateIdentityGate();
updateCurrentStage();

console.log(
  "[TRAVEL AUTOMATION] Aplicação pronta."
);

}

/* =========================================================
START
========================================================= */

if (
document.readyState ===
"loading"
) {
document.addEventListener(
"DOMContentLoaded",
init,
{
once: true
}
);
} else {
init();
}

})();
