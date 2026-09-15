(() => {
  "use strict";

  /*
   * ============================================================
   * TRAVEL AUTOMATION
   * TRAVEL WORKFLOW CONTROLLER — PREMIUM JOURNEY
   * ============================================================
   *
   * Este ficheiro controla somente a experiência visual do fluxo.
   *
   * ETAPAS:
   * 01 — Viajante
   * 02 — Passaporte
   * 03 — Identidade
   * 04 — Aplicação
   * 05 — Operações
   *
   * IMPORTANTE:
   * - Não cria endpoints.
   * - Não altera APIs.
   * - Não altera IDs existentes.
   * - Reutiliza as secções existentes.
   * - Impede avanço prematuro.
   * - Mantém compatibilidade com os módulos existentes.
   * ============================================================
   */

  const $ = (id) => document.getElementById(id);

  const STEPS = [
    {
      id: "client",
      number: "01",
      eyebrow: "TRAVELER",
      short: "Viajante",
      title: "Preparar viajante",
      description:
        "Comece pelo perfil do viajante. Todos os dados serão usados nas etapas seguintes.",
      icon: "user"
    },
    {
      id: "passport",
      number: "02",
      eyebrow: "PASSPORT",
      short: "Passaporte",
      title: "Validar passaporte",
      description:
        "Valide os dados do passaporte antes de avançar para a confirmação de identidade.",
      icon: "passport"
    },
    {
      id: "identity",
      number: "03",
      eyebrow: "IDENTITY",
      short: "Identidade",
      title: "Confirmar identidade",
      description:
        "Faça a verificação facial seguindo as instruções apresentadas no centro de validação.",
      icon: "face"
    },
    {
      id: "application",
      number: "04",
      eyebrow: "APPLICATION",
      short: "Aplicação",
      title: "Preparar aplicação",
      description:
        "Depois da aprovação da identidade, prepare a aplicação para entrar em operação.",
      icon: "document"
    },
    {
      id: "operations",
      number: "05",
      eyebrow: "OPERATIONS",
      short: "Operações",
      title: "Centro de operações",
      description:
        "Acompanhe VFS, OTP, radar de disponibilidade e os próximos eventos da operação.",
      icon: "radar"
    }
  ];

  const state = {
    current: 0,
    completed: new Set(),
    initialized: false,
    transitioning: false
  };

  let shell = null;
  let stageContainer = null;
  let progressContainer = null;
  let bottomBar = null;
  let observersStarted = false;

  const sectionMap = {
    client: "clientSection",
    passport: "passportSection",
    identity: "identitySection",
    application: "applicationSection",
    operations: "verificationSection"
  };

  function reducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name) {
    const icons = {
      user: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5"></circle>
          <path d="M5 20c.8-3.5 3.1-5.3 7-5.3s6.2 1.8 7 5.3"></path>
        </svg>
      `,

      passport: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="3.5" width="14" height="17" rx="2"></rect>
          <circle cx="12" cy="9" r="2.6"></circle>
          <path d="M8.5 15.2h7"></path>
          <path d="M8.5 17.5h5"></path>
        </svg>
      `,

      face: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="4"></rect>
          <circle cx="9" cy="10" r="1"></circle>
          <circle cx="15" cy="10" r="1"></circle>
          <path d="M8.5 14c1.8 1.6 5.2 1.6 7 0"></path>
        </svg>
      `,

      document: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3.5h7l4 4V20.5H7z"></path>
          <path d="M14 3.5v4h4"></path>
          <path d="M9.5 12h5"></path>
          <path d="M9.5 15.5h5"></path>
        </svg>
      `,

      radar: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 14a7.5 7.5 0 0 1 15 0"></path>
          <path d="M7.5 14a4.5 4.5 0 0 1 9 0"></path>
          <path d="M12 14l5.5-6"></path>
          <circle cx="12" cy="14" r="1.5"></circle>
          <path d="M3 18.5h18"></path>
        </svg>
      `,

      check: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.2 4.2L19 7"></path>
        </svg>
      `,

      lock: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2"></rect>
          <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
        </svg>
      `,

      arrow: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h13"></path>
          <path d="M13 6l6 6-6 6"></path>
        </svg>
      `,

      plane: `
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M29 14.1 18.4 11V4.8c0-1.2-.9-2.1-2.1-2.1s-2.1.9-2.1 2.1V11L3.6 14.1c-.9.3-1.5 1.1-1.5 2 0 .8.6 1.5 1.4 1.7l10.7 1.9v5.4l-3.3 2.2c-.6.4-.9 1.1-.9 1.8h12c0-.7-.3-1.4-.9-1.8l-3.3-2.2v-5.4l10.7-1.9c.8-.2 1.4-.9 1.4-1.7 0-.9-.6-1.7-1.5-2Z"></path>
        </svg>
      `
    };

    return icons[name] || "";
  }

  function getExistingSection(id) {
    return $(sectionMap[id]);
  }

  function createShell() {
    const appView = $("appView");

    if (!appView) {
      return false;
    }

    shell = $("travelWorkflow");

    if (shell) {
      stageContainer = $("workflowStage");
      progressContainer = $("workflowProgress");
      bottomBar = $("workflowBottom");
      return true;
    }

    shell = document.createElement("div");
    shell.id = "travelWorkflow";
    shell.className = "travel-workflow";

    shell.innerHTML = `
      <div class="workflow-sky-layer" aria-hidden="true">
        <div class="workflow-cloud cloud-one"></div>
        <div class="workflow-cloud cloud-two"></div>
        <div class="workflow-glow glow-one"></div>
        <div class="workflow-glow glow-two"></div>

        <div class="workflow-aircraft">
          ${icon("plane")}
        </div>

        <div class="workflow-grid"></div>
      </div>

      <aside class="workflow-sidebar">

        <div class="workflow-brand">
          <div class="workflow-brand-mark">
            TA
          </div>

          <div class="workflow-brand-text">
            <strong>TRAVEL AUTOMATION</strong>
            <span>OPERATIONS CENTER</span>
          </div>
        </div>

        <div class="workflow-route-heading">
          <span>YOUR JOURNEY</span>
          <strong>Preparação de viagem</strong>
        </div>

        <nav
          id="workflowProgress"
          class="workflow-progress"
          aria-label="Progresso da operação"
        ></nav>

        <div class="workflow-sidebar-footer">

          <div class="workflow-secure-status">
            <span class="workflow-secure-pulse"></span>
            <strong>SISTEMA ONLINE</strong>
          </div>

          <small>
            Ambiente seguro de preparação e monitorização
          </small>

        </div>

      </aside>

      <section class="workflow-content">

        <header class="workflow-header">

          <div class="workflow-header-copy">

            <div class="workflow-kicker">
              <span class="workflow-kicker-line"></span>
              <span id="workflowEyebrow">TRAVELER</span>
            </div>

            <h1 id="workflowTitle">
              Preparar viajante
            </h1>

            <p id="workflowDescription">
              Comece pelo perfil do viajante.
            </p>

          </div>

          <div class="workflow-live-status">
            <span class="workflow-live-indicator"></span>

            <div>
              <strong>LIVE</strong>
              <small>OPERATIONS</small>
            </div>
          </div>

        </header>

        <div class="workflow-flight-progress">

          <div class="workflow-flight-label">
            <span>ROTA DE PREPARAÇÃO</span>
            <strong id="workflowFlightPercent">20%</strong>
          </div>

          <div class="workflow-flight-track">

            <div
              id="workflowFlightProgress"
              class="workflow-flight-fill"
            ></div>

            <div
              id="workflowPlane"
              class="workflow-plane"
              aria-hidden="true"
            >
              ${icon("plane")}
            </div>

            <div class="workflow-flight-points">
              ${STEPS.map(
                (step, index) => `
                  <span
                    class="workflow-flight-point"
                    data-flight-point="${index}"
                  ></span>
                `
              ).join("")}
            </div>

          </div>

        </div>

        <main
          id="workflowStage"
          class="workflow-stage"
        ></main>

        <footer
          id="workflowBottom"
          class="workflow-bottom"
        ></footer>

      </section>
    `;

    const mainContainer = appView.querySelector(".main-container");

    if (mainContainer) {
      mainContainer.classList.add("workflow-managed");
      mainContainer.prepend(shell);
    } else {
      appView.appendChild(shell);
    }

    stageContainer = $("workflowStage");
    progressContainer = $("workflowProgress");
    bottomBar = $("workflowBottom");

    return true;
  }

  function renderProgress() {
    if (!progressContainer) {
      return;
    }

    progressContainer.innerHTML = STEPS.map((step, index) => {
      const active = index === state.current;
      const completed = state.completed.has(step.id);
      const locked = index > state.current && !completed;

      return `
        <button
          type="button"
          class="workflow-step
            ${active ? "is-active" : ""}
            ${completed ? "is-complete" : ""}
            ${locked ? "is-locked" : ""}
          "
          data-workflow-step="${escapeHtml(step.id)}"
          ${locked ? "disabled" : ""}
          aria-current="${active ? "step" : "false"}"
        >

          <span class="workflow-step-icon">
            ${
              completed
                ? icon("check")
                : locked
                  ? icon("lock")
                  : icon(step.icon)
            }
          </span>

          <span class="workflow-step-copy">

            <span class="workflow-step-number">
              ${escapeHtml(step.number)}
            </span>

            <strong>
              ${escapeHtml(step.short)}
            </strong>

            <small>
              ${escapeHtml(step.title)}
            </small>

          </span>

          <span class="workflow-step-arrow">
            ${icon("arrow")}
          </span>

        </button>
      `;
    }).join("");

    progressContainer
      .querySelectorAll("[data-workflow-step]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const id = button.dataset.workflowStep;

          const index = STEPS.findIndex(
            (step) => step.id === id
          );

          if (index < 0) {
            return;
          }

          if (
            index <= state.current ||
            state.completed.has(id)
          ) {
            goTo(index);
          }
        });
      });
  }

  function getCurrentStep() {
    return STEPS[state.current];
  }

  function renderAssist(step) {
    const assist = document.createElement("div");

    assist.className = `workflow-assist workflow-assist-${step.id}`;

    const content = {
      client: {
        eyebrow: "ANTES DE COMEÇAR",
        title: "Vamos preparar o viajante",
        text:
          "Preencha os dados principais. Depois de guardar o perfil, poderá avançar para a validação do passaporte.",
        items: [
          "Dados pessoais",
          "Contacto",
          "Informação da viagem"
        ]
      },

      passport: {
        eyebrow: "VALIDAÇÃO DOCUMENTAL",
        title: "Primeiro o documento. Depois a identidade.",
        text:
          "O passaporte precisa de ser validado antes da etapa facial ficar disponível.",
        items: [
          "OCR e MRZ",
          "Dados do documento",
          "Validade e correspondência"
        ]
      },

      identity: {
        eyebrow: "VERIFICAÇÃO FACIAL",
        title: "Confirme que é realmente o viajante",
        text:
          "Siga as instruções do centro facial. Faça os movimentos pedidos e aguarde o resultado.",
        items: [
          "Posicione o rosto",
          "Siga os movimentos",
          "Aguarde a decisão"
        ]
      },

      application: {
        eyebrow: "PREPARAÇÃO",
        title: "A aplicação está quase pronta",
        text:
          "Depois da aprovação da identidade, organize a aplicação antes de entrar no centro de operações.",
        items: [
          "Dados da aplicação",
          "Documentação",
          "Estado de preparação"
        ]
      },

      operations: {
        eyebrow: "CENTRO DE OPERAÇÕES",
        title: "Agora acompanhe a operação",
        text:
          "A partir daqui o processo passa para monitorização, radar e operações.",
        items: [
          "VFS",
          "OTP",
          "Radar de disponibilidade"
        ]
      }
    };

    const data = content[step.id];

    assist.innerHTML = `
      <div class="workflow-assist-visual">

        <div class="workflow-assist-icon">
          ${icon(step.icon)}
        </div>

        ${
          step.id === "identity"
            ? `
              <div class="workflow-face-scan">
                <span></span>
                <i></i>
              </div>
            `
            : ""
        }

        ${
          step.id === "operations"
            ? `
              <div class="workflow-radar-animation">
                <span></span>
                <i></i>
                <b></b>
              </div>
            `
            : ""
        }

      </div>

      <div class="workflow-assist-copy">

        <span class="workflow-assist-eyebrow">
          ${escapeHtml(data.eyebrow)}
        </span>

        <strong>
          ${escapeHtml(data.title)}
        </strong>

        <p>
          ${escapeHtml(data.text)}
        </p>

        <div class="workflow-assist-items">
          ${data.items
            .map(
              (item, index) => `
                <span>
                  <b>${index + 1}</b>
                  ${escapeHtml(item)}
                </span>
              `
            )
            .join("")}
        </div>

      </div>
    `;

    return assist;
  }

  function renderFeedback(step) {
    const feedback = document.createElement("div");

    feedback.id = "workflowFeedback";
    feedback.className = "workflow-feedback";

    const status = getStepStatus(step.id);

    if (status === "success") {
      feedback.classList.add("is-success");

      feedback.innerHTML = `
        <div class="workflow-feedback-icon">
          ${icon("check")}
        </div>

        <div>
          <strong>Etapa aprovada</strong>
          <p>
            Esta etapa foi concluída. Pode continuar para a próxima.
          </p>
        </div>
      `;

      return feedback;
    }

    if (status === "error") {
      feedback.classList.add("is-error");

      feedback.innerHTML = `
        <div class="workflow-feedback-icon">
          !
        </div>

        <div>
          <strong>Validação não aprovada</strong>
          <p>
            Corrija os dados ou siga as instruções apresentadas no módulo
            desta etapa antes de tentar novamente.
          </p>
        </div>
      `;

      return feedback;
    }

    feedback.classList.add("is-neutral");

    feedback.innerHTML = `
      <div class="workflow-feedback-icon">
        i
      </div>

      <div>
        <strong>Próximo passo bloqueado</strong>
        <p>
          Conclua esta etapa primeiro. O sistema liberará automaticamente
          a próxima fase quando os requisitos forem cumpridos.
        </p>
      </div>
    `;

    return feedback;
  }

  function getStepStatus(id) {
    if (id === "passport") {
      const result = $("passportResultState");

      if (
        result &&
        (
          result.classList.contains("error") ||
          result.classList.contains("failed") ||
          result.classList.contains("rejected") ||
          /reprov|rejeit|inválid|invalido|falhou/i.test(
            result.textContent || ""
          )
        )
      ) {
        return "error";
      }

      if (isPassportReady()) {
        return "success";
      }
    }

    if (id === "identity") {
      const result =
        $("facialPreflightResult") ||
        $("passportResultState");

      if (
        result &&
        /reprov|rejeit|falhou|não aprovado|nao aprovado/i.test(
          result.textContent || ""
        )
      ) {
        return "error";
      }

      if (isIdentityReady()) {
        return "success";
      }
    }

    if (state.completed.has(id)) {
      return "success";
    }

    return "neutral";
  }

  function renderStage() {
    if (!stageContainer) {
      return;
    }

    const step = getCurrentStep();
    const section = getExistingSection(step.id);

    stageContainer.innerHTML = "";

    const frame = document.createElement("div");

    frame.className = "workflow-stage-frame";
    frame.dataset.stage = step.id;

    const stageTop = document.createElement("div");

    stageTop.className = "workflow-stage-top";

    stageTop.innerHTML = `
      <div class="workflow-stage-badge">
        <span>${escapeHtml(step.number)}</span>
        ${icon(step.icon)}
      </div>

      <div>
        <span class="workflow-stage-eyebrow">
          ${escapeHtml(step.eyebrow)}
        </span>

        <strong>
          ${escapeHtml(step.title)}
        </strong>
      </div>

      <div class="workflow-stage-secure">
        <span></span>
        Seguro
      </div>
    `;

    frame.appendChild(stageTop);
    frame.appendChild(renderAssist(step));

    if (section) {
      section.classList.add("workflow-section-host");
      section.classList.remove("is-hidden");

      frame.appendChild(section);
    } else {
      const missing = document.createElement("div");

      missing.className = "workflow-missing";

      missing.innerHTML = `
        <div class="workflow-missing-icon">!</div>

        <strong>
          Etapa indisponível
        </strong>

        <p>
          A interface desta etapa ainda não está disponível.
        </p>
      `;

      frame.appendChild(missing);
    }

    if (
      step.id === "passport" ||
      step.id === "identity"
    ) {
      frame.appendChild(renderFeedback(step));
    }

    stageContainer.appendChild(frame);

    if (reducedMotion()) {
      frame.classList.add("is-visible");
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          frame.classList.add("is-visible");
        });
      });
    }
  }

  function renderBottom() {
    if (!bottomBar) {
      return;
    }

    const step = getCurrentStep();
    const isLast = state.current === STEPS.length - 1;
    const completed = state.completed.has(step.id);

    bottomBar.innerHTML = `
      <div class="workflow-bottom-left">

        <div class="workflow-bottom-status">
          <span></span>

          <div>
            <strong>
              ETAPA ${escapeHtml(step.number)} DE ${STEPS.length}
            </strong>

            <small>
              ${
                completed
                  ? "Requisitos cumpridos"
                  : "Aguardando conclusão"
              }
            </small>
          </div>
        </div>

        <div class="workflow-bottom-hint">
          ${
            isLast
              ? "O centro de operações está ativo."
              : completed
                ? "Pode avançar para a próxima etapa."
                : "Conclua a etapa atual para continuar."
          }
        </div>

      </div>

      <div class="workflow-bottom-actions">

        ${
          state.current > 0
            ? `
              <button
                id="workflowBack"
                type="button"
                class="workflow-button workflow-button-secondary"
              >
                <span>←</span>
                Voltar
              </button>
            `
            : ""
        }

        ${
          !isLast
            ? `
              <button
                id="workflowNext"
                type="button"
                class="workflow-button workflow-button-primary"
              >
                ${
                  completed
                    ? "Continuar"
                    : "Verificar etapa"
                }
                ${icon("arrow")}
              </button>
            `
            : `
              <button
                id="workflowOperationsRefresh"
                type="button"
                class="workflow-button workflow-button-primary"
              >
                Atualizar operação
                <span class="refresh-symbol">↻</span>
              </button>
            `
        }

      </div>
    `;

    const back = $("workflowBack");

    if (back) {
      back.addEventListener("click", () => {
        goTo(state.current - 1);
      });
    }

    const next = $("workflowNext");

    if (next) {
      next.addEventListener("click", handleNext);
    }

    const refresh = $("workflowOperationsRefresh");

    if (refresh) {
      refresh.addEventListener("click", () => {
        refresh.classList.add("is-loading");
        refresh.disabled = true;

        const refreshButton = $("refreshButton");

        if (refreshButton) {
          refreshButton.click();
        }

        setTimeout(() => {
          refresh.classList.remove("is-loading");
          refresh.disabled = false;
        }, 1000);
      });
    }
  }

  function updateHeader() {
    const step = getCurrentStep();

    const eyebrow = $("workflowEyebrow");
    const title = $("workflowTitle");
    const description = $("workflowDescription");

    if (eyebrow) {
      eyebrow.textContent = step.eyebrow;
    }

    if (title) {
      title.textContent = step.title;
    }

    if (description) {
      description.textContent = step.description;
    }
  }

  function updateFlight() {
    const progress = $("workflowFlightProgress");
    const plane = $("workflowPlane");
    const percentElement = $("workflowFlightPercent");

    const percentage =
      STEPS.length <= 1
        ? 100
        : ((state.current + 1) / STEPS.length) * 100;

    if (progress) {
      progress.style.width = `${percentage}%`;
    }

    if (percentElement) {
      percentElement.textContent =
        `${Math.round(percentage)}%`;
    }

    if (plane) {
      const position =
        STEPS.length <= 1
          ? 100
          : (state.current / (STEPS.length - 1)) * 100;

      plane.style.left = `${position}%`;

      plane.classList.toggle(
        "is-flying",
        !reducedMotion()
      );
    }

    document
      .querySelectorAll("[data-flight-point]")
      .forEach((point) => {
        const index =
          Number(point.dataset.flightPoint);

        point.classList.toggle(
          "is-active",
          index <= state.current
        );
      });
  }

  function render() {
    if (!createShell()) {
      return;
    }

    renderProgress();
    updateHeader();
    updateFlight();
    renderStage();
    renderBottom();

    document.body.dataset.workflowStep =
      getCurrentStep().id;
  }

  function isClientReady() {
    const name = $("clientFullName");

    return Boolean(
      name &&
      typeof name.value === "string" &&
      name.value.trim().length >= 2
    );
  }

  function isPassportReady() {
    const result = $("passportResultState");

    if (result) {
      const text =
        result.textContent || "";

      if (
        result.classList.contains("success") ||
        result.classList.contains("approved") ||
        result.dataset.status === "success" ||
        /aprovado|validado|sucesso|success/i.test(text)
      ) {
        return true;
      }
    }

    const check = $("passportCheckReady");

    if (check) {
      return (
        check.dataset.ready === "true" ||
        check.value === "true" ||
        check.classList.contains("success") ||
        check.classList.contains("ready")
      );
    }

    return false;
  }

  function isIdentityReady() {
    if (
      window.TravelFacialPreflight &&
      typeof window.TravelFacialPreflight.isReady === "function"
    ) {
      try {
        if (
          window.TravelFacialPreflight.isReady()
        ) {
          return true;
        }
      } catch (_) {}
    }

    const candidates = [
      $("facialPreflightResult"),
      $("identityResult"),
      $("faceResult"),
      $("facialResult")
    ].filter(Boolean);

    for (const element of candidates) {
      const text =
        element.textContent || "";

      if (
        element.dataset.status === "success" ||
        element.dataset.result === "success" ||
        element.classList.contains("success") ||
        element.classList.contains("approved") ||
        /aprovado|validado|verificado|sucesso|success/i.test(text)
      ) {
        return true;
      }
    }

    return false;
  }

  function isApplicationReady() {
    const list = $("applicationsList");

    if (list) {
      const cards =
        list.querySelectorAll(
          ".application-card, [data-application-id]"
        );

      if (cards.length > 0) {
        return true;
      }
    }

    const result = $("applicationResultState");

    if (result) {
      const text =
        result.textContent || "";

      if (
        result.dataset.status === "success" ||
        /aprovado|preparado|criado|sucesso|success/i.test(text)
      ) {
        return true;
      }
    }

    return false;
  }

  function isOperationsReady() {
    return true;
  }

  function isStepReady(id) {
    switch (id) {
      case "client":
        return isClientReady();

      case "passport":
        return isPassportReady();

      case "identity":
        return isIdentityReady();

      case "application":
        return isApplicationReady();

      case "operations":
        return isOperationsReady();

      default:
        return false;
    }
  }

  function markComplete(id) {
    if (!id) {
      return;
    }

    state.completed.add(id);

    renderProgress();
    renderBottom();
  }

  function showStepError(id) {
    const step = STEPS.find(
      (item) => item.id === id
    );

    if (!step) {
      return;
    }

    const stage = document.querySelector(
      ".workflow-stage-frame"
    );

    if (!stage) {
      return;
    }

    stage.classList.remove(
      "workflow-shake"
    );

    void stage.offsetWidth;

    stage.classList.add(
      "workflow-shake"
    );

    let message =
      "Conclua os requisitos desta etapa antes de continuar.";

    if (id === "client") {
      message =
        "Preencha pelo menos o nome completo do viajante antes de continuar.";
    }

    if (id === "passport") {
      message =
        "O passaporte ainda não foi validado. Conclua a validação e aguarde o resultado.";
    }

    if (id === "identity") {
      const result =
        $("facialPreflightResult");

      const resultText =
        result?.textContent || "";

      if (
        /reprov|rejeit|falhou|não aprovado|nao aprovado/i.test(
          resultText
        )
      ) {
        message =
          "A verificação facial não foi aprovada. Siga as instruções mostradas no módulo facial e tente novamente.";
      } else {
        message =
          "A verificação facial ainda não foi concluída. Inicie o processo e siga todos os movimentos solicitados.";
      }
    }

    if (id === "application") {
      message =
        "Crie ou prepare pelo menos uma aplicação antes de entrar no centro de operações.";
    }

    const old =
      document.getElementById(
        "workflowInlineError"
      );

    if (old) {
      old.remove();
    }

    const error =
      document.createElement("div");

    error.id =
      "workflowInlineError";

    error.className =
      "workflow-inline-error";

    error.innerHTML = `
      <span>!</span>

      <div>
        <strong>
          Ainda não é possível avançar
        </strong>

        <p>
          ${escapeHtml(message)}
        </p>
      </div>
    `;

    const host =
      stage.querySelector(
        ".workflow-section-host"
      ) || stage;

    host.prepend(error);

    error.scrollIntoView({
      behavior: reducedMotion()
        ? "auto"
        : "smooth",
      block: "nearest"
    });

    if (id === "client") {
      focusClient();
    }

    if (id === "passport") {
      focusPassport();
    }

    if (id === "identity") {
      openFacialCenter();
    }

    if (id === "application") {
      focusApplication();
    }

    setTimeout(() => {
      error.classList.add(
        "is-visible"
      );
    }, 20);
  }

  function focusClient() {
    const name =
      $("clientFullName");

    if (name) {
      name.focus();
      name.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "center"
      });
    } else {
      const section =
        $("clientSection");

      section?.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "center"
      });
    }
  }

  function focusPassport() {
    const section =
      $("passportSection");

    if (section) {
      section.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "center"
      });
    }
  }

  function focusApplication() {
    const section =
      $("applicationSection");

    if (section) {
      section.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "center"
      });
    }
  }

  function openFacialCenter() {
    const ids = [
      "facialPreflightStart",
      "startFacialPreflight",
      "identityStartButton"
    ];

    for (const id of ids) {
      const button = $(id);

      if (
        button &&
        typeof button.click === "function"
      ) {
        button.click();
        return;
      }
    }

    if (
      window.FacialPreflightUI &&
      typeof window.FacialPreflightUI.open === "function"
    ) {
      try {
        window.FacialPreflightUI.open();
        return;
      } catch (_) {}
    }

    const section =
      $("identitySection");

    if (section) {
      section.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "center"
      });
    }
  }

  function handleNext() {
    if (state.transitioning) {
      return;
    }

    const step =
      getCurrentStep();

    if (state.completed.has(step.id)) {
      if (
        state.current <
        STEPS.length - 1
      ) {
        goTo(state.current + 1);
      }

      return;
    }

    if (!isStepReady(step.id)) {
      showStepError(step.id);
      return;
    }

    markComplete(step.id);

    if (
      state.current <
      STEPS.length - 1
    ) {
      setTimeout(() => {
        goTo(state.current + 1);
      }, reducedMotion() ? 0 : 180);
    }
  }

  function goTo(index) {
    if (
      index < 0 ||
      index >= STEPS.length ||
      state.transitioning
    ) {
      return;
    }

    if (index > state.current) {
      for (
        let i = 0;
        i < index;
        i += 1
      ) {
        if (!state.completed.has(STEPS[i].id)) {
          showStepError(
            STEPS[i].id
          );
          return;
        }
      }
    }

    if (index === state.current) {
      return;
    }

    state.transitioning = true;

    const previousFrame =
      stageContainer?.querySelector(
        ".workflow-stage-frame"
      );

    const finish = () => {
      state.current = index;
      state.transitioning = false;

      render();

      const newFrame =
        stageContainer?.querySelector(
          ".workflow-stage-frame"
        );

      if (newFrame) {
        newFrame.scrollIntoView({
          behavior: reducedMotion()
            ? "auto"
            : "smooth",
          block: "start"
        });
      }
    };

    if (
      reducedMotion() ||
      !previousFrame
    ) {
      finish();
      return;
    }

    previousFrame.classList.add(
      "is-leaving"
    );

    setTimeout(
      finish,
      220
    );
  }

  function next() {
    handleNext();
  }

  function back() {
    if (state.current > 0) {
      goTo(state.current - 1);
    }
  }

  function syncCompletion() {
    STEPS.forEach((step, index) => {
      if (
        index < state.current &&
        isStepReady(step.id)
      ) {
        state.completed.add(
          step.id
        );
      }
    });

    renderProgress();
    renderBottom();
  }

  function observeApplicationChanges() {
    if (observersStarted) {
      return;
    }

    observersStarted = true;

    const observeTarget = (
      element,
      callback
    ) => {
      if (!element) {
        return;
      }

      const observer =
        new MutationObserver(() => {
          callback();
        });

      observer.observe(
        element,
        {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "class",
            "data-status",
            "data-result"
          ]
        }
      );
    };

    observeTarget(
      $("applicationsList"),
      () => {
        if (
          state.current === 3 &&
          isApplicationReady()
        ) {
          markComplete(
            "application"
          );
        }
      }
    );

    observeTarget(
      $("facialPreflightResult"),
      () => {
        renderFeedback(
          getCurrentStep()
        );

        if (
          state.current === 2 &&
          isIdentityReady()
        ) {
          markComplete(
            "identity"
          );
        }
      }
    );

    observeTarget(
      $("passportResultState"),
      () => {
        if (
          state.current === 1 &&
          isPassportReady()
        ) {
          markComplete(
            "passport"
          );
        }
      }
    );

    const appView =
      $("appView");

    if (appView) {
      const visibilityObserver =
        new MutationObserver(() => {
          if (
            !state.initialized &&
            isAppVisible()
          ) {
            init();
          }
        });

      visibilityObserver.observe(
        appView,
        {
          attributes: true,
          attributeFilter: [
            "class",
            "style"
          ]
        }
      );
    }

    document.addEventListener(
      "input",
      () => {
        if (
          state.current === 0 &&
          isClientReady()
        ) {
          markComplete(
            "client"
          );
        }
      },
      true
    );

    document.addEventListener(
      "change",
      () => {
        syncCompletion();
      },
      true
    );

    document.addEventListener(
      "submit",
      () => {
        setTimeout(
          syncCompletion,
          300
        );
      },
      true
    );
  }

  function isAppVisible() {
    const appView =
      $("appView");

    if (!appView) {
      return false;
    }

    const style =
      window.getComputedStyle(
        appView
      );

    return (
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  }

  function init() {
    if (
      state.initialized &&
      $("travelWorkflow")
    ) {
      return;
    }

    if (!createShell()) {
      return;
    }

    state.initialized = true;

    syncInitialState();
    render();
    observeApplicationChanges();
  }

  function syncInitialState() {
    /*
     * Não saltamos automaticamente etapas futuras.
     * Apenas reconhecemos etapas que já estejam comprovadamente
     * concluídas pelo estado da aplicação.
     */

    if (isClientReady()) {
      state.completed.add(
        "client"
      );
    }

    if (isPassportReady()) {
      state.completed.add(
        "passport"
      );
    }

    if (isIdentityReady()) {
      state.completed.add(
        "identity"
      );
    }

    if (isApplicationReady()) {
      state.completed.add(
        "application"
      );
    }

    /*
     * Mantém a experiência guiada:
     * a primeira etapa incompleta vira a etapa actual.
     */

    const firstIncomplete =
      STEPS.findIndex(
        (step) =>
          !state.completed.has(
            step.id
          )
      );

    if (
      firstIncomplete >= 0
    ) {
      state.current =
        firstIncomplete;
    } else {
      state.current =
        STEPS.length - 1;
    }

    /*
     * Evita que uma etapa futura seja considerada desbloqueada
     * apenas porque existe conteúdo no DOM.
     */
    for (
      let i = state.current + 1;
      i < STEPS.length;
      i += 1
    ) {
      if (
        !isStepReady(
          STEPS[i].id
        )
      ) {
        state.completed.delete(
          STEPS[i].id
        );
      }
    }
  }

  /*
   * API pública para os outros módulos.
   */
  window.TravelWorkflow = {
    init,
    next,
    back,
    goTo,
    markComplete,
    getState() {
      return {
        current: state.current,
        currentStep:
          STEPS[state.current]?.id ||
          null,
        completed:
          Array.from(
            state.completed
          ),
        initialized:
          state.initialized
      };
    }
  };

  /*
   * Inicialização.
   */
  function boot() {
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

    /*
     * O login pode mostrar appView posteriormente.
     * Por isso tentamos novamente de forma segura.
     */
    setTimeout(init, 400);
    setTimeout(init, 1200);
    setTimeout(init, 2500);
  }

  boot();
})();
