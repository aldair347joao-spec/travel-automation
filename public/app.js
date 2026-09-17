(() => {
"use strict";

/*

* =========================================================
* TRAVEL AUTOMATION
* APP CONTROLLER
* =========================================================
* 
* FLUXO:
* 
* 01 PASSAPORTE
*  ↓
* OCR + MRZ + validação
*  ↓
* PERFIL CRIADO AUTOMATICAMENTE
*  ↓
* 02 IDENTIDADE
*  ↓
* RECONHECIMENTO FACIAL
*  ↓
* 03 CANDIDATURA
*  ↓
* OTP → VFS → RADAR → VAGA
*  ↓
* 04 ACOMPANHAMENTO
* 
* IMPORTANTE:
* - Não existe login na interface.
* - passport-first.js controla a importação do passaporte.
* - facial-preflight-ui.js controla o Identity Center.
* - Este ficheiro controla o estado geral da aplicação.
* - Não existe mais o antigo travelWorkflow.
    */

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

const $ = (id) => document.getElementById(id);

/* =========================================================
HELPERS
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
if (!value) return "—";

const date = new Date(value);

if (Number.isNaN(date.getTime())) {
  return String(value);
}

return new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
}).format(date);

}

function getClientId(client) {
return client?._id || client?.id || null;
}

function getClientName(client) {
return (
client?.fullName ||
client?.name ||
client?.passportData?.fullName ||
"Viajante"
);
}

function getClientById(clientId) {
return state.clients.find(
(client) =>
String(getClientId(client)) === String(clientId)
);
}

function setText(id, value) {
const element = $(id);

if (element) {
  element.textContent = value ?? "";
}

}

function setHidden(id, hidden) {
const element = $(id);

if (element) {
  element.hidden = Boolean(hidden);
}

}

function setDisabled(id, disabled) {
const element = $(id);

if (element) {
  element.disabled = Boolean(disabled);
}

}

function showToast(message, type = "info") {
const container = $("toastContainer");

if (!container) {
  console[type === "error" ? "error" : "log"](
    "[TRAVEL AUTOMATION]",
    message
  );
  return;
}

const toast = document.createElement("div");

toast.className = `toast ${type}`;
toast.textContent = message;

container.appendChild(toast);

requestAnimationFrame(() => {
  toast.classList.add("show");
});

window.setTimeout(() => {
  toast.style.opacity = "0";
  toast.style.transform = "translateY(8px)";

  window.setTimeout(() => {
    toast.remove();
  }, 250);
}, 4000);

}

function addActivity(title, description, type = "blue") {
const feed = $("activityFeed");

if (!feed) return;

const item = document.createElement("div");

item.className = `activity-item ${type}`;

item.innerHTML = `
  <div class="activity-dot"></div>

  <div class="activity-content">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(description)}</span>
  </div>

  <time>${formatDate(new Date())}</time>
`;

feed.prepend(item);

while (feed.children.length > 8) {
  feed.lastElementChild?.remove();
}

}

/* =========================================================
CONNECTION
========================================================= */

function setConnection(online, text) {
const element = $("connectionText");

if (!element) return;

element.textContent =
  text ||
  (online
    ? "Sistema operacional"
    : "Sistema indisponível");

element.classList.toggle("online", Boolean(online));
element.classList.toggle("offline", !online);

}

async function checkHealth() {
try {
const response = await fetch("/api/health", {
credentials: "include"
});

  if (!response.ok) {
    throw new Error("API indisponível");
  }

  setConnection(true, "Sistema operacional");
  return true;
} catch (error) {
  console.error("[HEALTH]", error);
  setConnection(false, "Sistema indisponível");
  return false;
}

}

/* =========================================================
CSRF
========================================================= */

function getCookie(name) {
const cookies = document.cookie.split(";");

for (const cookie of cookies) {
  const [key, ...parts] = cookie.trim().split("=");

  if (key === name) {
    return decodeURIComponent(parts.join("="));
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

async function api(url, options = {}) {
const method = String(
options.method || "GET"
).toUpperCase();

const isFormData =
  options.body instanceof FormData;

const headers = {
  ...(isFormData
    ? {}
    : {
        "Content-Type": "application/json"
      }),
  ...(options.headers || {})
};

const csrf = getCsrfToken();

if (
  csrf &&
  ["POST", "PUT", "PATCH", "DELETE"].includes(method)
) {
  headers["x-csrf-token"] = csrf;
}

const response = await fetch(url, {
  ...options,
  credentials: "include",
  headers
});

const contentType =
  response.headers.get("content-type") || "";

let data;

if (contentType.includes("application/json")) {
  data = await response.json();
} else {
  data = await response.text();
}

if (!response.ok) {
  const message =
    typeof data === "object"
      ? data?.message ||
        data?.error ||
        "Erro na operação."
      : data ||
        "Erro na operação.";

  const error = new Error(message);

  error.status = response.status;
  error.data = data;

  throw error;
}

return data;

}

/* =========================================================
CLIENTES
========================================================= */

async function loadClients() {
try {
const response = await api("/api/clients");

  state.clients = Array.isArray(response)
    ? response
    : response?.clients ||
      response?.data ||
      [];

  renderClientSelectors();

  setText(
    "clientCount",
    state.clients.length
  );

  if (state.selectedClientId) {
    const client = getClientById(
      state.selectedClientId
    );

    if (client) {
      state.selectedClient = client;

      updateSelectedClient();

      await loadPassportStatus(
        state.selectedClientId
      );
    }
  }

  updateReadiness();
} catch (error) {
  console.error("[CLIENTS]", error);

  setText("clientCount", 0);

  /*
   * Não bloqueamos a página.
   * O primeiro viajante pode ser criado pelo
   * passport-first.js.
   */
}

}

function renderClientSelectors() {
const selectors = [
$("passportClientSelect"),
$("applicationClient"),
$("identityClient")
].filter(Boolean);

selectors.forEach((selector) => {
  const current = selector.value;

  selector.innerHTML = `
    <option value="">
      Selecionar viajante
    </option>

    ${state.clients
      .map((client) => {
        const id = getClientId(client);
        const name = getClientName(client);

        return `
          <option value="${escapeHtml(id)}">
            ${escapeHtml(name)}
          </option>
        `;
      })
      .join("")}
  `;

  if (state.selectedClientId) {
    selector.value =
      state.selectedClientId;
  } else if (current) {
    selector.value = current;
  }
});

}

async function selectClient(clientId) {
if (!clientId) {
state.selectedClientId = null;
state.selectedClient = null;
state.passportValidation = null;
state.facialReady = false;

  updateSelectedClient();
  updateIdentityGate();
  updateReadiness();

  return;
}

const client = getClientById(clientId);

if (!client) return;

state.selectedClientId =
  String(clientId);

state.selectedClient = client;

[
  "applicationClient",
  "identityClient",
  "passportClientSelect"
].forEach((id) => {
  const select = $(id);

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
  "Viajante selecionado",
  `${getClientName(client)} está preparado para continuar.`,
  "blue"
);

}

function updateSelectedClient() {
const card = $("selectedClientCard");

if (!state.selectedClient) {
  card?.classList.add("empty");

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

card?.classList.remove("empty");

const client =
  state.selectedClient;

const name =
  getClientName(client);

setText(
  "selectedClientName",
  name
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
  avatar.textContent = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) =>
      part.charAt(0).toUpperCase()
    )
    .join("");
}

}

/* =========================================================
PASSAPORTE
=========================================================
A IMPORTAÇÃO NÃO É FEITA AQUI.
É responsabilidade do passport-first.js.
========================================================= */

async function loadPassportStatus(clientId) {
if (!clientId) return;

try {
  const response = await api(
    `/api/passports/${encodeURIComponent(
      clientId
    )}/status`
  );

  state.passportValidation =
    response?.passportValidation ||
    response?.validation ||
    response?.passport ||
    null;

  renderPassportValidation();

  updateIdentityGate();
  updateReadiness();
} catch (error) {
  console.debug(
    "[PASSPORT STATUS]",
    error.message
  );

  state.passportValidation = null;

  resetPassportChecks();

  updateIdentityGate();
  updateReadiness();
}

}

function passportIsReady() {
const validation =
state.passportValidation;

if (!validation) return false;

if (
  validation.status === "passed" ||
  validation.ready === true
) {
  return true;
}

if (
  validation.success === true &&
  validation.valid !== false
) {
  return true;
}

return false;

}

function renderPassportValidation() {
const validation =
state.passportValidation;

if (!validation) {
  resetPassportChecks();
  return;
}

const passed =
  passportIsReady();

const mrz =
  validation.mrzValid ??
  validation.mrz?.valid ??
  validation.validation?.mrzValid;

const match =
  validation.clientMatch ??
  validation.match ??
  validation.validation?.clientMatch;

const expiry =
  validation.expired === false ||
  validation.expiryValid === true ||
  validation.validation?.expiryValid === true;

setDocumentCheck(
  "passportCheckFile",
  true
);

setDocumentCheck(
  "passportCheckMrz",
  typeof mrz === "boolean"
    ? mrz
    : passed
);

setDocumentCheck(
  "passportCheckMatch",
  typeof match === "boolean"
    ? match
    : passed
);

setDocumentCheck(
  "passportCheckExpiry",
  expiry
);

setDocumentCheck(
  "passportCheckStorage",
  passed
);

setPassportPanelStatus(
  passed
    ? "APROVADO"
    : "VERIFICAR",
  passed
    ? "success"
    : "error"
);

}

function setDocumentCheck(id, status) {
const element = $(id);

if (!element) return;

element.classList.remove(
  "pass",
  "fail",
  "pending"
);

if (status === true) {
  element.classList.add("pass");
  element.textContent = "✓";
} else if (status === false) {
  element.classList.add("fail");
  element.textContent = "!";
} else {
  element.classList.add("pending");
  element.textContent = "—";
}

}

function resetPassportChecks() {
[
"passportCheckFile",
"passportCheckMrz",
"passportCheckMatch",
"passportCheckExpiry",
"passportCheckStorage"
].forEach((id) => {
setDocumentCheck(id, null);
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

if (!element) return;

element.textContent = text;

element.className =
  `panel-status ${type}`;

}

/* =========================================================
PASSAPORT-FIRST EVENTS
========================================================= */

function setupPassportIntegration() {
/*
* passport-first.js cria automaticamente o cliente
* depois de validar o passaporte e dispara change
* nos selectors applicationClient / identityClient.
*/

[
  "applicationClient",
  "identityClient",
  "passportClientSelect"
].forEach((id) => {
  const element = $(id);

  if (!element) return;

  element.addEventListener(
    "change",
    async () => {
      await selectClient(
        element.value
      );
    }
  );
});

/*
 * Quando passport-first.js termina a importação,
 * atualizamos o estado sem interceptar o upload.
 */

document.addEventListener(
  "passport:first-success",
  async (event) => {
    const clientId =
      event.detail?.clientId ||
      event.detail?.client?._id ||
      event.detail?.client?.id;

    if (!clientId) {
      await loadClients();
      return;
    }

    await loadClients();

    /*
     * O passport-first.js pode ter acabado
     * de criar o cliente.
     */
    const client =
      getClientById(clientId);

    if (client) {
      await selectClient(
        clientId
      );
    }
  }
);

document.addEventListener(
  "passport:imported",
  async (event) => {
    const clientId =
      event.detail?.clientId;

    await loadClients();

    if (clientId) {
      await selectClient(
        clientId
      );
    }
  }
);

}

/* =========================================================
IDENTITY / FACIAL
========================================================= */

function updateFacialModuleSelection() {
const clientId =
state.selectedClientId;

if (!clientId) return;

const selectors = [
  $("identityClient"),
  $("applicationClient")
];

selectors.forEach((element) => {
  if (element) {
    element.value = clientId;
  }
});

/*
 * O facial-preflight-ui.js lê o cliente selecionado
 * a partir do applicationClient.
 */

}

function updateIdentityGate() {
const ready =
Boolean(
state.selectedClientId &&
passportIsReady()
);

setDisabled(
  "facialPreflightStart",
  !ready
);

const mount =
  $("facialPreflightMount");

if (mount) {
  mount.classList.toggle(
    "locked",
    !ready
  );
}

if (!ready) {
  setText(
    "facialPanelStatus",
    state.selectedClientId
      ? "Valide o passaporte primeiro."
      : "Aguardando passaporte."
  );

  return;
}

setText(
  "facialPanelStatus",
  state.facialReady
    ? "IDENTIDADE VALIDADA"
    : "Pronto para reconhecimento facial"
);

}

function setupFacialIntegration() {
/*
* Eventos genéricos emitidos pelo Identity Center.
* Não iniciamos câmera nem reconhecimento aqui.
*/

document.addEventListener(
  "facial:success",
  (event) => {
    const result =
      event.detail || {};

    if (
      result.clientId &&
      String(result.clientId) !==
        String(state.selectedClientId)
    ) {
      return;
    }

    state.facialReady = true;

    updateIdentityGate();
    updateReadiness();
    updateVfsGate();

    addActivity(
      "Identidade confirmada",
      "O reconhecimento facial foi concluído com sucesso.",
      "success"
    );

    setText(
      "heroGateMessage",
      "Identidade validada. A candidatura pode ser preparada."
    );
  }
);

document.addEventListener(
  "facial:failed",
  (event) => {
    state.facialReady = false;

    updateIdentityGate();
    updateReadiness();
    updateVfsGate();

    const reason =
      event.detail?.message ||
      "O reconhecimento facial precisa ser repetido.";

    showToast(
      reason,
      "error"
    );
  }
);

document.addEventListener(
  "facial:result",
  (event) => {
    const result =
      event.detail || {};

    const passed =
      result.passed === true ||
      result.success === true;

    state.facialReady =
      passed;

    updateIdentityGate();
    updateReadiness();
    updateVfsGate();
  }
);

}

/* =========================================================
APPLICATION READINESS
========================================================= */

function applicationIsReady() {
return Boolean(
state.selectedClientId &&
passportIsReady() &&
state.facialReady
);
}

function updateReadiness() {
const clientReady =
Boolean(state.selectedClientId);

const passportReady =
  passportIsReady();

const identityReady =
  Boolean(state.facialReady);

const applicationReady =
  Boolean(
    clientReady &&
    passportReady &&
    identityReady
  );

const operationReady =
  applicationReady;

let score = 0;

if (clientReady) score += 25;
if (passportReady) score += 25;
if (identityReady) score += 25;
if (applicationReady) score += 25;

setText(
  "readinessScore",
  `${score}%`
);

setReadinessRow(
  "readinessClient",
  clientReady
);

setReadinessRow(
  "readinessPassport",
  passportReady
);

setReadinessRow(
  "readinessIdentity",
  identityReady
);

setReadinessRow(
  "readinessApplication",
  applicationReady
);

setReadinessRow(
  "readinessOperation",
  operationReady
);

setDisabled(
  "applicationSubmitButton",
  !applicationReady
);

updateVfsGate();

updatePipeline(
  clientReady,
  passportReady,
  identityReady,
  applicationReady
);

}

function setReadinessRow(
id,
ready
) {
const element = $(id);

if (!element) return;

element.classList.toggle(
  "ready",
  Boolean(ready)
);

element.classList.toggle(
  "pending",
  !ready
);

const indicator =
  element.querySelector(
    "[data-readiness-indicator]"
  );

if (indicator) {
  indicator.textContent =
    ready ? "✓" : "—";
}

const text =
  element.querySelector(
    "[data-readiness-text]"
  );

if (text) {
  text.textContent =
    ready
      ? "Concluído"
      : "Aguardando";
}

}

/* =========================================================
VFS GATE
========================================================= */

function updateVfsGate() {
const clientReady =
Boolean(state.selectedClientId);

const passportReady =
  passportIsReady();

const faceReady =
  Boolean(state.facialReady);

const operationReady =
  Boolean(
    clientReady &&
    passportReady &&
    faceReady
  );

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
  faceReady
);

setGateCheck(
  "gateOperationCheck",
  operationReady
);

const icon =
  $("vfsGateIcon");

if (icon) {
  icon.textContent =
    operationReady
      ? "✓"
      : "•";
}

setText(
  "vfsGateTitle",
  operationReady
    ? "Operação pronta"
    : "Operação bloqueada"
);

setText(
  "vfsGateDescription",
  operationReady
    ? "Todos os requisitos anteriores foram concluídos."
    : "Conclua passaporte e identidade para avançar."
);

setText(
  "heroGateStatus",
  operationReady
    ? "PRONTO"
    : "EM PREPARAÇÃO"
);

setText(
  "heroGateMessage",
  operationReady
    ? "A candidatura está desbloqueada."
    : "O sistema desbloqueia cada etapa progressivamente."
);

setText(
  "heroRouteProgress",
  `${operationReady ? 100 : faceReady ? 75 : passportReady ? 50 : clientReady ? 25 : 0}%`
);

const security =
  $("applicationSecurityNotice");

if (security) {
  security.classList.toggle(
    "ready",
    operationReady
  );
}

setText(
  "applicationPanelStatus",
  operationReady
    ? "PRONTO PARA ENVIAR"
    : "AGUARDANDO REQUISITOS"
);

setDisabled(
  "applicationSubmitButton",
  !operationReady
);

}

function setGateCheck(
id,
ready
) {
const element = $(id);

if (!element) return;

element.classList.toggle(
  "ready",
  Boolean(ready)
);

element.classList.toggle(
  "pending",
  !ready
);

const icon =
  element.querySelector(
    "[data-gate-icon]"
  );

if (icon) {
  icon.textContent =
    ready ? "✓" : "—";
}

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
setPipelineState(
"bot1State",
passportReady
? "Concluído"
: clientReady
? "Em preparação"
: "Aguardando"
);

setPipelineState(
  "bot2State",
  identityReady
    ? "Concluído"
    : passportReady
      ? "Pronto"
      : "Bloqueado"
);

setPipelineState(
  "supervisorState",
  applicationReady
    ? "Operação pronta"
    : "Aguardando etapas"
);

const vfs =
  $("pipelineVfs");

if (vfs) {
  vfs.textContent =
    applicationReady
      ? "Pronto"
      : "Aguardando";
}

updateBotCenter(
  clientReady,
  passportReady,
  identityReady,
  applicationReady
);

}

function setPipelineState(
id,
text
) {
const element = $(id);

if (element) {
  element.textContent = text;
}

}

function updateBotCenter(
clientReady,
passportReady,
identityReady,
applicationReady
) {
setBot(
"bot1Indicator",
"bot1Progress",
"bot1LastAction",
passportReady,
passportReady
? 100
: clientReady
? 50
: 0,
passportReady
? "Passaporte validado"
: clientReady
? "Aguardando validação"
: "Aguardando viajante"
);

setBot(
  "bot2Indicator",
  "bot2Progress",
  "bot2LastAction",
  identityReady,
  identityReady
    ? 100
    : passportReady
      ? 50
      : 0,
  identityReady
    ? "Identidade confirmada"
    : passportReady
      ? "Pronto para reconhecimento"
      : "Bloqueado"
);

setBot(
  "supervisorIndicator",
  "supervisorProgress",
  "supervisorLastAction",
  applicationReady,
  applicationReady
    ? 100
    : identityReady
      ? 75
      : passportReady
        ? 50
        : clientReady
          ? 25
          : 0,
  applicationReady
    ? "Operação desbloqueada"
    : "Aguardando requisitos"
);

}

function setBot(
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
    "ready",
    Boolean(ready)
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
    `${progress}%`;
}

setText(
  actionId,
  action
);

}

/* =========================================================
APPLICATIONS
========================================================= */

async function loadApplications() {
try {
const response =
await api("/api/applications");

  state.applications =
    Array.isArray(response)
      ? response
      : response?.applications ||
        response?.data ||
        [];

  setText(
    "applicationCount",
    state.applications.length
  );

  setText(
    "preparedCount",
    state.applications.filter(
      (application) =>
        application.status === "prepared" ||
        application.status === "pending"
    ).length
  );

  setText(
    "monitoringCount",
    state.applications.filter(
      (application) =>
        [
          "monitoring",
          "radar",
          "vfs",
          "slot"
        ].includes(
          application.status
        )
    ).length
  );

  renderApplications();
} catch (error) {
  console.debug(
    "[APPLICATIONS]",
    error.message
  );

  state.applications = [];

  setText(
    "applicationCount",
    0
  );

  renderApplications();
}

}

function renderApplications() {
const container =
$("applicationsList");

if (!container) return;

if (!state.applications.length) {
  container.innerHTML = `
    <div class="empty-state">
      <strong>Nenhuma candidatura</strong>
      <span>
        A candidatura aparecerá aqui depois de ser preparada.
      </span>
    </div>
  `;

  return;
}

container.innerHTML =
  state.applications
    .map((application) => {
      const client =
        getClientById(
          application.clientId ||
          application.client?._id ||
          application.client?.id
        );

      const name =
        client
          ? getClientName(client)
          : application.clientName ||
            "Viajante";

      const status =
        application.status ||
        "pending";

      return `
        <article class="application-item">
          <div>
            <strong>
              ${escapeHtml(name)}
            </strong>

            <span>
              ${escapeHtml(
                application.visaType ||
                "Tipo de visto pendente"
              )}
            </span>
          </div>

          <div class="application-status ${escapeHtml(
            status
          )}">
            ${escapeHtml(
              translateStatus(status)
            )}
          </div>
        </article>
      `;
    })
    .join("");

}

function translateStatus(status) {
const map = {
pending: "Pendente",
prepared: "Preparada",
processing: "Em processamento",
submitted: "Enviada",
monitoring: "Em acompanhamento",
vfs: "VFS",
radar: "Radar",
slot: "Vaga",
completed: "Concluída",
failed: "Falhou"
};

return (
  map[status] ||
  status ||
  "Pendente"
);

}

async function submitApplication(
event
) {
event.preventDefault();

if (!applicationIsReady()) {
  showToast(
    "Conclua o passaporte e o reconhecimento facial antes de iniciar a candidatura.",
    "error"
  );

  updateVfsGate();
  return;
}

const form =
  event.currentTarget;

const visaType =
  $("applicationVisaType")?.value ||
  "";

const visaCenter =
  $("applicationVisaCenter")?.value ||
  "";

const travelPurpose =
  $("applicationTravelPurpose")?.value ||
  "";

const start =
  $("preferredStartDate")?.value ||
  "";

const end =
  $("preferredEndDate")?.value ||
  "";

const preferredTime =
  $("preferredTime")?.value ||
  "";

if (!visaType) {
  showToast(
    "Selecione o tipo de visto.",
    "error"
  );
  return;
}

if (!visaCenter) {
  showToast(
    "Selecione o centro de atendimento.",
    "error"
  );
  return;
}

setDisabled(
  "applicationSubmitButton",
  true
);

try {
  const idempotencyKey =
    `travel-${state.selectedClientId}-${Date.now()}`;

  const response =
    await api(
      "/api/applications",
      {
        method: "POST",

        headers: {
          "Idempotency-Key":
            idempotencyKey
        },

        body: JSON.stringify({
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
            start:
              start || null,

            end:
              end || null
          },

          preferredTime:
            preferredTime || null,

          preferredWeekdays: [],

          idempotencyKey
        })
      }
    );

  showToast(
    "Candidatura preparada com sucesso.",
    "success"
  );

  addActivity(
    "Candidatura preparada",
    "O processo foi entregue ao fluxo operacional.",
    "success"
  );

  state.currentStage =
    "tracking";

  await loadApplications();

  updateReadiness();
  updateVfsGate();

  form.reset();

} catch (error) {
  console.error(
    "[APPLICATION]",
    error
  );

  showToast(
    error.message ||
      "Não foi possível iniciar a candidatura.",
    "error"
  );
} finally {
  updateReadiness();
  updateVfsGate();
}

}

/* =========================================================
EVENTS
========================================================= */

function setupEvents() {
$("refreshButton")
?.addEventListener(
"click",
async () => {
await refreshAll();
}
);

$("applicationForm")
  ?.addEventListener(
    "submit",
    submitApplication
  );

/*
 * Compatibilidade com selects antigos.
 */
[
  "applicationClient",
  "identityClient",
  "passportClientSelect"
].forEach((id) => {
  const element = $(id);

  if (!element) return;

  element.addEventListener(
    "change",
    async () => {
      await selectClient(
        element.value
      );
    }
  );
});

/*
 * Campos da candidatura.
 */
[
  "applicationVisaType",
  "applicationVisaCenter",
  "applicationTravelPurpose",
  "preferredStartDate",
  "preferredEndDate",
  "preferredTime"
].forEach((id) => {
  const element = $(id);

  if (!element) return;

  element.addEventListener(
    "input",
    () => {
      updateVfsGate();
    }
  );

  element.addEventListener(
    "change",
    () => {
      updateVfsGate();
    }
  );
});

}

/* =========================================================
NAVIGATION
========================================================= */

function setupNavigation() {
const navigationItems =
document.querySelectorAll(
"[data-stage], [data-section]"
);

navigationItems.forEach(
  (item) => {
    item.addEventListener(
      "click",
      () => {
        const stage =
          item.dataset.stage ||
          item.dataset.section;

        if (!stage) return;

        navigateToStage(stage);
      }
    );
  }
);

}

function navigateToStage(stage) {
const normalized =
String(stage)
.toLowerCase();

const sections = {
  passport:
    $("documentsSection"),

  documents:
    $("documentsSection"),

  identity:
    $("applicationSection"),

  application:
    $("applicationSection"),

  tracking:
    $("verificationSection"),

  verification:
    $("verificationSection")
};

const target =
  sections[normalized];

if (target) {
  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

state.currentStage =
  normalized;

}

/* =========================================================
REFRESH
========================================================= */

async function refreshAll() {
if (state.loading) return;

state.loading = true;

try {
  await checkHealth();

  await loadClients();

  await loadApplications();

  if (state.selectedClientId) {
    await loadPassportStatus(
      state.selectedClientId
    );
  }

  updateSelectedClient();
  updateIdentityGate();
  updateReadiness();
  updateVfsGate();
} finally {
  state.loading = false;
}

}

/* =========================================================
INITIALIZATION
========================================================= */

async function init() {
try {
/*
* Não chamamos /api/auth/me.
* Não existe login neste frontend.
*/

  document.body.classList.add(
    "travel-app-ready"
  );

  $("appView")
    ?.classList
    .remove("hidden");

  setConnection(
    false,
    "A ligar ao sistema..."
  );

  setupEvents();
  setupNavigation();

  /*
   * Integrações externas:
   * passport-first.js
   * facial-preflight-ui.js
   */
  setupPassportIntegration();
  setupFacialIntegration();

  updateUserInterface();

  resetPassportChecks();

  updateIdentityGate();
  updateReadiness();
  updateVfsGate();

  await refreshAll();

  addActivity(
    "Sistema iniciado",
    "Travel Automation está pronto para receber um passaporte.",
    "blue"
  );

} catch (error) {
  console.error(
    "[INIT]",
    error
  );

  showToast(
    "O sistema foi carregado, mas algumas informações ainda não estão disponíveis.",
    "error"
  );
}

}

/* =========================================================
PUBLIC DEBUG API
========================================================= */

window.TravelAutomation = {
state,

refresh: refreshAll,

selectClient,

loadClients,

loadApplications,

updateReadiness,

updateVfsGate,

getSelectedClient() {
  return state.selectedClient;
},

isPassportReady() {
  return passportIsReady();
},

isFacialReady() {
  return state.facialReady;
}

};

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
