(() => {
"use strict";

/*

* ==========================================================
* TRAVEL AUTOMATION
* Preferências da viagem
* 
* IMPORTANTE:
* Este arquivo NÃO controla a visibilidade da página principal.
* Não esconde #appView, #loginView ou outras secções.
* Não remove elementos existentes.
* Não substitui a lógica principal do app.js.
* ==========================================================
  */

const STORAGE_KEY = "travelAutomation.preferences";

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
residenceCountry: "AO",
destinationCountry: "PT",
center: "",
visaType: "",
travelDate: "",
appointmentDeadline: "",
timePreference: "",
flexibility: "any"
};

let initialized = false;

/*

* ---
* STORAGE
* ---

*/

function getPreferences() {
try {
const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return { ...DEFAULTS };
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULTS };
  }

  return {
    ...DEFAULTS,
    ...parsed
  };
} catch (error) {
  console.warn(
    "[TravelWorkflow] Não foi possível ler as preferências.",
    error
  );

  return { ...DEFAULTS };
}

}

function savePreferences() {
const preferences = {
residenceCountry:
$("travelResidenceCountry")?.value ||
DEFAULTS.residenceCountry,

  destinationCountry:
    $("travelDestination")?.value ||
    DEFAULTS.destinationCountry,

  center:
    $("travelCenter")?.value ||
    DEFAULTS.center,

  visaType:
    $("travelVisaType")?.value ||
    DEFAULTS.visaType,

  travelDate:
    $("travelDate")?.value ||
    DEFAULTS.travelDate,

  appointmentDeadline:
    $("travelAppointmentDeadline")?.value ||
    DEFAULTS.appointmentDeadline,

  timePreference:
    $("travelTimePreference")?.value ||
    DEFAULTS.timePreference,

  flexibility:
    $("travelFlexibility")?.value ||
    DEFAULTS.flexibility
};

try {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(preferences)
  );
} catch (error) {
  console.warn(
    "[TravelWorkflow] Não foi possível guardar as preferências.",
    error
  );
}

document.dispatchEvent(
  new CustomEvent("travel:preferencesChanged", {
    detail: preferences
  })
);

return preferences;

}

function restorePreferences() {
const preferences = getPreferences();

const fields = {
  travelResidenceCountry:
    preferences.residenceCountry,

  travelDestination:
    preferences.destinationCountry,

  travelCenter:
    preferences.center,

  travelVisaType:
    preferences.visaType,

  travelDate:
    preferences.travelDate,

  travelAppointmentDeadline:
    preferences.appointmentDeadline,

  travelTimePreference:
    preferences.timePreference,

  travelFlexibility:
    preferences.flexibility
};

Object.entries(fields).forEach(([id, value]) => {
  const element = $(id);

  if (!element) {
    return;
  }

  element.value = value ?? "";
});

updateVisaCards();
updateSummary();

}

/*

* ---
* TRAVEL SECTION
* 
* Só cria a secção se existir um mount explícito:
* #travelWorkflowMount
* 
* Nunca substitui o conteúdo principal da página.
* ---

*/

