(() => {
  "use strict";

  /*
   * ============================================================
   * TRAVEL AUTOMATION
   * TRAVEL WORKFLOW CONTROLLER
   * ============================================================
   *
   * Fluxo:
   * 01 — Viajante
   * 02 — Passaporte
   * 03 — Identidade
   * 04 — Aplicação
   * 05 — Operações
   *
   * Este ficheiro NÃO cria novos endpoints.
   * Apenas controla a apresentação do fluxo existente.
   * ============================================================
   */

  const $ = (id) => document.getElementById(id);

  const STEPS = [
    {
      id: "client",
      number: "01",
      eyebrow: "TRAVELER",
      title: "Preparar viajante",
      description:
        "Comece criando o perfil do viajante que será preparado para a operação."
    },
    {
      id: "passport",
      number: "02",
      eyebrow: "PASSPORT",
      title: "Validar passaporte",
      description:
        "Envie o passaporte para validação OCR, MRZ, correspondência e validade."
    },
    {
      id: "identity",
      number: "03",
      eyebrow: "IDENTITY",
      title: "Confirmar identidade",
      description:
        "Faça a preparação facial com os dez movimentos de verificação."
    },
    {
      id: "application",
      number: "04",
      eyebrow: "APPLICATION",
      title: "Preparar aplicação",
      description:
        "Defina os dados da aplicação e deixe o processo pronto para a operação."
    },
    {
      id: "operations",
      number: "05",
      eyebrow: "OPERATIONS",
      title: "Centro de operações",
      description:
        "Acompanhe VFS, OTP, radar de disponibilidade e processamento da vaga."
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

  function reducedMotion() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function createShell() {
    const appView = $("appView");

    if (!appView) {
      return;
    }

    shell = $("travelWorkflow");

    if (shell) {
      stageContainer = $("workflowStage");
      progressContainer = $("workflowProgress");
      bottomBar = $("workflowBottom");
      return;
    }

    shell = document.createElement("div");
    shell.id = "travelWorkflow";
    shell.className = "travel-workflow";

    shell.innerHTML = `
      <div class="workflow-atmosphere">
        <div class="workflow-orbit orbit-one"></div>
        <div class="workflow-orbit orbit-two"></div>
        <div class="workflow-particle particle-one"></div>
        <div class="workflow-particle particle-two"></div>
        <div class="workflow-particle particle-three"></div>
      </div>

      <aside class="workflow-sidebar">

        <div class="workflow-brand">
          <div class="workflow-brand-mark">
            <span>TA</span>
          </div>

          <div>
            <strong>TRAVEL AUTOMATION</strong>
            <span>OPERATIONS CENTER</span>
          </div>
        </div>

        <div class="workflow-route-label">
          TRAVELER JOURNEY
        </div>

        <nav
          id="workflowProgress"
          class="workflow-progress"
          aria-label="Progresso da operação"
        ></nav>

        <div class="workflow-sidebar-footer">
          <div class="workflow-status">
            <span></span>
            <strong>OPERATIONS ONLINE</strong>
          </div>

          <small>
            Secure travel preparation environment
          </small>
        </div>

      </aside>

      <section class="workflow-content">

        <header class="workflow-header">

          <div class="workflow-header-copy">

            <span
              id="workflowEyebrow"
              class="workflow-eyebrow"
            >
              TRAVELER
            </span>

            <h1 id="workflowTitle">
              Preparar viajante
            </h1>

            <p id="workflowDescription">
              Comece criando o perfil do viajante que será preparado para a operação.
            </p>

          </div>

          <div class="workflow-operation-status">
            <span class="workflow-live-dot"></span>
            <span>LIVE OPERATIONS</span>
          </div>

        </header>

        <div class="workflow-flight-line">
          <div class="workflow-flight-track">
            <div
              id="workflowFlightProgress"
              class="workflow-flight-progress"
            ></div>

            <div
              id="workflowPlane"
              class="workflow-plane"
              aria-hidden="true"
            >
              ✈
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

    /*
     * O workflow envolve apenas a área principal.
     * O login continua intacto.
     */
    const mainContainer =
      appView.querySelector(".main-container");

    if (mainContainer) {
      mainContainer.classList.add("workflow-managed");
      mainContainer.prepend(shell);
    } else {
      appView.appendChild(shell);
    }

    stageContainer = $("workflowStage");
    progressContainer = $("workflowProgress");
    bottomBar = $("workflowBottom");
  }

  function renderProgress() {
    if (!progressContainer) {
      return;
    }

    progressContainer.innerHTML = STEPS.map((step, index) => {
      const active = index === state.current;
      const completed = state.completed.has(step.id);
      const locked =
        index > state.current &&
        !completed;

      return `
        <button
          type="button"
          class="
            workflow-step
            ${active ? "is-active" : ""}
            ${completed ? "is-complete" : ""}
            ${locked ? "is-locked" : ""}
          "
          data-workflow-step="${escapeHtml(step.id)}"
          ${locked ? "disabled" : ""}
        >

          <span class="workflow-step-number">
            ${
              completed
                ? "✓"
                : escapeHtml(step.number)
            }
          </span>

          <span class="workflow-step-copy">
            <strong>
              ${escapeHtml(step.eyebrow)}
            </strong>

            <small>
              ${escapeHtml(step.title)}
            </small>
          </span>

          ${
            index < STEPS.length - 1
              ? `<span class="workflow-step-connector"></span>`
              : ""
          }

        </button>
      `;
    }).join("");

    progressContainer
      .querySelectorAll("[data-workflow-step]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const id =
            button.dataset.workflowStep;

          const index =
            STEPS.findIndex(
              (step) => step.id === id
            );

          if (index === -1) {
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

  function getExistingSection(id) {
    const map = {
      client: "clientSection",
      passport: "passportSection",
      identity: "identitySection",
      application: "applicationSection",
      operations: "verificationSection"
    };

    return $(map[id]);
  }

  function renderStage() {
    if (!stageContainer) {
      return;
    }

    const step = STEPS[state.current];

    const section =
      getExistingSection(step.id);

    stageContainer.innerHTML = "";

    const stageFrame =
      document.createElement("div");

    stageFrame.className =
      "workflow-stage-frame";

    stageFrame.dataset.stage =
      step.id;

    const intro = document.createElement("div");

    intro.className =
      "workflow-stage-intro";

    intro.innerHTML = `
      <div class="workflow-stage-number">
        ${escapeHtml(step.number)}
      </div>

      <div>
        <span>
          ${escapeHtml(step.eyebrow)}
        </span>

        <strong>
          ${escapeHtml(step.title)}
        </strong>
      </div>
    `;

    stageFrame.appendChild(intro);

    if (section) {
      section.classList.add("workflow-section-host");

      /*
       * Retira a secção do fluxo visual original
       * e coloca-a dentro da etapa actual.
       */
      stageFrame.appendChild(section);
    } else {
      const missing =
        document.createElement("div");

      missing.className =
        "workflow-missing";

      missing.innerHTML = `
        <div class="workflow-missing-icon">!</div>
        <strong>Etapa indisponível</strong>
        <p>
          A interface desta etapa ainda não está disponível.
        </p>
      `;

      stageFrame.appendChild(missing);
    }

    stageContainer.appendChild(stageFrame);

    requestAnimationFrame(() => {
      stageFrame.classList.add("is-visible");
    });
  }

  function renderBottom() {
    if (!bottomBar) {
      return;
    }

    const step = STEPS[state.current];

    const isLast =
      state.current === STEPS.length - 1;

    const completed =
      state.completed.has(step.id);

    bottomBar.innerHTML = `
      <div class="workflow-bottom-meta">

        <div class="workflow-bottom-route">
          <span class="workflow-bottom-dot"></span>

          <div>
            <strong>
              ETAPA ${escapeHtml(step.number)} / ${STEPS.length}
            </strong>

            <small>
              ${escapeHtml(step.eyebrow)}
            </small>
          </div>
        </div>

        <div class="workflow-bottom-hint">
          ${
            isLast
              ? "Centro de operações ativo."
              : completed
                ? "Etapa concluída. Pode continuar."
                : "Conclua esta etapa para avançar."
          }
        </div>

      </div>

      <div class="workflow-bottom-actions">

        ${
          state.current > 0
            ? `
              <button
                id="workflowBack"
                class="workflow-button secondary"
                type="button"
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
                class="workflow-button primary"
                type="button"
              >
                ${
                  completed
                    ? "Continuar"
                    : "Concluir etapa"
                }
                <span>→</span>
              </button>
            `
            : `
              <button
                id="workflowOperationsRefresh"
                class="workflow-button primary"
                type="button"
              >
                Atualizar operação
                <span>↻</span>
              </button>
            `
        }

      </div>
    `;

    const back =
      $("workflowBack");

    if (back) {
      back.addEventListener("click", () => {
        goTo(state.current - 1);
      });
    }

    const next =
      $("workflowNext");

    if (next) {
      next.addEventListener("click", () => {
        handleNext();
      });
    }

    const refresh =
      $("workflowOperationsRefresh");

    if (refresh) {
      refresh.addEventListener("click", () => {
        const button = refresh;

        button.disabled = true;
        button.classList.add("is-loading");

        const refreshButton =
          $("refreshButton");

        if (refreshButton) {
          refreshButton.click();
        }

        setTimeout(() => {
          button.disabled = false;
          button.classList.remove("is-loading");
        }, 900);
      });
    }
  }

  function updateHeader() {
    const step = STEPS[state.current];

    const eyebrow =
      $("workflowEyebrow");

    const title =
      $("workflowTitle");

    const description =
      $("workflowDescription");

    if (eyebrow) {
      eyebrow.textContent =
        step.eyebrow;
    }

    if (title) {
      title.textContent =
        step.title;
    }

    if (description) {
      description.textContent =
        step.description;
    }
  }

  function updateFlight() {
    const progress =
      $("workflowFlightProgress");

    const plane =
      $("workflowPlane");

    const percentage =
      (state.current /
        (STEPS.length - 1)) *
      100;

    if (progress) {
      progress.style.width =
        `${percentage}%`;
    }

    if (plane) {
      plane.style.left =
        `${percentage}%`;

      plane.classList.toggle(
        "is-flying",
        !reducedMotion()
      );
    }
  }

  function render() {
    createShell();

    if (!shell) {
      return;
    }

    renderProgress();
    updateHeader();
    updateFlight();
    renderStage();
    renderBottom();

    document.body.dataset.workflowStep =
      STEPS[state.current].id;
  }

  function markComplete(id) {
    if (!id) {
      return;
    }

    state.completed.add(id);

    renderProgress();
  }

  function isClientReady() {
    const name =
      $("clientFullName");

    return Boolean(
      name &&
      name.value &&
      name.value.trim().length >= 2
    );
  }

  function isPassportReady() {
    const stateElement =
      $("passportResultState");

    if (
      stateElement &&
      stateElement.classList.contains("success")
    ) {
      return true;
    }

    const check =
      $("passportCheckReady");

    if (check) {
      return (
        check.classList.contains("success") ||
        check.dataset.ready === "true" ||
        check.value === "true"
      );
    }

    return false;
  }

  function isIdentityReady() {
    if (
      window.TravelFacialPreflight &&
      typeof window.TravelFacialPreflight
        .isReady === "function"
    ) {
      return Boolean(
        window.TravelFacialPreflight.isReady()
      );
    }

    const result =
      $("facialPreflightResult");

    if (result) {
      return (
        result.classList.contains("passed") ||
        result.classList.contains("success")
      );
    }

    return false;
  }

  function hasApplication() {
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

  function handleNext() {
    const step =
      STEPS[state.current];

    if (step.id === "client") {
      if (!isClientReady()) {
        focusClientForm();
        return;
      }

      markComplete("client");
      goTo(1);
      return;
    }

    if (step.id === "passport") {
      if (!isPassportReady()) {
        focusPassport();
        return;
      }

      markComplete("passport");
      goTo(2);
      return;
    }

    if (step.id === "identity") {
      /*
       * A interface facial é aberta pelo próprio
       * Identity Center. Não iniciamos câmera
       * automaticamente aqui.
       */
      if (!isIdentityReady()) {
        openFacialCenter();
        return;
      }

      markComplete("identity");
      goTo(3);
      return;
    }

    if (step.id === "application") {
      if (!hasApplication()) {
        focusApplication();
        return;
      }

      markComplete("application");
      goTo(4);
      return;
    }

    if (step.id === "operations") {
      return;
    }
  }

  function focusClientForm() {
    const form =
      $("clientSection");

    if (!form) {
      return;
    }

    form.scrollIntoView({
      behavior: reducedMotion()
        ? "auto"
        : "smooth",
      block: "start"
    });

    setTimeout(() => {
      const field =
        $("clientFullName");

      if (field) {
        field.focus();
      }
    }, reducedMotion() ? 0 : 400);
  }

  function focusPassport() {
    const section =
      $("passportSection");

    if (!section) {
      return;
    }

    section.scrollIntoView({
      behavior: reducedMotion()
        ? "auto"
        : "smooth",
      block: "start"
    });
  }

  function focusApplication() {
    const section =
      $("applicationSection");

    if (!section) {
      return;
    }

    section.scrollIntoView({
      behavior: reducedMotion()
        ? "auto"
        : "smooth",
      block: "start"
    });
  }

  function openFacialCenter() {
    const candidates = [
      "facialPreflightStart",
      "startFacialPreflight",
      "identityStartButton"
    ];

    for (const id of candidates) {
      const button = $(id);

      if (
        button &&
        typeof button.click === "function"
      ) {
        button.click();
        return;
      }
    }

    /*
     * Se o UI facial expõe uma função global,
     * tentamos utilizá-la sem criar uma dependência
     * obrigatória.
     */
    if (
      window.FacialPreflightUI &&
      typeof window.FacialPreflightUI.open ===
        "function"
    ) {
      window.FacialPreflightUI.open();
    }
  }

  function goTo(index) {
    if (
      state.transitioning ||
      index < 0 ||
      index >= STEPS.length ||
      index === state.current
    ) {
      return;
    }

    state.transitioning = true;

    const previous =
      stageContainer?.querySelector(
        ".workflow-stage-frame"
      );

    if (previous && !reducedMotion()) {
      previous.classList.add(
        "is-leaving"
      );
    }

    const delay =
      reducedMotion() ? 0 : 220;

    setTimeout(() => {
      state.current = index;

      render();

      state.transitioning = false;

      window.scrollTo({
        top: 0,
        behavior: reducedMotion()
          ? "auto"
          : "smooth"
      });
    }, delay);
  }

  function inspectExistingState() {
    if (isClientReady()) {
      markComplete("client");
    }

    if (isPassportReady()) {
      markComplete("passport");
    }

    if (isIdentityReady()) {
      markComplete("identity");
    }

    if (hasApplication()) {
      markComplete("application");
    }
  }

  function installObservers() {
    /*
     * app.js atualiza vários elementos dinamicamente.
     * Observamos essas alterações sem substituir o app.js.
     */

    const clientName =
      $("selectedClientName");

    if (clientName) {
      const observer =
        new MutationObserver(() => {
          if (
            clientName.textContent &&
            clientName.textContent.trim() &&
            !/nenhum cliente/i.test(
              clientName.textContent
            )
          ) {
            markComplete("client");
          }
        });

      observer.observe(
        clientName,
        {
          childList: true,
          characterData: true,
          subtree: true
        }
      );
    }

    const passportResult =
      $("passportResultState");

    if (passportResult) {
      const observer =
        new MutationObserver(() => {
          if (
            passportResult.classList.contains(
              "success"
            )
          ) {
            markComplete("passport");
          }
        });

      observer.observe(
        passportResult,
        {
          attributes: true,
          attributeFilter: [
            "class",
            "data-ready"
          ],
          childList: true,
          subtree: true
        }
      );
    }

    const applications =
      $("applicationsList");

    if (applications) {
      const observer =
        new MutationObserver(() => {
          if (
            applications.querySelector(
              ".application-card"
            )
          ) {
            markComplete("application");
          }
        });

      observer.observe(
        applications,
        {
          childList: true,
          subtree: true
        }
      );
    }

    /*
     * O Identity Center é criado dinamicamente pelo
     * facial-preflight-ui.js. Quando aparece, esperamos
     * o resultado real da operação.
     */
    const bodyObserver =
      new MutationObserver(() => {
        const identity =
          $("identityCenter");

        if (!identity) {
          return;
        }

        const result =
          $("facialPreflightResult");

        if (
          result &&
          (
            result.classList.contains(
              "passed"
            ) ||
            result.classList.contains(
              "success"
            )
          )
        ) {
          markComplete("identity");
        }
      });

    bodyObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function installApplicationHooks() {
    /*
     * Não substituímos submit handlers.
     * Apenas observamos os forms existentes.
     */

    const clientForm =
      $("clientForm");

    if (clientForm) {
      clientForm.addEventListener(
        "submit",
        () => {
          setTimeout(() => {
            if (isClientReady()) {
              markComplete("client");
            }
          }, 500);
        },
        true
      );
    }

    const applicationForm =
      $("applicationForm");

    if (applicationForm) {
      applicationForm.addEventListener(
        "submit",
        () => {
          setTimeout(() => {
            if (hasApplication()) {
              markComplete(
                "application"
              );
            }
          }, 800);
        },
        true
      );
    }
  }

  function init() {
    if (state.initialized) {
      return;
    }

    state.initialized = true;

    createShell();

    if (!shell) {
      return;
    }

    /*
     * Começa sempre no viajante.
     */
    state.current = 0;

    render();

    installObservers();
    installApplicationHooks();

    /*
     * Dá tempo ao app.js para carregar clientes,
     * aplicações e estados existentes.
     */
    setTimeout(() => {
      inspectExistingState();
      renderProgress();
    }, 1000);

    setTimeout(() => {
      inspectExistingState();
      renderProgress();
    }, 3000);
  }

  /*
   * API pública mínima.
   */
  window.TravelWorkflow = {
    init,

    next() {
      handleNext();
    },

    back() {
      goTo(state.current - 1);
    },

    goTo(index) {
      goTo(index);
    },

    markComplete(id) {
      markComplete(id);
    },

    getState() {
      return {
        current:
          STEPS[state.current]?.id ||
          null,

        completed:
          Array.from(
            state.completed
          )
      };
    }
  };

  /*
   * Espera pelo DOM.
   */
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
