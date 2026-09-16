(() => {
  "use strict";

  /*
   * ==========================================================
   * TRAVEL AUTOMATION
   * Guided Travel Workflow
   *
   * FLUXO OFICIAL:
   *
   * 01 — PASSAPORTE
   * 02 — IDENTIDADE
   * 03 — CANDIDATURA
   * 04 — ACOMPANHAMENTO
   * ==========================================================
   */

  const STEPS = [
    {
      id: "passport",
      number: "01",
      icon: "document",
      eyebrow: "PRIMEIRA ETAPA",
      title: "Passaporte",
      description:
        "Fotografe ou anexe o seu passaporte. O sistema irá analisar o documento e criar automaticamente o seu perfil.",
      section: "clientSection",
      readyLabel: "Passaporte validado"
    },

    {
      id: "identity",
      number: "02",
      icon: "face",
      eyebrow: "SEGUNDA ETAPA",
      title: "Confirmação de identidade",
      description:
        "Faça a verificação facial seguindo as instruções apresentadas no ecrã.",
      section: "applicationSection",
      readyLabel: "Identidade confirmada"
    },

    {
      id: "application",
      number: "03",
      icon: "application",
      eyebrow: "TERCEIRA ETAPA",
      title: "Preparação da candidatura",
      description:
        "Com a sua identidade confirmada, escolha o tipo de visto e prepare os dados da candidatura.",
      section: "applicationSection",
      readyLabel: "Candidatura preparada"
    },

    {
      id: "operations",
      number: "04",
      icon: "radar",
      eyebrow: "QUARTA ETAPA",
      title: "Acompanhamento",
      description:
        "Acompanhe o estado do seu processo depois de concluir a preparação.",
      section: "verificationSection",
      readyLabel: "Acompanhamento disponível"
    }
  ];


  const TOTAL_STEPS =
    String(STEPS.length).padStart(2, "0");


  const state = {
    currentIndex: 0,
    completed: new Set(),
    initialized: false,
    transitioning: false
  };


  function $(id) {
    return document.getElementById(id);
  }


  function getCurrentStep() {
    return STEPS[state.currentIndex];
  }


  /* =========================================================
     WORKFLOW
  ========================================================= */

  function createWorkflow() {
    if ($("travelWorkflow")) {
      return $("travelWorkflow");
    }

    const workflow =
      document.createElement("section");

    workflow.id =
      "travelWorkflow";

    workflow.className =
      "travel-workflow";

    workflow.setAttribute(
      "aria-label",
      "Preparação da viagem"
    );

    workflow.innerHTML = `
      <div
        class="workflow-atmosphere"
        aria-hidden="true"
      >
        <div class="workflow-glow"></div>
        <div class="workflow-horizon"></div>
        <div class="workflow-route-orbit"></div>
      </div>


      <aside class="workflow-sidebar">

        <div class="workflow-brand">

          <div class="workflow-brand-mark">
            <span>TA</span>
          </div>

          <div>
            <strong>
              TRAVEL AUTOMATION
            </strong>

            <span>
              Preparação de viagem
            </span>
          </div>

        </div>


        <div class="workflow-progress-header">

          <span>
            O seu percurso
          </span>

          <strong id="workflowProgressText">
            01 de ${TOTAL_STEPS}
          </strong>

        </div>


        <nav
          id="workflowProgress"
          class="workflow-progress"
          aria-label="Etapas da preparação"
        ></nav>


        <div class="workflow-sidebar-note">

          <span class="workflow-note-icon">
            <span class="shield-icon"></span>
          </span>

          <div>

            <strong>
              Processo protegido
            </strong>

            <span>
              Avançamos apenas quando
              a etapa anterior estiver pronta.
            </span>

          </div>

        </div>

      </aside>


      <div class="workflow-content">

        <div class="workflow-topline">

          <div class="workflow-breadcrumb">

            <span>
              Travel Automation
            </span>

            <i></i>

            <strong id="workflowEyebrow">
              PRIMEIRA ETAPA
            </strong>

          </div>


          <div class="workflow-live">

            <span></span>

            Preparação ativa

          </div>

        </div>


        <div class="workflow-heading">

          <div class="workflow-heading-copy">

            <div
              id="workflowStageIcon"
              class="workflow-stage-icon"
              aria-hidden="true"
            >
              <span class="document-icon"></span>
            </div>


            <div>

              <span
                id="workflowEyebrowCopy"
                class="workflow-eyebrow"
              >
                PRIMEIRA ETAPA
              </span>


              <h1 id="workflowTitle">
                Passaporte
              </h1>


              <p id="workflowDescription">
                Fotografe ou anexe o seu passaporte.
              </p>

            </div>

          </div>


          <div class="workflow-counter">

            <span>
              ETAPA
            </span>

            <strong id="workflowCounter">
              01
            </strong>

            <small id="workflowTotal">
              / ${TOTAL_STEPS}
            </small>

          </div>

        </div>


        <div class="workflow-route">

          <div class="workflow-route-line">

            <span
              id="workflowFlightProgress"
              class="workflow-route-progress"
            ></span>

            <span
              id="workflowPlane"
              class="workflow-plane"
            >
              ✈
            </span>

          </div>


          <div
            id="workflowRouteLabels"
            class="workflow-route-labels"
          ></div>

        </div>


        <div
          id="workflowStage"
          class="workflow-stage"
          aria-live="polite"
        ></div>


        <div class="workflow-assist">

          <div class="workflow-assist-visual">

            <div class="assist-sky"></div>

            <div class="assist-orbit orbit-one"></div>
            <div class="assist-orbit orbit-two"></div>

            <div
              id="workflowAssistGraphic"
              class="workflow-assist-graphic"
            >
              <span class="assist-person"></span>
            </div>

          </div>


          <div class="workflow-assist-copy">

            <span class="assist-label">
              ORIENTAÇÃO
            </span>


            <strong id="workflowAssistTitle">
              Comece pelo seu passaporte
            </strong>


            <p id="workflowAssistText">
              Fotografe ou anexe o passaporte.
              O sistema tratará dos seus dados
              automaticamente.
            </p>

          </div>

        </div>


        <div
          id="workflowStatus"
          class="workflow-status"
        >

          <div class="workflow-status-indicator">
            <span></span>
          </div>


          <div>

            <strong id="workflowStatusTitle">
              Etapa atual
            </strong>


            <span id="workflowStatusText">
              Complete esta etapa para continuar.
            </span>

          </div>

        </div>


        <div class="workflow-bottom">

          <button
            id="workflowBack"
            class="workflow-button workflow-button-secondary"
            type="button"
          >
            <span>←</span>
            Voltar
          </button>


          <div class="workflow-bottom-center">

            <span id="workflowBottomHint">
              Complete a etapa atual para avançar.
            </span>

          </div>


          <button
            id="workflowNext"
            class="workflow-button workflow-button-primary"
            type="button"
          >
            Continuar
            <span>→</span>
          </button>

        </div>

      </div>
    `;

    return workflow;
  }


  /* =========================================================
     PROGRESS
  ========================================================= */

  function buildProgress() {
    const container =
      $("workflowProgress");

    if (!container) {
      return;
    }

    container.innerHTML = "";

    STEPS.forEach(
      (step, index) => {

        const button =
          document.createElement("button");

        button.type = "button";

        button.className =
          "workflow-progress-item";

        button.dataset.index =
          String(index);

        button.innerHTML = `
          <span class="workflow-progress-number">
            ${step.number}
          </span>

          <span class="workflow-progress-icon">
            <span class="${step.icon}-icon"></span>
          </span>

          <span class="workflow-progress-copy">

            <strong>
              ${step.title}
            </strong>

            <small>
              ${getProgressDescription(step.id)}
            </small>

          </span>

          <span class="workflow-progress-state"></span>
        `;

        button.addEventListener(
          "click",
          () => {

            if (
              index >
              state.currentIndex
            ) {
              return;
            }

            goTo(index);
          }
        );

        container.appendChild(button);
      }
    );
  }


  function buildRouteLabels() {
    const container =
      $("workflowRouteLabels");

    if (!container) {
      return;
    }

    container.innerHTML = "";

    const labels = [
      "Passaporte",
      "Identidade",
      "Candidatura",
      "Acompanhar"
    ];

    labels.forEach(label => {
      const element =
        document.createElement("span");

      element.textContent =
        label;

      container.appendChild(element);
    });
  }


  function getProgressDescription(id) {
    const descriptions = {
      passport:
        "Documento de viagem",

      identity:
        "Verificação facial",

      application:
        "Dados da candidatura",

      operations:
        "Estado do processo"
    };

    return descriptions[id] || "";
  }


  function updateProgress() {
    document
      .querySelectorAll(
        ".workflow-progress-item"
      )
      .forEach(
        (item, index) => {

          const completed =
            state.completed.has(
              STEPS[index].id
            );

          const active =
            index ===
            state.currentIndex;

          const locked =
            index >
              state.currentIndex &&
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

          item.disabled =
            locked;

          const stateElement =
            item.querySelector(
              ".workflow-progress-state"
            );

          if (stateElement) {

            if (completed) {
              stateElement.textContent =
                "Concluído";
            } else if (active) {
              stateElement.textContent =
                "Atual";
            } else {
              stateElement.textContent =
                "A seguir";
            }
          }
        }
      );


    const progressText =
      $("workflowProgressText");

    if (progressText) {
      progressText.textContent =
        `${String(
          state.currentIndex + 1
        ).padStart(2, "0")} de ${TOTAL_STEPS}`;
    }
  }


  /* =========================================================
     HEADER
  ========================================================= */

  function getIconMarkup(icon) {
    const map = {
      person:
        "person-icon",

      document:
        "document-icon",

      face:
        "face-icon",

      application:
        "application-icon",

      radar:
        "radar-icon"
    };

    return `
      <span
        class="${map[icon] || "person-icon"}"
      ></span>
    `;
  }


  function updateHeader() {
    const step =
      getCurrentStep();

    const eyebrow =
      $("workflowEyebrow");

    const eyebrowCopy =
      $("workflowEyebrowCopy");

    const title =
      $("workflowTitle");

    const description =
      $("workflowDescription");

    const counter =
      $("workflowCounter");

    const icon =
      $("workflowStageIcon");

    if (eyebrow) {
      eyebrow.textContent =
        step.eyebrow;
    }

    if (eyebrowCopy) {
      eyebrowCopy.textContent =
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

    if (counter) {
      counter.textContent =
        step.number;
    }

    if (icon) {
      icon.innerHTML =
        getIconMarkup(step.icon);

      icon.dataset.stage =
        step.id;
    }


    const assistTitle =
      $("workflowAssistTitle");

    const assistText =
      $("workflowAssistText");

    const assistGraphic =
      $("workflowAssistGraphic");


    if (assistTitle) {

      const titles = {

        passport:
          "Comece pelo seu passaporte",

        identity:
          "Vamos confirmar a sua identidade",

        application:
          "Prepare a sua candidatura",

        operations:
          "Agora pode acompanhar o processo"
      };

      assistTitle.textContent =
        titles[step.id] ||
        "Vamos continuar";
    }


    if (assistText) {

      const texts = {

        passport:
          "Fotografe ou anexe o passaporte. Os dados serão analisados automaticamente e o seu perfil será criado.",

        identity:
          "Siga as instruções da verificação facial e mantenha o rosto dentro da área indicada.",

        application:
          "Escolha o tipo de visto e informe o período pretendido para preparar a candidatura.",

        operations:
          "O processo está preparado. A partir daqui poderá acompanhar o seu estado."
      };

      assistText.textContent =
        texts[step.id] ||
        "Complete a etapa atual para continuar.";
    }


    if (assistGraphic) {
      assistGraphic.className =
        `workflow-assist-graphic stage-${step.id}`;
    }
  }


  /* =========================================================
     ROUTE
  ========================================================= */

  function updateRoute() {
    const progress =
      $("workflowFlightProgress");

    const plane =
      $("workflowPlane");

    if (!progress || !plane) {
      return;
    }

    const divisor =
      Math.max(
        1,
        STEPS.length - 1
      );

    const percentage =
      (
        state.currentIndex /
        divisor
      ) * 100;

    progress.style.width =
      `${Math.max(
        8,
        percentage
      )}%`;

    plane.style.left =
      `${Math.min(
        96,
        Math.max(
          4,
          percentage
        )
      )}%`;
  }


  /* =========================================================
     STATUS
  ========================================================= */

  function updateStatus() {
    const step =
      getCurrentStep();

    const statusTitle =
      $("workflowStatusTitle");

    const statusText =
      $("workflowStatusText");

    const bottomHint =
      $("workflowBottomHint");

    const next =
      $("workflowNext");

    const ready =
      isCurrentReady();


    if (statusTitle) {
      statusTitle.textContent =
        ready
          ? step.readyLabel
          : getWaitingTitle(step.id);
    }


    if (statusText) {
      statusText.textContent =
        ready
          ? getReadyDescription(step.id)
          : getWaitingDescription(step.id);
    }


    if (bottomHint) {
      bottomHint.textContent =
        ready
          ? "Tudo pronto para continuar."
          : getWaitingDescription(step.id);
    }


    if (next) {
      next.disabled =
        !ready;

      next.classList.toggle(
        "is-ready",
        ready
      );

      next.innerHTML =
        state.currentIndex ===
        STEPS.length - 1

          ? `Concluir <span>✓</span>`

          : `Continuar <span>→</span>`;
    }
  }


  function getWaitingTitle(id) {
    const map = {

      passport:
        "Envie o seu passaporte",

      identity:
        "Conclua a verificação de identidade",

      application:
        "Prepare a candidatura",

      operations:
        "Acompanhamento ainda bloqueado"
    };

    return (
      map[id] ||
      "Complete a etapa atual"
    );
  }


  function getWaitingDescription(id) {
    const map = {

      passport:
        "Fotografe ou anexe o passaporte para iniciar o processo.",

      identity:
        "A verificação facial precisa de ser concluída antes da candidatura.",

      application:
        "Prepare uma candidatura válida para continuar.",

      operations:
        "Conclua as etapas anteriores para desbloquear o acompanhamento."
    };

    return (
      map[id] ||
      "Complete a etapa atual para continuar."
    );
  }


  function getReadyDescription(id) {
    const map = {

      passport:
        "O passaporte foi validado e o perfil foi criado automaticamente.",

      identity:
        "A sua identidade foi confirmada.",

      application:
        "A candidatura está preparada.",

      operations:
        "O processo está disponível para acompanhamento."
    };

    return (
      map[id] ||
      "Etapa concluída."
    );
  }


  /* =========================================================
     PASSPORT
  ========================================================= */

  function isPassportReady() {
    const explicit =
      $("passportResultState");

    if (explicit) {

      const value =
        String(
          explicit.textContent ||
          explicit.value ||
          ""
        ).toLowerCase();

      if (
        value.includes("success") ||
        value.includes("valid") ||
        value.includes("confirm")
      ) {
        return true;
      }
    }


    const ready =
      $("passportCheckReady");

    if (ready) {

      const text =
        String(
          ready.textContent ||
          ""
        ).toLowerCase();

      if (
        text.includes("pronto") ||
        text.includes("confirmado") ||
        ready.classList.contains(
          "complete"
        ) ||
        ready.classList.contains(
          "success"
        )
      ) {
        return true;
      }
    }


    /*
     * O novo fluxo cria o perfil
     * automaticamente. A existência
     * de um cliente selecionado é um
     * indicador adicional.
     */

    const selectors = [
      $("applicationClient"),
      $("identityClient")
    ];

    return selectors.some(
      selector =>
        Boolean(
          selector?.value
        )
    );
  }


  /* =========================================================
     FACIAL
  ========================================================= */

  function getFacialState() {
    try {

      if (
        window.TravelFacialPreflight &&
        typeof
          window.TravelFacialPreflight
            .getState ===
            "function"
      ) {

        const stateResult =
          window.TravelFacialPreflight
            .getState();

        return normalizeFacialState(
          stateResult
        );
      }


      if (
        window.TravelFacialPreflight &&
        typeof
          window.TravelFacialPreflight
            .isReady ===
            "function"
      ) {

        return {
          ready:
            Boolean(
              window.TravelFacialPreflight
                .isReady()
            ),

          failed:
            false
        };
      }

    } catch (error) {

      console.warn(
        "[TravelWorkflow] Facial state error:",
        error
      );
    }


    const result =
      $("facialPreflightResult");

    if (result) {

      const text =
        String(
          result.textContent ||
          result.value ||
          ""
        ).toLowerCase();

      if (
        text.includes("failed") ||
        text.includes("rejected") ||
        text.includes("falhou") ||
        text.includes("reprov")
      ) {
        return {
          ready: false,
          failed: true
        };
      }


      if (
        text.includes("success") ||
        text.includes("approved") ||
        text.includes("aprov") ||
        text.includes("confirm")
      ) {
        return {
          ready: true,
          failed: false
        };
      }
    }


    return {
      ready: false,
      failed: false
    };
  }


  function normalizeFacialState(value) {
    if (!value) {
      return {
        ready: false,
        failed: false
      };
    }


    if (
      typeof value ===
      "boolean"
    ) {
      return {
        ready: value,
        failed: false
      };
    }


    const status =
      String(
        value.status ||
        value.state ||
        value.result ||
        ""
      ).toLowerCase();


    const failed =
      Boolean(
        value.failed ||
        status.includes("fail") ||
        status.includes("reject") ||
        status.includes("reprov")
      );


    const ready =
      Boolean(
        value.ready ||
        value.approved ||
        value.success ||
        status.includes("success") ||
        status.includes("approved") ||
        status.includes("aprov") ||
        status.includes("confirm")
      );


    return {
      ready:
        ready &&
        !failed,

      failed
    };
  }


  function isIdentityReady() {
    return getFacialState().ready;
  }


  /* =========================================================
     APPLICATION
  ========================================================= */

  function isApplicationReady() {
    const list =
      $("applicationsList");

    if (list) {

      const cards =
        list.querySelectorAll(
          ".application-card"
        );

      if (cards.length > 0) {
        return true;
      }
    }


    const explicit =
      document.querySelector(
        "[data-application-ready='true']"
      );

    return Boolean(explicit);
  }


  /* =========================================================
     CURRENT READY
  ========================================================= */

  function isCurrentReady() {
    const step =
      getCurrentStep();

    if (
      state.completed.has(
        step.id
      )
    ) {
      return true;
    }


    switch (step.id) {

      case "passport":
        return isPassportReady();

      case "identity":
        return isIdentityReady();

      case "application":
        return isApplicationReady();

      case "operations":
        return isApplicationReady();

      default:
        return false;
    }
  }


  /* =========================================================
     SECTION
  ========================================================= */

  function getSection(step) {
    if (!step) {
      return null;
    }

    return $(step.section);
  }


  function mountCurrentSection() {
    const stage =
      $("workflowStage");

    if (!stage) {
      return;
    }

    stage.innerHTML = "";

    const step =
      getCurrentStep();

    const section =
      getSection(step);

    if (!section) {
      return;
    }


    section.classList.add(
      "workflow-mounted-section"
    );


    stage.appendChild(section);


    if (
      step.id ===
      "passport"
    ) {

      const passportTitle =
        section.querySelector(
          ".passport-title"
        );

      if (passportTitle) {

        passportTitle.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }
    }


    if (
      step.id ===
      "identity"
    ) {

      const mount =
        $("facialPreflightMount");

      if (mount) {

        setTimeout(() => {

          mount.scrollIntoView({
            behavior:
              prefersReducedMotion()
                ? "auto"
                : "smooth",

            block: "center"
          });

        }, 100);
      }
    }
  }


  /* =========================================================
     LEGACY LAYOUT
  ========================================================= */

  function hideLegacyLayout() {
    const main =
      document.querySelector(
        ".main-container"
      );

    if (!main) {
      return;
    }

    main.classList.add(
      "workflow-managed"
    );


    Array.from(
      main.children
    ).forEach(child => {

      if (
        child.id !==
        "travelWorkflow"
      ) {

        child.classList.add(
          "workflow-legacy-hidden"
        );
      }
    });
  }


  /* =========================================================
     INSTALL
  ========================================================= */

  function installWorkflow() {
    const main =
      document.querySelector(
        ".main-container"
      );

    if (!main) {
      return;
    }


    const workflow =
      createWorkflow();

    main.prepend(workflow);

    buildProgress();

    buildRouteLabels();


    $("workflowBack")
      ?.addEventListener(
        "click",
        back
      );


    $("workflowNext")
      ?.addEventListener(
        "click",
        next
      );


    mountCurrentSection();

    updateHeader();
    updateProgress();
    updateRoute();
    updateStatus();

    bindReadinessObservers();

    state.initialized =
      true;
  }


  /* =========================================================
     READINESS OBSERVERS
  ========================================================= */

  function bindReadinessObservers() {
    const refresh =
      () => {

        if (
          !state.initialized
        ) {
          return;
        }

        updateProgress();
        updateStatus();
      };


    document.addEventListener(
      "input",
      refresh,
      true
    );


    document.addEventListener(
      "change",
      refresh,
      true
    );


    const observer =
      new MutationObserver(
        refresh
      );


    observer.observe(
      document.body,
      {
        subtree: true,
        childList: true,
        attributes: true
      }
    );
  }


  /* =========================================================
     COMPLETE
  ========================================================= */

  function completeCurrent() {
    const step =
      getCurrentStep();

    if (!step) {
      return;
    }

    state.completed.add(
      step.id
    );

    updateProgress();
    updateStatus();
  }


  /* =========================================================
     NEXT
  ========================================================= */

  function next() {
    if (state.transitioning) {
      return false;
    }

    const step =
      getCurrentStep();


    if (!isCurrentReady()) {

      showIncompleteMessage(
        step.id
      );

      return false;
    }


    completeCurrent();


    if (
      state.currentIndex >=
      STEPS.length - 1
    ) {

      showFinalState();

      return true;
    }


    state.currentIndex += 1;

    transitionToCurrent();

    return true;
  }


  /* =========================================================
     BACK
  ========================================================= */

  function back() {
    if (state.transitioning) {
      return false;
    }

    if (
      state.currentIndex <=
      0
    ) {
      return false;
    }

    state.currentIndex -= 1;

    transitionToCurrent();

    return true;
  }


  /* =========================================================
     GO TO
  ========================================================= */

  function goTo(index) {
    const target =
      Number(index);

    if (
      !Number.isInteger(target) ||
      target < 0 ||
      target >= STEPS.length
    ) {
      return false;
    }


    if (
      target >
      state.currentIndex
    ) {
      return false;
    }


    state.currentIndex =
      target;

    transitionToCurrent();

    return true;
  }


  /* =========================================================
     TRANSITION
  ========================================================= */

  function transitionToCurrent() {
    if (state.transitioning) {
      return;
    }

    state.transitioning = true;


    const workflow =
      $("travelWorkflow");

    if (!workflow) {
      state.transitioning = false;
      return;
    }


    workflow.classList.add(
      "is-transitioning"
    );


    const delay =
      prefersReducedMotion()
        ? 0
        : 180;


    setTimeout(() => {

      mountCurrentSection();

      updateHeader();
      updateProgress();
      updateRoute();
      updateStatus();


      workflow.classList.remove(
        "is-transitioning"
      );


      state.transitioning =
        false;


      const content =
        document.querySelector(
          ".workflow-content"
        );


      if (content) {

        content.scrollTo({
          top: 0,

          behavior:
            prefersReducedMotion()
              ? "auto"
              : "smooth"
        });
      }


      window.scrollTo({
        top: 0,

        behavior:
          prefersReducedMotion()
            ? "auto"
            : "smooth"
      });

    }, delay);
  }


  /* =========================================================
     INCOMPLETE
  ========================================================= */

  function showIncompleteMessage(id) {
    const status =
      $("workflowStatus");

    if (status) {

      status.classList.add(
        "is-warning"
      );

      setTimeout(() => {

        status.classList.remove(
          "is-warning"
        );

      }, 1000);
    }


    const title =
      $("workflowStatusTitle");

    const text =
      $("workflowStatusText");


    if (
      id ===
      "identity"
    ) {

      const facial =
        getFacialState();

      if (facial.failed) {

        if (title) {
          title.textContent =
            "A verificação não foi concluída";
        }

        if (text) {
          text.textContent =
            "Repita a captura facial seguindo as instruções apresentadas.";
        }

        return;
      }
    }


    if (title) {
      title.textContent =
        getWaitingTitle(id);
    }


    if (text) {
      text.textContent =
        getWaitingDescription(id);
    }
  }


  /* =========================================================
     FINAL
  ========================================================= */

  function showFinalState() {
    const title =
      $("workflowStatusTitle");

    const text =
      $("workflowStatusText");

    const next =
      $("workflowNext");


    if (title) {
      title.textContent =
        "Preparação concluída";
    }


    if (text) {
      text.textContent =
        "Todas as etapas disponíveis foram concluídas. O processo pode agora ser acompanhado.";
    }


    if (next) {
      next.disabled = true;

      next.innerHTML =
        `Preparação concluída <span>✓</span>`;
    }


    const workflow =
      $("travelWorkflow");

    workflow?.classList.add(
      "workflow-complete"
    );
  }


  /* =========================================================
     UTILITIES
  ========================================================= */

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
    );
  }


  function markComplete(stepId) {
    if (
      !STEPS.some(
        step =>
          step.id ===
          stepId
      )
    ) {
      return false;
    }

    state.completed.add(
      stepId
    );

    updateProgress();
    updateStatus();

    return true;
  }


  /* =========================================================
     INIT
  ========================================================= */

  function init() {
    if (state.initialized) {
      return;
    }

    const start =
      () => {
        installWorkflow();
      };


    if (
      document.readyState ===
      "loading"
    ) {

      document.addEventListener(
        "DOMContentLoaded",
        start,
        {
          once: true
        }
      );

    } else {
      start();
    }
  }


  /* =========================================================
     PUBLIC API
  ========================================================= */

  window.TravelWorkflow = {

    init,

    next,

    back,

    goTo,

    markComplete,

    getState() {

      return {

        current:
          getCurrentStep()?.id ||
          null,

        currentIndex:
          state.currentIndex,

        completed:
          Array.from(
            state.completed
          )
      };
    }
  };


  init();

})();