function createTravelSection() {
const existing = $("travelSection");

if (existing) {
  return existing;
}

const mount = $("travelWorkflowMount");

if (!mount) {
  return null;
}

const section = document.createElement("section");

section.id = "travelSection";
section.className =
  "panel travel-preferences-panel workflow-generated-section";

section.innerHTML = `
  <div class="travel-preferences-hero">

    <div class="travel-preferences-route">

      <div class="country-node">
        <span class="country-flag">AO</span>

        <div>
          <small>Origem</small>
          <strong>Angola</strong>
        </div>
      </div>

      <div class="country-route">

        <span class="route-dash"></span>

        <span class="route-plane" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M21 3 3.8 10.2c-.8.3-.8 1.4 0 1.7l6.3 2.3 2.3 6.3c.3.8 1.4 1.4 1.7 0L21 3Z"
            ></path>

            <path d="m10.1 14.1 4.5-4.5"></path>
          </svg>
        </span>

        <span class="route-dash"></span>

      </div>

      <div class="country-node">

        <span class="country-flag">PT</span>

        <div>
          <small>Destino</small>
          <strong>Portugal</strong>
        </div>

      </div>

    </div>

    <div class="travel-preferences-copy">

      <span class="travel-kicker">
        PERFIL DA VIAGEM
      </span>

      <h2>
        A sua viagem para Portugal
      </h2>

      <p>
        Defina os dados da viagem para que o sistema
        consiga acompanhar a disponibilidade correspondente.
      </p>

    </div>

  </div>

  <form
    id="travelPreferencesForm"
    class="travel-preferences-form"
  >

    <div class="travel-section-heading">

      <div>
        <span>01</span>
        <strong>Rota</strong>
      </div>

      <small>
        Informação base da viagem
      </small>

    </div>

    <div class="travel-fields-grid">

      <label class="travel-field">

        <span>País de residência</span>

        <div class="travel-readonly-field">

          <span class="field-country-badge">
            AO
          </span>

          <strong>Angola</strong>

          <small>
            Residência atual
          </small>

        </div>

        <input
          id="travelResidenceCountry"
          type="hidden"
          value="AO"
        >

      </label>

      <label class="travel-field">

        <span>País de destino</span>

        <div class="travel-readonly-field">

          <span class="field-country-badge">
            PT
          </span>

          <strong>Portugal</strong>

          <small>
            Destino do processo
          </small>

        </div>

        <input
          id="travelDestination"
          type="hidden"
          value="PT"
        >

      </label>

      <label class="travel-field">

        <span>
          Centro de atendimento
        </span>

        <select
          id="travelCenter"
          required
        >

          <option value="">
            Selecionar centro
          </option>

          <option value="luanda">
            Luanda
          </option>

        </select>

      </label>

    </div>

    <div class="travel-section-heading visa-heading">

      <div>
        <span>02</span>
        <strong>Tipo de visto</strong>
      </div>

      <small>
        Escolha o tipo correspondente ao processo
      </small>

    </div>

    <div
      id="travelVisaOptions"
      class="visa-options"
      role="radiogroup"
      aria-label="Tipo de visto"
    >

      <button
        type="button"
        class="visa-option"
        data-visa="schengen"
        aria-pressed="false"
      >

        <span class="visa-option-icon">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M12 3 4.5 6v5.5c0 4.6 3.1 7.7 7.5 9.5 4.4-1.8 7.5-4.9 7.5-9.5V6L12 3Z"
            ></path>

            <path
              d="m8.5 12 2.2 2.2 4.8-5"
            ></path>
          </svg>
        </span>

        <span class="visa-option-content">

          <strong>
            Schengen
          </strong>

          <small>
            Processo para estadias de curta duração
          </small>

        </span>

        <span class="visa-option-check"></span>

      </button>

      <button
        type="button"
        class="visa-option"
        data-visa="national"
        aria-pressed="false"
      >

        <span class="visa-option-icon">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M5 20h14"></path>
            <path d="M7 20V9l5-5 5 5v11"></path>
            <path d="M9.5 12h5"></path>
            <path d="M9.5 15h5"></path>
          </svg>
        </span>

        <span class="visa-option-content">

          <strong>
            Nacional
          </strong>

          <small>
            Processo para estadias de longa duração
          </small>

        </span>

        <span class="visa-option-check"></span>

      </button>

    </div>

    <input
      id="travelVisaType"
      type="hidden"
      value=""
    >

    <div class="travel-section-heading">

      <div>
        <span>03</span>
        <strong>
          Preferências de marcação
        </strong>
      </div>

      <small>
        Critérios utilizados no acompanhamento
      </small>

    </div>

    <div class="travel-fields-grid">

      <label class="travel-field">

        <span>
          Data prevista da viagem
        </span>

        <input
          id="travelDate"
          type="date"
        >

      </label>

      <label class="travel-field">

        <span>
          Data limite para conseguir a vaga
        </span>

        <input
          id="travelAppointmentDeadline"
          type="date"
        >

      </label>

      <label class="travel-field">

        <span>
          Horário preferido
        </span>

        <select id="travelTimePreference">

          <option value="">
            Qualquer horário
          </option>

          <option value="morning">
            Manhã
          </option>

          <option value="afternoon">
            Tarde
          </option>

        </select>

      </label>

      <label class="travel-field">

        <span>
          Flexibilidade
        </span>

        <select id="travelFlexibility">

          <option value="any">
            Aceito qualquer vaga
          </option>

          <option value="same-week">
            Aceito qualquer dia da semana
          </option>

          <option value="strict">
            Apenas dentro das datas indicadas
          </option>

        </select>

      </label>

    </div>

    <div class="travel-preferences-summary">

      <div class="summary-route">

        <span class="summary-dot"></span>

        <div>
          <small>
            Rota configurada
          </small>

          <strong>
            Angola → Portugal
          </strong>
        </div>

      </div>

      <div
        id="travelPreferenceSummary"
        class="summary-visa"
      >

        <small>
          Tipo de visto
        </small>

        <strong>
          Selecione uma opção
        </strong>

      </div>

    </div>

  </form>
`;

/*
 * Apenas adiciona a secção dentro do mount.
 * Não mexemos em nenhuma outra parte da página.
 */
mount.appendChild(section);

bindTravelForm(section);

return section;

}

