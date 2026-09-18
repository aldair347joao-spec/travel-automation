(() => {
"use strict";

/*

* ============================================================
* TRAVEL AUTOMATION — FRONTEND FINAL LAYER
* ============================================================
* 
* Objetivos:
* - preservar o frontend existente;
* - manter os IDs atuais;
* - manter as 10 posições faciais existentes;
* - limitar passaporte a 2 MB;
* - completar preferências;
* - criar aplicação sem iniciar automação;
* - colocar aplicação em AGUARDANDO ADMINISTRAÇÃO;
* - impedir "prepare" iniciado pelo cliente;
* - apresentar pagamento de forma clara;
* - manter credenciais VFS fora do cliente.
    */

const state = {
application: null,
submitting: false,
preferencesReady: false
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
return String(value ?? "")
.replaceAll("&", "&")
.replaceAll("<", "<")
.replaceAll(">", ">")
.replaceAll('"', """)
.replaceAll("'", "'");
}

function getCookie(name) {
return document.cookie
.split(";")
.map(item => item.trim())
.find(item => item.startsWith("${name}="))
?.split("=")
.slice(1)
.join("=") || null;
}

function getCsrfToken() {
return (
getCookie("csrf_token") ||
getCookie("csrfToken") ||
null
);
}

async function request(url, options = {}) {
const method = String(
options.method || "GET"
).toUpperCase();

const headers = {
  Accept: "application/json",
  ...(options.body !== undefined
    ? { "Content-Type": "application/json" }
    : {}),
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
  credentials: "include",
  ...options,
  method,
  headers
});

let data = null;

try {
  data = await response.json();
} catch {
  data = null;
}

if (!response.ok) {
  const error = new Error(
    data?.error ||
    data?.message ||
    `Erro HTTP ${response.status}`
  );

  error.status = response.status;
  error.data = data;

  throw error;
}

return data;

}

function toast(message, type = "info") {
if (typeof window.showToast === "function") {
window.showToast(message, type);
return;
}

const container = $("toastContainer");

if (!container) {
  return;
}

const element = document.createElement("div");

element.className = `toast ${type}`;
element.textContent = message;

container.appendChild(element);

setTimeout(() => {
  element.remove();
}, 4000);

}

/*

* ============================================================
* PASSAPORTE — LIMITE FINAL 2 MB
* ============================================================
  */

function configurePassportLimit() {
const input = $("passportFile");

if (!input) {
  return;
}

input.setAttribute(
  "accept",
  "image/jpeg,image/png"
);

const status = $("passportFileStatus");

function validateFile(file) {
  if (!file) {
    return true;
  }

  const maxBytes = 2 * 1024 * 1024;

  if (file.size > maxBytes) {
    if (status) {
      status.textContent =
        "O passaporte ultrapassa o limite de 2 MB.";
    }

    toast(
      "O passaporte deve ter no máximo 2 MB.",
      "error"
    );

    input.value = "";

    return false;
  }

  if (
    ![
      "image/jpeg",
      "image/png"
    ].includes(file.type)
  ) {
    if (status) {
      status.textContent =
        "Formato não suportado.";
    }

    toast(
      "Use uma imagem JPEG ou PNG.",
      "error"
    );

    input.value = "";

    return false;
  }

  return true;
}

input.addEventListener(
  "change",
  event => {
    const file = event.target.files?.[0];

    if (!validateFile(file)) {
      event.stopPropagation();
    }
  },
  true
);

const dropzone = $("passportDropzone");

if (dropzone) {
  dropzone.addEventListener(
    "drop",
    event => {
      const file = event.dataTransfer?.files?.[0];

      if (!validateFile(file)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
}

const limit = document.querySelector(
  ".passport-upload-limit"
);

if (limit) {
  limit.textContent = "MÁX. 2 MB";
}

}

/*

* ============================================================
* PREFERÊNCIAS
* ============================================================
  */

const WEEKDAYS = [
["MONDAY", "Segunda-feira"],
["TUESDAY", "Terça-feira"],
["WEDNESDAY", "Quarta-feira"],
["THURSDAY", "Quinta-feira"],
["FRIDAY", "Sexta-feira"],
["SATURDAY", "Sábado"],
["SUNDAY", "Domingo"]
];

function ensurePreferenceFields() {
const form = $("applicationForm");

if (!form) {
  return;
}

if ($("frontendFinalPreferences")) {
  return;
}

const wrapper = document.createElement("div");

wrapper.id = "frontendFinalPreferences";
wrapper.className = "frontend-final-preferences";

wrapper.innerHTML = `
  <div class="frontend-final-preferences-header">
    <span>CRITÉRIOS DE AGENDAMENTO</span>
    <strong>Preferências para a vaga</strong>
    <small>
      Estas preferências serão usadas pelo radar para
      identificar apenas vagas compatíveis.
    </small>
  </div>

  <div class="frontend-final-grid">

    <label class="field">
      <span>Tipo de serviço</span>

      <select
        id="frontendServiceType"
        name="serviceType"
      >
        <option value="">
          Selecionar serviço
        </option>

        <option value="STANDARD">
          Standard
        </option>

        <option value="EXPRESS">
          Express
        </option>
      </select>
    </label>

    <label class="field">
      <span>Modo de atendimento</span>

      <select
        id="frontendAppointmentMode"
        name="appointmentMode"
      >
        <option value="VFS_APPOINTMENT">
          Atendimento VFS
        </option>
      </select>
    </label>

  </div>

  <div class="frontend-final-weekdays">
    <span>Dias preferenciais</span>

    <div class="frontend-final-weekday-grid">
      ${WEEKDAYS.map(
        ([value, label]) => `
          <label class="frontend-final-day">
            <input
              type="checkbox"
              name="preferredWeekdays"
              value="${value}"
            >
            <span>${label}</span>
          </label>
        `
      ).join("")}
    </div>
  </div>

  <div
    id="frontendFinalPreferenceSummary"
    class="frontend-final-summary"
  >
    Complete os critérios para o radar.
  </div>
`;

const launch = form.querySelector(
  ".application-launch"
);

if (launch) {
  form.insertBefore(
    wrapper,
    launch
  );
} else {
  form.appendChild(wrapper);
}

wrapper
  .querySelectorAll("input, select")
  .forEach(element => {
    element.addEventListener(
      "change",
      updatePreferenceSummary
    );

    element.addEventListener(
      "input",
      updatePreferenceSummary
    );
  });

updatePreferenceSummary();

}

function getWeekdays() {
return Array.from(
document.querySelectorAll(
'input[name="preferredWeekdays"]:checked'
)
).map(
input => input.value
);
}

function updatePreferenceSummary() {
const summary = $(
"frontendFinalPreferenceSummary"
);

if (!summary) {
  return;
}

const days = getWeekdays();

const service =
  $("frontendServiceType")?.value ||
  "Qualquer serviço";

if (!days.length) {
  summary.textContent =
    `${service} · Todos os dias elegíveis`;
  return;
}

const labels = days.map(
  value =>
    WEEKDAYS.find(
      item => item[0] === value
    )?.[1] || value
);

summary.textContent =
  `${service} · ${labels.join(", ")}`;

}

function collectFinalPreferences() {
const visaType =
$("applicationVisaType")?.value ||
"";

const visaCenter =
  $("applicationVisaCenter")
    ?.value
    ?.trim() ||
  "";

const start =
  $("preferredStartDate")?.value ||
  "";

const end =
  $("preferredEndDate")?.value ||
  "";

const preferredTime =
  $("preferredTime")?.value ||
  "ANY";

const serviceType =
  $("frontendServiceType")?.value ||
  null;

const appointmentMode =
  $("frontendAppointmentMode")?.value ||
  "VFS_APPOINTMENT";

const weekdays =
  getWeekdays();

return {
  visaType,
  visaCenter,
  travelPurpose:
    $("applicationTravelPurpose")
      ?.value
      ?.trim() ||
    null,

  serviceType,
  appointmentMode,

  preferredDates: {
    start: start || null,
    end: end || null
  },

  preferredTime,

  preferredWeekdays:
    weekdays
};

}

function validateFinalPreferences(
preferences
) {
if (
![
"SCHENGEN",
"NACIONAL"
].includes(
preferences.visaType
)
) {
return "Selecione o tipo de visto.";
}

if (!preferences.visaCenter) {
  return "O centro VFS é obrigatório.";
}

if (
  !preferences.preferredDates.start ||
  !preferences.preferredDates.end
) {
  return "Defina a janela de datas.";
}

if (
  preferences.preferredDates.start >
  preferences.preferredDates.end
) {
  return "A data inicial não pode ser posterior à data final.";
}

return null;

}

/*

* ============================================================
* APLICAÇÃO
* ============================================================
  */

function canCreateFinalApplication() {
const passportPassed =
window.TravelAutomationPassportPassed === true ||
document.querySelector(
"#passportValidationBadge"
)?.textContent
?.trim()
?.toUpperCase()
?.includes("VALID");

const facialReady =
  window.TravelAutomationFacialReady === true;

const client =
  $("applicationClient")?.value ||
  "";

return Boolean(
  client &&
  (
    passportPassed !== false
  ) &&
  (
    facialReady !== false
  )
);

}

function setApplicationButtonState() {
const button =
$("applicationSubmitButton");

if (!button) {
  return;
}

const preferences =
  collectFinalPreferences();

const error =
  validateFinalPreferences(
    preferences
  );

const hasClient =
  Boolean(
    $("applicationClient")?.value
  );

/*
 * A camada final não bloqueia por uma variável
 * interna do motor facial. O backend continua
 * sendo a autoridade.
 */

button.disabled =
  !hasClient ||
  Boolean(error);

if (button.disabled) {
  button.title =
    error ||
    "Complete os dados da candidatura.";
} else {
  button.title =
    "Enviar candidatura para administração.";
}

}

async function submitFinalApplication(
event
) {
event.preventDefault();
event.stopPropagation();
event.stopImmediatePropagation();

if (state.submitting) {
  return;
}

const form =
  event.currentTarget;

const clientId =
  $("applicationClient")?.value ||
  "";

if (!clientId) {
  toast(
    "Selecione o viajante.",
    "error"
  );
  return;
}

const preferences =
  collectFinalPreferences();

const validationError =
  validateFinalPreferences(
    preferences
  );

if (validationError) {
  toast(
    validationError,
    "error"
  );
  return;
}

const button =
  $("applicationSubmitButton");

state.submitting = true;

if (button) {
  button.disabled = true;
  button.innerHTML =
    "A enviar para administração...";
}

try {
  const response =
    await request(
      "/api/applications",
      {
        method: "POST",

        body: JSON.stringify({
          clientId,
          ...preferences
        })
      }
    );

  state.application =
    response?.application ||
    response?.data ||
    response ||
    null;

  renderAdminWaitingState(
    state.application
  );

  toast(
    "Processo enviado. Aguarde a liberação da administração.",
    "success"
  );

  updateActivity(
    "Processo enviado à administração",
    "A automação permanece bloqueada até a liberação administrativa."
  );

  form.reset();

  if ($("applicationClient")) {
    $("applicationClient").value =
      clientId;
  }

  updatePreferenceSummary();

  await refreshApplications();

} catch (error) {
  console.error(
    "[FRONTEND-FINAL] application:",
    error
  );

  toast(
    error.message ||
    "Não foi possível enviar a candidatura.",
    "error"
  );
} finally {
  state.submitting = false;

  if (button) {
    button.disabled = false;

    button.innerHTML = `
      Enviar para administração
      <span>→</span>
    `;

    setApplicationButtonState();
  }
}

}

/*

* ============================================================
* BLOQUEIO DO PREPARE NO CLIENTE
* ============================================================
  */

function installPrepareGuard() {
document.addEventListener(
"click",
event => {
const button =
event.target.closest(
'[data-action="prepare"]'
);

    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    renderAdminWaitingState();

    toast(
      "Este processo está aguardando liberação da administração.",
      "info"
    );
  },
  true
);

}

/*

* ============================================================
* ESTADO ADMINISTRATIVO
* ============================================================
  */

function getAdminState(application) {
return (
application?.admin?.status ||
application?.adminControl?.status ||
"PENDING_REVIEW"
);
}

function getWorkflowState(application) {
return (
application?.workflowState ||
application?.workflow?.state ||
application?.status ||
"created"
);
}

function renderAdminWaitingState(
application = state.application
) {
let panel =
$("frontendAdminWaiting");

if (!panel) {
  panel =
    document.createElement("section");

  panel.id =
    "frontendAdminWaiting";

  panel.className =
    "frontend-final-admin-waiting";

  const applicationsSection =
    $("verificationSection");

  if (applicationsSection) {
    applicationsSection.parentNode.insertBefore(
      panel,
      applicationsSection
    );
  } else {
    document
      .querySelector(".dashboard-main")
      ?.appendChild(panel);
  }
}

const status =
  getAdminState(application);

const workflow =
  getWorkflowState(application);

const released =
  application?.admin?.released === true ||
  application?.admin?.release?.enabled === true;

if (released) {
  panel.innerHTML = `
    <div class="frontend-final-status-icon success">
      ✓
    </div>

    <div class="frontend-final-status-copy">
      <span>AUTOMAÇÃO LIBERADA</span>

      <strong>
        O processo está autorizado.
      </strong>

      <small>
        A administração configurou o acesso VFS
        e liberou a execução automática.
      </small>
    </div>

    <div class="frontend-final-status-badge active">
      ${escapeHtml(status)}
    </div>
  `;

  return;
}

panel.innerHTML = `
  <div class="frontend-final-status-icon">
    ⏳
  </div>

  <div class="frontend-final-status-copy">
    <span>AGUARDANDO ADMINISTRAÇÃO</span>

    <strong>
      O seu processo foi recebido.
    </strong>

    <small>
      A administração irá verificar os dados,
      configurar o acesso necessário e liberar
      a automação. Não é necessária nenhuma ação
      adicional nesta etapa.
    </small>

    <div class="frontend-final-state-row">
      <span>Estado</span>
      <strong>
        ${escapeHtml(
          labelWorkflow(
            workflow
          )
        )}
      </strong>
    </div>
  </div>

  <div class="frontend-final-status-badge pending">
    AGUARDANDO
  </div>
`;

}

function labelWorkflow(state) {
const map = {
created:
"Processo criado",

  PENDING_REVIEW:
    "Aguardando administração",

  READY_FOR_AUTOMATION:
    "Pronto para automação",

  AUTOMATION_ACTIVE:
    "Automação ativa",

  RADAR_ACTIVE:
    "Radar ativo",

  SLOT_FOUND:
    "Vaga encontrada",

  SLOT_LOCKED:
    "Vaga em validação",

  BOOKING:
    "Agendamento",

  APPOINTMENT_BOOKED:
    "Agendamento concluído",

  PAYMENT_PENDING:
    "Pagamento pendente",

  PAYMENT_CONFIRMED:
    "Pagamento confirmado",

  COMPLETED:
    "Concluído",

  PAUSED:
    "Automação pausada",

  CANCELLED:
    "Cancelado"
};

return (
  map[state] ||
  state ||
  "A preparar"
);

}

/*

* ============================================================
* PAGAMENTO
* ============================================================
  */

function renderPayment(application) {
const result =
application?.result ||
application?.payment ||
null;

if (
  !result ||
  !(
    result.reference ||
    result.entity ||
    result.paymentAmount ||
    result.paymentStatus
  )
) {
  return;
}

let panel =
  $("frontendPaymentPanel");

if (!panel) {
  panel =
    document.createElement("section");

  panel.id =
    "frontendPaymentPanel";

  panel.className =
    "frontend-final-payment";

  const waiting =
    $("frontendAdminWaiting");

  const verification =
    $("verificationSection");

  (
    waiting ||
    verification
  )?.parentNode.insertBefore(
    panel,
    (
      waiting ||
      verification
    ).nextSibling
  );
}

const status =
  String(
    result.paymentStatus ||
    "pending"
  ).toLowerCase();

const confirmed =
  [
    "confirmed",
    "paid",
    "completed"
  ].includes(status);

const statusLabel =
  confirmed
    ? "PAGAMENTO CONFIRMADO"
    : "PAGAMENTO PENDENTE";

panel.innerHTML = `
  <div class="frontend-final-payment-header">
    <div>
      <span>PAGAMENTO</span>
      <strong>
        ${statusLabel}
      </strong>
    </div>

    <div class="
      frontend-final-payment-status
      ${confirmed ? "confirmed" : "pending"}
    ">
      ${confirmed ? "✓" : "!"}
    </div>
  </div>

  <div class="frontend-final-payment-grid">

    <div>
      <span>REFERÊNCIA</span>
      <strong>
        ${escapeHtml(
          result.reference || "—"
        )}
      </strong>
    </div>

    <div>
      <span>ENTIDADE</span>
      <strong>
        ${escapeHtml(
          result.entity || "—"
        )}
      </strong>
    </div>

    <div>
      <span>VALOR</span>
      <strong>
        ${escapeHtml(
          result.paymentAmount ?? "—"
        )}
        ${escapeHtml(
          result.paymentCurrency || ""
        )}
      </strong>
    </div>

    <div>
      <span>PRAZO</span>
      <strong>
        ${escapeHtml(
          result.paymentDeadline || "—"
        )}
      </strong>
    </div>

  </div>

  ${
    result.confirmationUrl
      ? `
        <a
          class="frontend-final-confirmation-link"
          href="${escapeHtml(
            result.confirmationUrl
          )}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver confirmação
          →
        </a>
      `
      : ""
  }

  <p>
    ${
      confirmed
        ? "O pagamento foi confirmado."
        : "O agendamento foi realizado e o pagamento ainda está pendente. Efetue o pagamento dentro do prazo indicado."
    }
  </p>
`;

}

/*

* ============================================================
* APPLICATION LIST / STATUS
* ============================================================
  */

async function refreshApplications() {
try {
const response =
await request(
"/api/applications"
);

  const applications =
    Array.isArray(
      response
    )
      ? response
      : (
          response?.applications ||
          response?.data ||
          []
        );

  const latest =
    applications[0] ||
    null;

  if (latest) {
    state.application =
      latest;

    renderAdminWaitingState(
      latest
    );

    renderPayment(
      latest
    );
  }

  updatePipeline(
    latest
  );

  return applications;
} catch (error) {
  console.warn(
    "[FRONTEND-FINAL] applications:",
    error
  );

  return [];
}

}

function updatePipeline(
application
) {
if (!application) {
return;
}

const workflow =
  getWorkflowState(
    application
  );

const admin =
  getAdminState(
    application
  );

const released =
  application?.admin?.released === true ||
  application?.admin?.release?.enabled === true;

const bot1 =
  application?.bot1?.status ||
  "idle";

const bot2 =
  application?.bot2?.status ||
  "idle";

const bot1State =
  $("bot1State");

const bot2State =
  $("bot2State");

const supervisorState =
  $("supervisorState");

if (bot1State) {
  bot1State.textContent =
    released
      ? labelWorkflow(
          workflow
        )
      : "Aguardando admin";
}

if (bot2State) {
  bot2State.textContent =
    released
      ? labelWorkflow(
          workflow
        )
      : "Bloqueado";
}

if (supervisorState) {
  supervisorState.textContent =
    released
      ? (
          bot2 === "monitoring"
            ? "Ativo"
            : labelWorkflow(
                admin
              )
        )
      : "Aguardando admin";
}

const bot1Indicator =
  $("bot1Indicator");

const bot2Indicator =
  $("bot2Indicator");

const supervisorIndicator =
  $("supervisorIndicator");

bot1Indicator?.classList.toggle(
  "online",
  released &&
  [
    "running",
    "starting",
    "continuing"
  ].includes(
    String(bot1)
  )
);

bot2Indicator?.classList.toggle(
  "online",
  released &&
  (
    application?.bot2?.monitoring === true ||
    bot2 === "monitoring"
  )
);

supervisorIndicator?.classList.toggle(
  "online",
  released
);

}

/*

* ============================================================
* ACTIVITY
* ============================================================
  */

function updateActivity(
title,
description
) {
const feed =
$("activityFeed");

if (!feed) {
  return;
}

const item =
  document.createElement("div");

item.className =
  "activity-item";

item.innerHTML = `
  <div class="activity-marker blue"></div>

  <div>
    <strong>
      ${escapeHtml(title)}
    </strong>

    <span>
      ${escapeHtml(description)}
    </span>
  </div>
`;

feed.prepend(item);

while (
  feed.children.length > 6
) {
  feed.lastElementChild.remove();
}

}

/*

* ============================================================
* OBSERVAÇÃO DO FRONTEND
* ============================================================
  */

function installApplicationObserver() {
const list =
$("applicationsList");

if (!list) {
  return;
}

const observer =
  new MutationObserver(() => {
    list
      .querySelectorAll(
        '[data-action="prepare"]'
      )
      .forEach(button => {
        button.textContent =
          "Aguardando administração";

        button.disabled = true;

        button.removeAttribute(
          "data-action"
        );

        button.classList.add(
          "admin-gated"
        );
      });
  });

observer.observe(
  list,
  {
    childList: true,
    subtree: true
  }
);

}

/*

* ============================================================
* EVENTOS
* ============================================================
  */

function installApplicationSubmitGuard() {
const form =
$("applicationForm");

if (!form) {
  return;
}

form.addEventListener(
  "submit",
  submitFinalApplication,
  true
);

form
  .querySelectorAll(
    "input, select"
  )
  .forEach(element => {
    element.addEventListener(
      "input",
      setApplicationButtonState
    );

    element.addEventListener(
      "change",
      setApplicationButtonState
    );
  });

setApplicationButtonState();

}

function installPassportBridge() {
document.addEventListener(
"passport:validated",
event => {
const passed =
event.detail?.status ===
"passed";

    window.TravelAutomationPassportPassed =
      passed;

    if (passed) {
      updateActivity(
        "Passaporte validado",
        "O perfil do viajante foi preparado automaticamente."
      );
    }
  }
);

}

/*

* ============================================================
* INIT
* ============================================================
  */

async function init() {
configurePassportLimit();

ensurePreferenceFields();

installApplicationSubmitGuard();

installPrepareGuard();

installApplicationObserver();

installPassportBridge();

await refreshApplications();

setInterval(
  refreshApplications,
  15000
);

}

if (
document.readyState ===
"loading"
) {
document.addEventListener(
"DOMContentLoaded",
init,
{ once: true }
);
} else {
init();
}

window.TravelAutomationFrontend = {
refreshApplications,
collectFinalPreferences,
renderPayment,
renderAdminWaitingState
};
})();
