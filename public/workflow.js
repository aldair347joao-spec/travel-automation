(() => {
  "use strict";

  /*
   * ==========================================================
   * TRAVEL AUTOMATION
   * Fluxo principal Angola → Portugal
   * ==========================================================
   */

  const STORAGE_KEY = "travelAutomation.preferences";

  const STEPS = [
    {
      id: "client",
      number: "01",
      icon: "person",
      title: "Perfil",
      eyebrow: "PRIMEIRA ETAPA",
      description: "Começamos pelos dados do viajante.",
      section: "clientSection"
    },

    {
      id: "travel",
      number: "02",
      icon: "route",
      title: "Viagem",
      eyebrow: "SEGUNDA ETAPA",
      description:
        "Defina a viagem para Portugal e o tipo de visto para encontrarmos a vaga certa.",
      section: null
    },

    {
      id: "passport",
      number: "03",
      icon: "document",
      title: "Documentos",
      eyebrow: "TERCEIRA ETAPA",
      description:
        "Confirme o passaporte e os documentos necessários para continuar.",
      section: "clientSection"
    },

    {
      id: "identity",
      number: "04",
      icon: "face",
      title: "Identidade",
      eyebrow: "QUARTA ETAPA",
      description:
        "Faça a confirmação facial seguindo as instruções apresentadas.",
      section: "applicationSection"
    },

    {
      id: "application",
      number: "05",
      icon: "application",
      title: "Candidatura",
      eyebrow: "QUINTA ETAPA",
      description:
        "Revise o processo antes de iniciar o acompanhamento.",
      section: "applicationSection"
    },

    {
      id: "operations",
      number: "06",
      icon: "radar",
      title: "Acompanhamento",
      eyebrow: "SEXTA ETAPA",
      description:
        "Acompanhamos a disponibilidade de vagas de acordo com o seu perfil.",
      section: "verificationSection"
    }
  ];

  const state = {
    currentIndex: 0,
    completed: new Set(),
    initialized: false,
    transitioning: false
  };

  const $ = (id) => document.getElementById(id);

  function currentStep() {
    return STEPS[state.currentIndex];
  }

  function getPreferences() {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}"
      );
    } catch {
      return {};
    }
  }

  function savePreferences() {
    const preferences = {
      residenceCountry: $("travelResidenceCountry")?.value || "AO",
      destinationCountry: $("travelDestination")?.value || "PT",
      center: $("travelCenter")?.value || "",
      visaType: $("travelVisaType")?.value || "",
      travelDate: $("travelDate")?.value || "",
      appointmentDeadline:
        $("travelAppointmentDeadline")?.value || "",
      timePreference:
        $("travelTimePreference")?.value || "",
      flexibility:
        $("travelFlexibility")?.value || ""
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(preferences)
    );

    document.dispatchEvent(
      new CustomEvent("travel:preferencesChanged", {
        detail: preferences
      })
    );

    return preferences;
  }

  function restorePreferences() {
    const data = getPreferences();

    const fields = {
      travelResidenceCountry: data.residenceCountry || "AO",
      travelDestination: data.destinationCountry || "PT",
      travelCenter: data.center || "",
      travelVisaType: data.visaType || "",
      travelDate: data.travelDate || "",
      travelAppointmentDeadline:
        data.appointmentDeadline || "",
      travelTimePreference:
        data.timePreference || "",
      travelFlexibility:
        data.flexibility || ""
    };

    Object.entries(fields).forEach(([id, value]) => {
      const element = $(id);

      if (element) {
        element.value = value;
      }
    });

    updateVisaCards();
  }

  function createTravelSection() {
    if ($("travelSection")) {
      return $("travelSection");
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
            <span class="route-plane">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 3 3.8 10.2c-.8.3-.8 1.4 0 1.7l6.3 2.3 2.3 6.3c.3.8 1.4.8 1.7 0L21 3Z"></path>
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
            Estas preferências ajudam o sistema a identificar
            a vaga correspondente ao seu processo.
          </p>
        </div>

      </div>

      <form id="travelPreferencesForm" class="travel-preferences-form">

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
              <span class="field-country-badge">AO</span>
              <strong>Angola</strong>
              <small>Residência atual</small>
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
              <span class="field-country-badge">PT</span>
              <strong>Portugal</strong>
              <small>Destino do processo</small>
            </div>

            <input
              id="travelDestination"
              type="hidden"
              value="PT"
            >
          </label>

          <label class="travel-field">
            <span>Centro de atendimento</span>

            <select id="travelCenter" required>
              <option value="">Selecionar centro</option>
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
            Escolha o tipo correspondente ao seu processo
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
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 4.5 6v5.5c0 4.6 3.1 7.7 7.5 9.5 4.4-1.8 7.5-4.9 7.5-9.5V6L12 3Z"></path>
                <path d="m8.5 12 2.2 2.2 4.8-5"></path>
              </svg>
            </span>

            <span class="visa-option-content">
              <strong>Schengen</strong>
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
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 20h14"></path>
                <path d="M7 20V9l5-5 5 5v11"></path>
                <path d="M9.5 12h5"></path>
                <path d="M9.5 15h5"></path>
              </svg>
            </span>

            <span class="visa-option-content">
              <strong>Nacional</strong>
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
            <strong>Preferências de marcação</strong>
          </div>

          <small>
            Critérios usados no acompanhamento da vaga
          </small>
        </div>

        <div class="travel-fields-grid">

          <label class="travel-field">
            <span>Data prevista da viagem</span>

            <input
              id="travelDate"
              type="date"
            >
          </label>

          <label class="travel-field">
            <span>Data limite para conseguir a vaga</span>

            <input
              id="travelAppointmentDeadline"
              type="date"
            >
          </label>

          <label class="travel-field">
            <span>Horário preferido</span>

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
            <span>Flexibilidade</span>

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
              <small>Rota configurada</small>
              <strong>Angola → Portugal</strong>
            </div>
          </div>

          <div
            id="travelPreferenceSummary"
            class="summary-visa"
          >
            <small>Tipo de visto</small>
            <strong>Selecione uma opção</strong>
          </div>

        </div>

      </form>
    `;

    bindTravelForm(section);

    return section;
  }

  function bindTravelForm(section) {
    const form = section.querySelector(
      "#travelPreferencesForm"
    );

    if (!form) {
      return;
    }

    section
      .querySelectorAll(".visa-option")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const value = button.dataset.visa || "";

          const input = $("travelVisaType");

          if (input) {
            input.value = value;
          }

          updateVisaCards();
          savePreferences();
          updateStatus();
        });
      });

    form.addEventListener("input", () => {
      savePreferences();
      updateStatus();
    });

    form.addEventListener("change", () => {
      savePreferences();
      updateStatus();
    });

    restorePreferences();
  }

  function updateVisaCards() {
    const value = $("travelVisaType")?.value || "";

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

    const summary =
      $("travelPreferenceSummary");

    if (!summary) {
      return;
    }

    const title = summary.querySelector("strong");

    if (!title) {
      return;
    }

    if (value === "schengen") {
      title.textContent = "Visto Schengen";
    } else if (value === "national") {
      title.textContent = "Visto Nacional";
    } else {
      title.textContent =
        "Selecione uma opção";
    }
  }

  function isClientReady() {
    const name =
      $("clientFullName")?.value?.trim();

    const email =
      $("clientEmail")?.value?.trim();

    return Boolean(name && email);
  }

  function isTravelReady() {
    const visa =
      $("travelVisaType")?.value;

    const center =
      $("travelCenter")?.value;

    return Boolean(visa && center);
  }

  function isPassportReady() {
    const success =
      $("passportResultState")
        ?.classList.contains("success");

    const ready =
      $("passportCheckReady");

    return Boolean(
      success ||
      ready?.dataset.ready === "true" ||
      ready?.textContent
        ?.toLowerCase()
        .includes("confirmado")
    );
  }

  function isIdentityReady() {
    try {
      if (
        window.TravelFacialPreflight &&
        typeof window.TravelFacialPreflight.isReady ===
          "function"
      ) {
        return Boolean(
          window.TravelFacialPreflight.isReady()
        );
      }
    } catch {
      /* mantém fallback */
    }

    const result =
      $("facialPreflightResult");

    return Boolean(
      result?.dataset.status === "passed" ||
      result?.dataset.ready === "true" ||
      result?.classList.contains("success")
    );
  }

  function isApplicationReady() {
    const list =
      $("applicationsList");

    if (!list) {
      return false;
    }

    return Boolean(
      list.querySelector(
        ".application-card"
      )
    );
  }

  function isCurrentReady() {
    const id = currentStep().id;

    switch (id) {
      case "client":
        return isClientReady();

      case "travel":
        return isTravelReady();

      case "passport":
        return isPassportReady();

      case "identity":
        return isIdentityReady();

      case "application":
        return isApplicationReady();

      case "operations":
        return true;

      default:
        return false;
    }
  }

  function getWaitingTitle(id) {
    const messages = {
      client: "Complete o seu perfil",
      travel: "Defina a sua viagem",
      passport: "Confirme os documentos",
      identity: "Conclua a verificação facial",
      application: "Prepare a candidatura",
      operations: "Acompanhamento disponível"
    };

    return messages[id] || "Complete esta etapa";
  }

  function getWaitingDescription(id) {
    const messages = {
      client:
        "Preencha os dados obrigatórios do viajante.",
      travel:
        "Escolha o centro e o tipo de visto para definir o critério correto de procura.",
      passport:
        "É necessário confirmar o documento antes de continuar.",
      identity:
        "A confirmação facial ainda não foi concluída.",
      application:
        "A candidatura precisa de estar preparada antes de avançar.",
      operations:
        "O processo está pronto para acompanhamento."
    };

    return messages[id] || "";
  }

  function getReadyDescription(id) {
    const messages = {
      client:
        "O perfil do viajante está preenchido.",
      travel:
        "O perfil de procura da vaga está configurado.",
      passport:
        "O documento de viagem foi confirmado.",
      identity:
        "A identidade foi confirmada.",
      application:
        "A candidatura está preparada.",
      operations:
        "O processo pode ser acompanhado."
    };

    return messages[id] || "";
  }

  function iconMarkup(type) {
    const icons = {
      person: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5"></circle>
          <path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6"></path>
        </svg>
      `,

      route: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="18" r="2"></circle>
          <circle cx="18" cy="6" r="2"></circle>
          <path d="M7.5 16.5 16.5 7.5"></path>
          <path d="m12 7 4.5-1.5L15 10"></path>
        </svg>
      `,

      document: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h7l4 4v14H7z"></path>
          <path d="M14 3v5h4"></path>
          <path d="M10 13h5"></path>
          <path d="M10 17h5"></path>
        </svg>
      `,

      face: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4H5a1 1 0 0 0-1 1v3"></path>
          <path d="M16 4h3a1 1 0 0 1 1 1v3"></path>
          <path d="M8 20H5a1 1 0 0 1-1-1v-3"></path>
          <path d="M16 20h3a1 1 0 0 0 1-1v-3"></path>
          <circle cx="9" cy="11" r=".8"></circle>
          <circle cx="15" cy="11" r=".8"></circle>
          <path d="M9 15c1.7 1 4.3 1 6 0"></path>
        </svg>
      `,

      application: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4h12v16H6z"></path>
          <path d="m9 9 1.5 1.5L14 7"></path>
          <path d="M9 14h6"></path>
        </svg>
      `,

      radar: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 12 19 5"></path>
          <path d="M12 4a8 8 0 1 0 8 8"></path>
          <path d="M12 8a4 4 0 1 0 4 4"></path>
          <circle cx="12" cy="12" r="1.5"></circle>
        </svg>
      `
    };

    return (
      icons[type] ||
      icons.person
    );
  }

  function createWorkflow() {
    if ($("travelWorkflow")) {
      return $("travelWorkflow");
    }

    const workflow =
      document.createElement("section");

    workflow.id = "travelWorkflow";
    workflow.className =
      "travel-workflow";

    workflow.setAttribute(
      "aria-label",
      "Preparação da viagem"
    );

    workflow.innerHTML = `
      <div class="workflow-shell">

        <aside class="workflow-sidebar">

          <div class="workflow-brand">
            <div class="workflow-logo">
              TA
            </div>

            <div>
              <strong>TRAVEL AUTOMATION</strong>
              <span>Angola → Portugal</span>
            </div>
          </div>

          <div class="workflow-progress-heading">
            <div>
              <span>Preparação da viagem</span>
              <strong id="workflowProgressText">
                01 de 06
              </strong>
            </div>

            <div class="progress-percent">
              <span id="workflowProgressPercent">
                17%
              </span>
            </div>
          </div>

          <nav
            id="workflowProgress"
            class="workflow-progress"
            aria-label="Etapas da viagem"
          ></nav>

          <div class="workflow-sidebar-route">
            <div class="route-route-line">
              <span></span>
              <i></i>
              <span></span>
            </div>

            <div>
              <strong>AO</strong>
              <small>Luanda</small>
            </div>

            <div class="route-aircraft">
              ${iconMarkup("route")}
            </div>

            <div>
              <strong>PT</strong>
              <small>Portugal</small>
            </div>
          </div>

        </aside>

        <div class="workflow-main">

          <div class="workflow-topbar">

            <div class="workflow-location">
              <span class="topbar-dot"></span>
              <span>Processo de viagem</span>
            </div>

            <div class="workflow-security">
              <span class="security-dot"></span>
              Dados protegidos
            </div>

          </div>

          <header class="workflow-heading">

            <div
              id="workflowStageIcon"
              class="workflow-stage-icon"
            >
              ${iconMarkup("person")}
            </div>

            <div class="workflow-heading-copy">

              <span
                id="workflowEyebrow"
                class="workflow-eyebrow"
              >
                PRIMEIRA ETAPA
              </span>

              <h1 id="workflowTitle">
                Perfil
              </h1>

              <p id="workflowDescription">
                Começamos pelos dados do viajante.
              </p>

            </div>

            <div class="workflow-counter">
              <small>ETAPA</small>
              <strong id="workflowCounter">01</strong>
              <span>/ 06</span>
            </div>

          </header>

          <div class="workflow-flight-path">

            <div class="flight-line">
              <span
                id="workflowFlightProgress"
                class="flight-progress"
              ></span>
            </div>

            <span
              id="workflowPlane"
              class="workflow-plane"
            >
              ${iconMarkup("route")}
            </span>

            <div class="flight-labels">
              <span>Perfil</span>
              <span>Viagem</span>
              <span>Documentos</span>
              <span>Identidade</span>
              <span>Candidatura</span>
              <span>Acompanhamento</span>
            </div>

          </div>

          <div
            id="workflowStage"
            class="workflow-stage"
          ></div>

          <section class="workflow-status-card">

            <div class="status-card-mark">
              <span></span>
            </div>

            <div class="status-card-copy">
              <span>ESTADO ATUAL</span>

              <strong id="workflowStatusTitle">
                Complete o seu perfil
              </strong>

              <p id="workflowStatusText">
                Preencha os dados obrigatórios do viajante.
              </p>
            </div>

          </section>

          <div class="workflow-navigation">

            <button
              id="workflowBack"
              type="button"
              class="workflow-nav secondary"
            >
              <span>←</span>
              Voltar
            </button>

            <span
              id="workflowBottomHint"
              class="workflow-navigation-hint"
            >
              Complete esta etapa para continuar.
            </span>

            <button
              id="workflowNext"
              type="button"
              class="workflow-nav primary"
            >
              Continuar
              <span>→</span>
            </button>

          </div>

        </div>
      </div>
    `;

    return workflow;
  }

  function buildProgress() {
    const container =
      $("workflowProgress");

    if (!container) {
      return;
    }

    container.innerHTML = "";

    STEPS.forEach((step, index) => {
      const button =
        document.createElement("button");

      button.type = "button";
      button.className =
        "workflow-progress-item";

      button.dataset.index =
        String(index);

      button.innerHTML = `
        <span class="progress-node">
          <span class="progress-number">
            ${step.number}
          </span>

          <span class="progress-icon">
            ${iconMarkup(step.icon)}
          </span>
        </span>

        <span class="progress-copy">
          <strong>${step.title}</strong>
          <small>
            ${getProgressDescription(step.id)}
          </small>
        </span>

        <span class="progress-state"></span>
      `;

      button.addEventListener(
        "click",
        () => {
          if (
            index <= state.currentIndex
          ) {
            goTo(index);
          }
        }
      );

      container.appendChild(button);
    });
  }

  function getProgressDescription(id) {
    const values = {
      client: "Dados pessoais",
      travel: "Portugal e visto",
      passport: "Passaporte",
      identity: "Verificação facial",
      application: "Revisão do processo",
      operations: "Procura de vaga"
    };

    return values[id] || "";
  }

  function updateProgress() {
    document
      .querySelectorAll(
        ".workflow-progress-item"
      )
      .forEach((item, index) => {
        const step =
          STEPS[index];

        const completed =
          state.completed.has(step.id);

        const active =
          index === state.currentIndex;

        const locked =
          index > state.currentIndex &&
          !state.completed.has(
            STEPS[index - 1]?.id
          );

        item.classList.toggle(
          "active",
          active
        );

        item.classList.toggle(
          "completed",
          completed
        );

        item.classList.toggle(
          "locked",
          locked
        );

        item.disabled = locked;

        const stateElement =
          item.querySelector(
            ".progress-state"
          );

        if (stateElement) {
          stateElement.textContent =
            completed
              ? "Concluído"
              : active
                ? "Agora"
                : "Bloqueado";
        }
      });

    const number =
      state.currentIndex + 1;

    const progressText =
      $("workflowProgressText");

    if (progressText) {
      progressText.textContent =
        `${String(number).padStart(2, "0")} de 06`;
    }

    const percent =
      Math.round(
        (number / STEPS.length) * 100
      );

    const percentElement =
      $("workflowProgressPercent");

    if (percentElement) {
      percentElement.textContent =
        `${percent}%`;
    }
  }

  function updateHeader() {
    const step =
      currentStep();

    const icon =
      $("workflowStageIcon");

    if (icon) {
      icon.innerHTML =
        iconMarkup(step.icon);

      icon.dataset.stage =
        step.id;
    }

    const eyebrow =
      $("workflowEyebrow");

    if (eyebrow) {
      eyebrow.textContent =
        step.eyebrow;
    }

    const title =
      $("workflowTitle");

    if (title) {
      title.textContent =
        step.title;
    }

    const description =
      $("workflowDescription");

    if (description) {
      description.textContent =
        step.description;
    }

    const counter =
      $("workflowCounter");

    if (counter) {
      counter.textContent =
        step.number;
    }
  }

  function updateRoute() {
    const progress =
      $("workflowFlightProgress");

    const plane =
      $("workflowPlane");

    if (!progress || !plane) {
      return;
    }

    const percentage =
      state.currentIndex === 0
        ? 0
        : (
            state.currentIndex /
            (STEPS.length - 1)
          ) * 100;

    progress.style.width =
      `${Math.max(
        4,
        percentage
      )}%`;

    plane.style.left =
      `${Math.min(
        97,
        Math.max(
          2,
          percentage
        )
      )}%`;
  }

  function updateStatus() {
    const step =
      currentStep();

    const ready =
      isCurrentReady();

    const title =
      $("workflowStatusTitle");

    const text =
      $("workflowStatusText");

    const hint =
      $("workflowBottomHint");

    const next =
      $("workflowNext");

    if (title) {
      title.textContent =
        ready
          ? getReadyTitle(step.id)
          : getWaitingTitle(step.id);
    }

    if (text) {
      text.textContent =
        ready
          ? getReadyDescription(step.id)
          : getWaitingDescription(step.id);
    }

    if (hint) {
      hint.textContent =
        ready
          ? "Tudo pronto para continuar."
          : getWaitingDescription(step.id);
    }

    if (next) {
      next.disabled =
        !ready;

      next.classList.toggle(
        "ready",
        ready
      );

      next.innerHTML =
        state.currentIndex ===
        STEPS.length - 1
          ? `
            Abrir acompanhamento
            <span>→</span>
          `
          : `
            Continuar
            <span>→</span>
          `;
    }
  }

  function getReadyTitle(id) {
    const values = {
      client: "Perfil preparado",
      travel: "Viagem configurada",
      passport: "Documento confirmado",
      identity: "Identidade confirmada",
      application: "Candidatura preparada",
      operations: "Acompanhamento disponível"
    };

    return values[id] || "Etapa concluída";
  }

  function moveSectionToStage(sectionId) {
    const stage =
      $("workflowStage");

    if (!stage) {
      return;
    }

    stage.innerHTML = "";

    if (!sectionId) {
      return;
    }

    const section =
      $(sectionId);

    if (!section) {
      return;
    }

    stage.appendChild(section);
  }

  function showTravelStage() {
    const stage =
      $("workflowStage");

    if (!stage) {
      return;
    }

    const section =
      createTravelSection();

    stage.innerHTML = "";
    stage.appendChild(section);

    restorePreferences();
    updateVisaCards();
  }

  function focusPassport() {
    const section =
      $("clientSection");

    if (!section) {
      return;
    }

    const candidates = [
      "#passportNumber",
      "#clientPassportNumber",
      "#passportFile",
      "#passportUpload",
      "#passportCheckReady"
    ];

    for (const selector of candidates) {
      const element =
        section.querySelector(selector);

      if (element) {
        setTimeout(() => {
          element.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }, 80);

        break;
      }
    }
  }

  function focusIdentity() {
    const section =
      $("applicationSection");

    if (!section) {
      return;
    }

    const target =
      section.querySelector(
        "#identityClient, #facialPreflightResult, .facial-card"
      );

    if (target) {
      setTimeout(() => {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }, 80);
    }
  }

  function focusApplication() {
    const section =
      $("applicationSection");

    if (!section) {
      return;
    }

    setTimeout(() => {
      section.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
  }

  function focusOperations() {
    const section =
      $("verificationSection");

    if (!section) {
      return;
    }

    setTimeout(() => {
      section.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 80);
  }

  function prepareStage() {
    const step =
      currentStep();

    if (step.id === "travel") {
      showTravelStage();
      return;
    }

    moveSectionToStage(
      step.section
    );

    if (step.id === "passport") {
      focusPassport();
    }

    if (step.id === "identity") {
      focusIdentity();
    }

    if (step.id === "application") {
      focusApplication();
    }

    if (step.id === "operations") {
      focusOperations();
    }
  }

  function markComplete(id) {
    if (
      STEPS.some(
        step => step.id === id
      )
    ) {
      state.completed.add(id);
      updateAll();
    }
  }

  function canEnter(index) {
    if (index <= state.currentIndex) {
      return true;
    }

    for (
      let i = 0;
      i < index;
      i += 1
    ) {
      if (
        !state.completed.has(
          STEPS[i].id
        ) &&
        i !== state.currentIndex
      ) {
        return false;
      }
    }

    return isCurrentReady();
  }

  function completeCurrent() {
    if (!isCurrentReady()) {
      updateStatus();
      return false;
    }

    state.completed.add(
      currentStep().id
    );

    return true;
  }

  function next() {
    if (state.transitioning) {
      return;
    }

    if (!completeCurrent()) {
      return;
    }

    if (
      state.currentIndex >=
      STEPS.length - 1
    ) {
      updateAll();
      return;
    }

    goTo(
      state.currentIndex + 1
    );
  }

  function back() {
    if (
      state.transitioning ||
      state.currentIndex === 0
    ) {
      return;
    }

    goTo(
      state.currentIndex - 1,
      true
    );
  }

  function goTo(index, backward = false) {
    if (
      state.transitioning ||
      index < 0 ||
      index >= STEPS.length
    ) {
      return;
    }

    if (
      index > state.currentIndex &&
      !canEnter(index)
    ) {
      updateStatus();
      return;
    }

    state.transitioning = true;

    const stage =
      $("workflowStage");

    if (stage) {
      stage.classList.add(
        backward
          ? "leaving-back"
          : "leaving"
      );
    }

    setTimeout(() => {
      state.currentIndex =
        index;

      prepareStage();
      updateAll();

      if (stage) {
        stage.classList.remove(
          "leaving",
          "leaving-back"
        );

        stage.classList.add(
          "entering"
        );

        requestAnimationFrame(() => {
          stage.classList.remove(
            "entering"
          );
        });
      }

      state.transitioning = false;

      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    }, 180);
  }

  function updateAll() {
    updateProgress();
    updateHeader();
    updateRoute();
    updateStatus();

    document.body.dataset.travelStage =
      currentStep().id;
  }

  function hideLegacyPipeline() {
    const pipeline =
      document.querySelector(
        ".system-pipeline"
      );

    if (pipeline) {
      pipeline.classList.add(
        "workflow-legacy-hidden"
      );
    }
  }

  function styleStatsArea() {
    const stats =
      document.querySelector(
        ".stats-grid"
      );

    if (!stats) {
      return;
    }

    stats.classList.add(
      "travel-statistics"
    );
  }

  function observeReadiness() {
    const observer =
      new MutationObserver(() => {
        updateStatus();
      });

    observer.observe(
      document.body,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "class",
          "data-ready",
          "data-status"
        ]
      }
    );
  }

  function init() {
    if (
      state.initialized
    ) {
      return;
    }

    const app =
      $("appView");

    if (!app) {
      return;
    }

    const workflow =
      createWorkflow();

    const main =
      document.querySelector(
        ".main-container"
      );

    if (!main) {
      return;
    }

    main.prepend(workflow);

    buildProgress();
    hideLegacyPipeline();
    styleStatsArea();

    const nextButton =
      $("workflowNext");

    const backButton =
      $("workflowBack");

    nextButton?.addEventListener(
      "click",
      next
    );

    backButton?.addEventListener(
      "click",
      back
    );

    const clientForm =
      $("clientForm");

    clientForm?.addEventListener(
      "input",
      () => {
        if (
          currentStep().id ===
          "client"
        ) {
          updateStatus();
        }
      }
    );

    state.initialized = true;

    prepareStage();
    updateAll();

    observeReadiness();

    document.addEventListener(
      "travel:preferencesChanged",
      () => {
        updateStatus();
      }
    );
  }

  window.TravelWorkflow = {
    init,
    next,
    back,
    goTo,
    markComplete,

    getState() {
      return {
        current:
          currentStep().id,

        currentIndex:
          state.currentIndex,

        completed:
          Array.from(
            state.completed
          ),

        preferences:
          getPreferences()
      };
    }
  };

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
})();