/*

* ---
* VISA
* ---

*/

function updateVisaCards() {
const value =
$("travelVisaType")?.value || "";

document
  .querySelectorAll(".visa-option")
  .forEach((button) => {
    const active =
      button.dataset.visa === value;

    button.classList.toggle(
      "selected",
      active
    );

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });

}

function updateSummary() {
const summary =
$("travelPreferenceSummary");

if (!summary) {
  return;
}

const title =
  summary.querySelector("strong");

if (!title) {
  return;
}

const visa =
  $("travelVisaType")?.value || "";

if (visa === "schengen") {
  title.textContent =
    "Visto Schengen";
  return;
}

if (visa === "national") {
  title.textContent =
    "Visto Nacional";
  return;
}

title.textContent =
  "Selecione uma opção";

}

/*

* ---
* FORM
* ---

*/

function bindTravelForm(section) {
if (!section) {
return;
}

const form =
  section.querySelector(
    "#travelPreferencesForm"
  );

if (!form) {
  return;
}

const visaButtons =
  section.querySelectorAll(
    ".visa-option"
  );

visaButtons.forEach((button) => {
  button.addEventListener(
    "click",
    () => {
      const value =
        button.dataset.visa || "";

      const input =
        $("travelVisaType");

      if (input) {
        input.value = value;
      }

      updateVisaCards();
      updateSummary();
      savePreferences();
      updateStatus();
    }
  );
});

form.addEventListener(
  "input",
  () => {
    savePreferences();
    updateStatus();
  }
);

form.addEventListener(
  "change",
  () => {
    updateVisaCards();
    updateSummary();
    savePreferences();
    updateStatus();
  }
);

restorePreferences();

}

/*

* ---
* VALIDATION
* ---

*/

function isTravelReady() {
const visa =
$("travelVisaType")?.value || "";

const center =
  $("travelCenter")?.value || "";

return Boolean(
  visa &&
  center
);

}

function getStatus() {
const preferences =
getPreferences();

return {
  ready: isTravelReady(),

  complete:
    Boolean(
      preferences.visaType &&
      preferences.center
    ),

  preferences
};

}

function updateStatus() {
const status =
getStatus();

document.dispatchEvent(
  new CustomEvent(
    "travel:statusChanged",
    {
      detail: status
    }
  )
);

return status;

}

/*

* ---
* PUBLIC API
* ---

*/

const TravelWorkflow = {
getPreferences,
savePreferences,
restorePreferences,
getStatus,
isTravelReady,
updateStatus,
createTravelSection,

getVisaType() {
  return (
    $("travelVisaType")?.value ||
    getPreferences().visaType ||
    ""
  );
},

getCenter() {
  return (
    $("travelCenter")?.value ||
    getPreferences().center ||
    ""
  );
},

clearPreferences() {
  try {
    localStorage.removeItem(
      STORAGE_KEY
    );
  } catch (error) {
    console.warn(
      "[TravelWorkflow] Não foi possível limpar as preferências.",
      error
    );
  }

  const fields = [
    "travelCenter",
    "travelVisaType",
    "travelDate",
    "travelAppointmentDeadline",
    "travelTimePreference",
    "travelFlexibility"
  ];

  fields.forEach((id) => {
    const element = $(id);

    if (element) {
      element.value = "";
    }
  });

  const flexibility =
    $("travelFlexibility");

  if (flexibility) {
    flexibility.value = "any";
  }

  updateVisaCards();
  updateSummary();
  updateStatus();
}

};

/*

* ---
* INITIALIZATION
* ---

*/

function initialize() {
if (initialized) {
return;
}

initialized = true;

/*
 * Só criamos a viagem quando existe
 * explicitamente um ponto de montagem.
 *
 * Se #travelWorkflowMount não existir,
 * o workflow simplesmente não interfere
 * na página.
 */
createTravelSection();

restorePreferences();
updateStatus();

document.dispatchEvent(
  new CustomEvent(
    "travel:workflowReady"
  )
);

}

/*

* Não executamos nada agressivamente.
* 
* Se o DOM ainda não estiver pronto,
* aguardamos.
  */

if (
document.readyState ===
"loading"
) {
document.addEventListener(
"DOMContentLoaded",
initialize,
{ once: true }
);
} else {
initialize();
}

/*

* Disponibiliza a API sem interferir
* no restante da aplicação.
  */

window.TravelWorkflow =
TravelWorkflow;

})();
