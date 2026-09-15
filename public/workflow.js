(() => {
  'use strict';

  /*
   * TRAVEL AUTOMATION
   * Premium one-stage workflow controller
   *
   * IMPORTANT:
   * - Existing IDs are preserved.
   * - Existing forms and event listeners are preserved.
   * - No backend/API logic is implemented here.
   * - Only one workflow stage is mounted at a time.
   */

  const STEPS = [
    {
      id: 'client',
      number: '01',
      eyebrow: 'TRAVELER',
      title: 'Dados do viajante',
      description:
        'Comece por registar os dados essenciais do viajante. Estas informações serão utilizadas nas próximas etapas da operação.',
      section: '#clientSection',
      icon: 'traveler'
    },
    {
      id: 'passport',
      number: '02',
      eyebrow: 'DOCUMENTS',
      title: 'Passaporte e documentos',
      description:
        'Valide o documento de viagem antes de avançar. O processo só continua quando esta etapa estiver pronta.',
      section: '#passportSection',
      icon: 'passport'
    },
    {
      id: 'identity',
      number: '03',
      eyebrow: 'IDENTITY',
      title: 'Reconhecimento facial',
      description:
        'Confirme a identidade do viajante através da verificação facial. Uma aprovação é necessária para continuar.',
      section: '#identitySection',
      icon: 'face'
    },
    {
      id: 'application',
      number: '04',
      eyebrow: 'APPLICATION',
      title: 'Preparar aplicação',
      description:
        'Com os dados e a identidade validados, prepare a aplicação para a próxima fase do processo.',
      section: '#applicationSection',
      icon: 'application'
    },
    {
      id: 'operations',
      number: '05',
      eyebrow: 'OPERATIONS',
      title: 'Centro de operações',
      description:
        'Acompanhe o estado da operação, monitorização e próximos acontecimentos num único centro.',
      section: '#verificationSection',
      icon: 'radar'
    }
  ];

  const state = {
    current: 0,
    completed: new Set(),
    initialized: false,
    busy: false
  };

  let shell = null;
  let stageHost = null;
  let progressRail = null;
  let titleNode = null;
  let descriptionNode = null;
  let eyebrowNode = null;
  let counterNode = null;
  let planeNode = null;
  let statusNode = null;
  let backButton = null;
  let nextButton = null;
  let assistNode = null;

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  function getMainContainer() {
    return $('.main-container');
  }

  function getSection(step) {
    return $(step.section);
  }

  function iconSvg(type) {
    const icons = {
      traveler: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="7.5" r="3.2"></circle>
          <path d="M5.5 20c.7-4 2.8-6 6.5-6s5.8 2 6.5 6"></path>
        </svg>
      `,
      passport: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="3.5" width="14" height="17" rx="2"></rect>
          <circle cx="12" cy="10" r="3"></circle>
          <path d="M8.7 10h6.6M12 7v6"></path>
          <path d="M8.5 16.5h7"></path>
        </svg>
      `,
      face: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
          <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
          <path d="M21 16v3a2 2 0 0 1-2 2h-3"></path>
          <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
          <circle cx="9" cy="10" r=".8"></circle>
          <circle cx="15" cy="10" r=".8"></circle>
          <path d="M8.5 15c2 1.4 5 1.4 7 0"></path>
        </svg>
      `,
      application: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3.5h9l3 3V20.5H6z"></path>
          <path d="M14.5 3.5v4h3.5"></path>
          <path d="M9 12h6M9 15.5h6M9 8.5h2"></path>
        </svg>
      `,
      radar: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5"></circle>
          <circle cx="12" cy="12" r="4.5"></circle>
          <path d="M12 12 18.5 5.5"></path>
          <circle cx="12" cy="12" r="1"></circle>
        </svg>
      `
    };

    return icons[type] || icons.traveler;
  }

  function createShell() {
    const main = getMainContainer();

    if (!main) {
      return false;
    }

    const existing = document.getElementById('travelWorkflow');

    if (existing) {
      shell = existing;
      stageHost = $('#workflowStage', shell);
      progressRail = $('#workflowProgress', shell);
      titleNode = $('#workflowTitle', shell);
      descriptionNode = $('#workflowDescription', shell);
      eyebrowNode = $('#workflowEyebrow', shell);
      counterNode = $('#workflowCounter', shell);
      planeNode = $('#workflowPlane', shell);
      statusNode = $('#workflowStatus', shell);
      assistNode = $('#workflowAssist', shell);
      backButton = $('#workflowBack', shell);
      nextButton = $('#workflowNext', shell);
      return true;
    }

    shell = document.createElement('section');
    shell.id = 'travelWorkflow';
    shell.className = 'travel-workflow';
    shell.setAttribute('aria-label', 'Travel Automation workflow');

    shell.innerHTML = `
      <div class="workflow-atmosphere" aria-hidden="true">
        <div class="workflow-glow workflow-glow-one"></div>
        <div class="workflow-glow workflow-glow-two"></div>
        <div class="workflow-orbit workflow-orbit-one"></div>
        <div class="workflow-orbit workflow-orbit-two"></div>
        <div class="workflow-flight-line"></div>
      </div>

      <div class="workflow-sidebar">

        <div class="workflow-brand">
          <div class="workflow-brand-mark">
            <span>TA</span>
          </div>

          <div class="workflow-brand-copy">
            <strong>TRAVEL</strong>
            <span>AUTOMATION</span>
          </div>
        </div>

        <div class="workflow-sidebar-heading">
          <span>OPERATION FLOW</span>
          <small>STEP BY STEP</small>
        </div>

        <nav
          id="workflowProgress"
          class="workflow-progress"
          aria-label="Etapas da operação">
        </nav>

        <div class="workflow-sidebar-footer">
          <div class="workflow-security">
            <span class="security-dot"></span>
            <div>
              <strong>SECURE SESSION</strong>
              <small>Protected workflow</small>
            </div>
          </div>
        </div>
      </div>

      <div class="workflow-content">

        <header class="workflow-header">

          <div class="workflow-header-copy">
            <div class="workflow-kicker">
              <span class="workflow-live-dot"></span>
              TRAVEL APPLICATION
            </div>

            <div
              id="workflowEyebrow"
              class="workflow-eyebrow">
            </div>

            <h1 id="workflowTitle"></h1>

            <p id="workflowDescription"></p>
          </div>

          <div class="workflow-counter">
            <span>STAGE</span>
            <strong id="workflowCounter">01</strong>
            <small>/ 05</small>
          </div>
        </header>

        <div class="workflow-route">
          <div class="workflow-route-track">
            <div class="workflow-route-progress"></div>
          </div>

          <div class="workflow-route-plane" id="workflowPlane">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path d="M42 23.5 25 18V7.5c0-1.2-.8-2-1.8-2h-.4c-1 0-1.8.8-1.8 2V18L6 23.5c-.7.2-1.1.8-1.1 1.5s.4 1.3 1.1 1.5L21 30v10.5c0 1.2.8 2 1.8 2h.4c1 0 1.8-.8 1.8-2V30l17-3.5c.7-.2 1.1-.8 1.1-1.5S42.7 23.7 42 23.5Z"></path>
            </svg>
          </div>

          <div class="workflow-route-label">
            <span>ROUTE</span>
            <strong>PREPARE → VERIFY → OPERATE</strong>
          </div>
        </div>

        <div
          id="workflowStatus"
          class="workflow-status"
          aria-live="polite">
        </div>

        <div class="workflow-main-card">

          <div class="workflow-card-top">
            <div class="workflow-stage-number" id="workflowStageNumber">
              01
            </div>

            <div class="workflow-stage-label">
              <span>ACTIVE STAGE</span>
              <strong id="workflowStageLabel">
                TRAVELER
              </strong>
            </div>

            <div class="workflow-card-lock">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="10" width="14" height="10" rx="2"></rect>
                <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
              </svg>
              <span>CONTROLLED</span>
            </div>
          </div>

          <div
            id="workflowAssist"
            class="workflow-assist">
          </div>

          <div
            id="workflowStage"
            class="workflow-stage-host"
            aria-live="polite">
          </div>

          <div class="workflow-navigation">

            <button
              id="workflowBack"
              class="workflow-button workflow-button-secondary"
              type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 12H5"></path>
                <path d="m11 18-6-6 6-6"></path>
              </svg>
              <span>Voltar</span>
            </button>

            <div class="workflow-navigation-info">
              <span id="workflowNavigationHint">
                Complete esta etapa para continuar.
              </span>
            </div>

            <button
              id="workflowNext"
              class="workflow-button workflow-button-primary"
              type="button">
              <span>Continuar</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14"></path>
                <path d="m13 6 6 6-6 6"></path>
              </svg>
            </button>

          </div>
        </div>

        <footer class="workflow-footer">
          <span>TRAVEL AUTOMATION</span>
          <span class="workflow-footer-separator"></span>
          <span>CONTROLLED APPLICATION ENVIRONMENT</span>
        </footer>

      </div>
    `;

    main.appendChild(shell);

    stageHost = $('#workflowStage', shell);
    progressRail = $('#workflowProgress', shell);
    titleNode = $('#workflowTitle', shell);
    descriptionNode = $('#workflowDescription', shell);
    eyebrowNode = $('#workflowEyebrow', shell);
    counterNode = $('#workflowCounter', shell);
    planeNode = $('#workflowPlane', shell);
    statusNode = $('#workflowStatus', shell);
    assistNode = $('#workflowAssist', shell);
    backButton = $('#workflowBack', shell);
    nextButton = $('#workflowNext', shell);

    return true;
  }

  function buildProgress() {
    if (!progressRail) {
      return;
    }

    progressRail.innerHTML = '';

    STEPS.forEach((step, index) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'workflow-progress-item';
      button.dataset.index = String(index);

      button.innerHTML = `
        <span class="workflow-progress-line"></span>

        <span class="workflow-progress-icon">
          ${iconSvg(step.icon)}
        </span>

        <span class="workflow-progress-copy">
          <small>${step.number}</small>
          <strong>${step.eyebrow}</strong>
          <em>${step.title}</em>
        </span>

        <span class="workflow-progress-check">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12 4 4L19 6"></path>
          </svg>
        </span>
      `;

      button.addEventListener('click', () => {
        const target = Number(button.dataset.index);

        if (target <= state.current || state.completed.has(target - 1)) {
          goTo(target);
        }
      });

      progressRail.appendChild(button);
    });
  }

  function updateProgress() {
    if (!progressRail) {
      return;
    }

    const items = $$('.workflow-progress-item', progressRail);

    items.forEach((item, index) => {
      const isCurrent = index === state.current;
      const isCompleted = state.completed.has(index);
      const isAvailable =
        index <= state.current ||
        state.completed.has(index - 1);

      item.classList.toggle('is-current', isCurrent);
      item.classList.toggle('is-completed', isCompleted);
      item.classList.toggle('is-available', isAvailable);
      item.disabled = !isAvailable;
      item.setAttribute(
        'aria-current',
        isCurrent ? 'step' : 'false'
      );
    });

    const progress =
      STEPS.length <= 1
        ? 0
        : (state.current / (STEPS.length - 1)) * 100;

    const routeProgress =
      shell.querySelector('.workflow-route-progress');

    if (routeProgress) {
      routeProgress.style.width = `${progress}%`;
    }

    if (planeNode) {
      planeNode.style.left = `${progress}%`;
    }
  }

  function hideLegacyLayout() {
    const main = getMainContainer();

    if (!main) {
      return;
    }

    /*
     * The workflow becomes the only primary surface.
     * Existing top-level dashboard components are hidden visually,
     * while the five real sections are moved into the workflow.
     */
    main.classList.add('workflow-isolated');

    Array.from(main.children).forEach(child => {
      if (child === shell) {
        return;
      }

      child.classList.add('workflow-legacy-hidden');
    });
  }

  function collectSections() {
    STEPS.forEach(step => {
      const section = getSection(step);

      if (!section) {
        return;
      }

      section.dataset.travelWorkflowSection = step.id;
      section.classList.add('workflow-managed-section');
    });
  }

  function mountCurrentSection() {
    if (!stageHost) {
      return;
    }

    const step = STEPS[state.current];
    const section = getSection(step);

    stageHost.innerHTML = '';

    if (!section) {
      showStatus(
        'Esta etapa ainda não foi encontrada na página. Verifique se o ID da secção foi preservado.',
        'error'
      );
      return;
    }

    section.hidden = false;
    section.removeAttribute('aria-hidden');
    section.classList.remove('workflow-stage-hidden');
    section.classList.add('workflow-stage-active');

    stageHost.appendChild(section);

    stageHost.scrollTop = 0;

    if (titleNode) {
      titleNode.textContent = step.title;
    }

    if (descriptionNode) {
      descriptionNode.textContent = step.description;
    }

    if (eyebrowNode) {
      eyebrowNode.textContent = `${step.number} / ${step.eyebrow}`;
    }

    if (counterNode) {
      counterNode.textContent = step.number;
    }

    const stageNumber = $('#workflowStageNumber', shell);
    const stageLabel = $('#workflowStageLabel', shell);

    if (stageNumber) {
      stageNumber.textContent = step.number;
    }

    if (stageLabel) {
      stageLabel.textContent = step.eyebrow;
    }

    renderAssist(step);
    updateNavigation();
    updateProgress();

    shell.dataset.activeStage = step.id;

    requestAnimationFrame(() => {
      shell.classList.remove('workflow-changing');

      requestAnimationFrame(() => {
        shell.classList.add('workflow-visible');
      });
    });
  }

  function renderAssist(step) {
    if (!assistNode) {
      return;
    }

    let content = '';

    if (step.id === 'client') {
      content = `
        <div class="workflow-assist-icon">
          ${iconSvg('traveler')}
        </div>
        <div>
          <strong>Prepare o viajante</strong>
          <span>
            Preencha os dados com atenção. Campos obrigatórios
            serão validados antes de avançar.
          </span>
        </div>
      `;
    }

    if (step.id === 'passport') {
      content = `
        <div class="workflow-assist-icon">
          ${iconSvg('passport')}
        </div>
        <div>
          <strong>Validação documental</strong>
          <span>
            O documento precisa estar validado antes de a
            identidade ser verificada.
          </span>
        </div>
      `;
    }

    if (step.id === 'identity') {
      content = `
        <div class="workflow-face-visual" aria-hidden="true">
          <div class="face-grid"></div>
          <div class="face-corners"></div>
          <div class="face-ring"></div>
          <div class="face-scan-line"></div>
          <div class="face-target">
            ${iconSvg('face')}
          </div>
        </div>

        <div class="workflow-assist-face-copy">
          <strong>Verificação biométrica</strong>
          <span>
            Posicione o rosto corretamente e siga as instruções
            apresentadas pelo módulo de reconhecimento facial.
          </span>
        </div>
      `;
    }

    if (step.id === 'application') {
      content = `
        <div class="workflow-assist-icon">
          ${iconSvg('application')}
        </div>
        <div>
          <strong>Aplicação pronta para preparação</strong>
          <span>
            Os dados anteriores já podem ser utilizados para
            preparar a aplicação.
          </span>
        </div>
      `;
    }

    if (step.id === 'operations') {
      content = `
        <div class="workflow-radar-visual" aria-hidden="true">
          <div class="radar-circle radar-circle-one"></div>
          <div class="radar-circle radar-circle-two"></div>
          <div class="radar-circle radar-circle-three"></div>
          <div class="radar-sweep"></div>
          <div class="radar-center"></div>
          <span class="radar-blip radar-blip-one"></span>
          <span class="radar-blip radar-blip-two"></span>
        </div>

        <div>
          <strong>Centro de operações</strong>
          <span>
            A operação entra agora na fase de acompanhamento
            e monitorização.
          </span>
        </div>
      `;
    }

    assistNode.innerHTML = content;
    assistNode.dataset.type = step.id;
  }

  function updateNavigation() {
    if (!backButton || !nextButton) {
      return;
    }

    backButton.disabled = state.current === 0;

    const last = state.current === STEPS.length - 1;

    nextButton.classList.toggle('is-final', last);

    const nextLabel = nextButton.querySelector('span');

    if (nextLabel) {
      if (last) {
        nextLabel.textContent = 'Concluir';
      } else if (state.current === 2) {
        nextLabel.textContent = 'Continuar';
      } else {
        nextLabel.textContent = 'Continuar';
      }
    }

    const hint = $('#workflowNavigationHint', shell);

    if (hint) {
      if (last) {
        hint.textContent =
          'O fluxo principal foi concluído.';
      } else if (state.completed.has(state.current)) {
        hint.textContent =
          'Etapa concluída. Pode continuar.';
      } else {
        hint.textContent =
          'Complete esta etapa para continuar.';
      }
    }
  }

  function showStatus(message, type = 'info') {
    if (!statusNode) {
      return;
    }

    statusNode.className = `workflow-status is-${type}`;

    statusNode.innerHTML = `
      <span class="workflow-status-symbol">
        ${
          type === 'success'
            ? '✓'
            : type === 'error'
              ? '!'
              : 'i'
        }
      </span>

      <span class="workflow-status-message">
        ${escapeHtml(message)}
      </span>
    `;

    statusNode.classList.add('is-visible');
  }

  function clearStatus() {
    if (!statusNode) {
      return;
    }

    statusNode.className = 'workflow-status';
    statusNode.innerHTML = '';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function focusElement(selector) {
    const element = $(selector);

    if (!element) {
      return false;
    }

    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }

    element.scrollIntoView({
      behavior:
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      block: 'center'
    });

    return true;
  }

  function isClientReady() {
    const section = $('#clientSection');

    if (!section) {
      return false;
    }

    const form = $('#clientForm', section);

    if (form) {
      const requiredFields = $$(
        'input[required], select[required], textarea[required]',
        form
      );

      if (requiredFields.length > 0) {
        return requiredFields.every(field => {
          if (typeof field.checkValidity === 'function') {
            return field.checkValidity();
          }

          return String(field.value || '').trim().length > 0;
        });
      }
    }

    const name = $('#clientFullName', section);

    return !!(
      name &&
      String(name.value || '').trim().length >= 2
    );
  }

  function isPassportReady() {
    const successState = $('#passportResultState');

    if (successState) {
      const text = (
        successState.textContent ||
        ''
      ).toLowerCase();

      const successClass =
        successState.classList.contains('success') ||
        successState.classList.contains('is-success') ||
        successState.dataset.status === 'success';

      if (
        successClass ||
        text.includes('válido') ||
        text.includes('validado') ||
        text.includes('aprovado') ||
        text.includes('approved') ||
        text.includes('valid')
      ) {
        return true;
      }
    }

    const ready = $('#passportCheckReady');

    if (ready) {
      if (
        ready.checked === true ||
        ready.getAttribute('aria-checked') === 'true' ||
        ready.dataset.ready === 'true'
      ) {
        return true;
      }
    }

    return false;
  }

  function getFacialPreflightState() {
    if (
      window.TravelFacialPreflight &&
      typeof window.TravelFacialPreflight.isReady === 'function'
    ) {
      try {
        return {
          ready: !!window.TravelFacialPreflight.isReady(),
          source: 'api'
        };
      } catch {
        // Continue with DOM fallback.
      }
    }

    const result = $('#facialPreflightResult');

    if (result) {
      const text = (
        result.textContent ||
        ''
      ).toLowerCase();

      const success =
        result.classList.contains('success') ||
        result.classList.contains('is-success') ||
        result.dataset.status === 'success' ||
        text.includes('aprovado') ||
        text.includes('aprovada') ||
        text.includes('approved') ||
        text.includes('sucesso') ||
        text.includes('verificado');

      const failure =
        result.classList.contains('error') ||
        result.classList.contains('is-error') ||
        result.classList.contains('failed') ||
        result.dataset.status === 'error' ||
        text.includes('rejeitado') ||
        text.includes('rejeitada') ||
        text.includes('falhou') ||
        text.includes('failed');

      return {
        ready: success,
        failed: failure,
        source: 'dom',
        text
      };
    }

    return {
      ready: false,
      failed: false,
      source: 'none'
    };
  }

  function isIdentityReady() {
    const result = getFacialPreflightState();

    if (result.ready) {
      return true;
    }

    return false;
  }

  function isApplicationReady() {
    const list = $('#applicationsList');

    if (list) {
      const cards = $$('.application-card', list);

      if (cards.length > 0) {
        return true;
      }

      /*
       * Some versions of the application may use a different
       * application item class. We only accept an explicit
       * application state instead of guessing.
       */
      if (
        list.dataset.ready === 'true' ||
        list.dataset.status === 'ready' ||
        list.dataset.status === 'approved'
      ) {
        return true;
      }
    }

    const section = $('#applicationSection');

    if (section) {
      const readyElement = $(
        '[data-application-ready="true"], [data-status="ready"]',
        section
      );

      if (readyElement) {
        return true;
      }
    }

    return false;
  }

  function isStepReady(index) {
    switch (STEPS[index].id) {
      case 'client':
        return isClientReady();

      case 'passport':
        return isPassportReady();

      case 'identity':
        return isIdentityReady();

      case 'application':
        return isApplicationReady();

      case 'operations':
        return true;

      default:
        return false;
    }
  }

  function triggerClientSubmit() {
    const form = $('#clientForm');

    if (!form) {
      return false;
    }

    if (
      typeof form.checkValidity === 'function' &&
      !form.checkValidity()
    ) {
      if (typeof form.reportValidity === 'function') {
        form.reportValidity();
      }

      return false;
    }

    try {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(
          new Event('submit', {
            bubbles: true,
            cancelable: true
          })
        );
      }
    } catch {
      // Existing application code remains responsible for persistence.
    }

    return true;
  }

  function openFacialCenter() {
    const candidates = [
      '#facialPreflightStart',
      '#startFacialPreflight',
      '#identityStartButton'
    ];

    for (const selector of candidates) {
      if (focusElement(selector)) {
        const button = $(selector);

        if (
          button &&
          typeof button.click === 'function'
        ) {
          button.click();
        }

        return true;
      }
    }

    if (
      window.FacialPreflightUI &&
      typeof window.FacialPreflightUI.open === 'function'
    ) {
      try {
        window.FacialPreflightUI.open();
        return true;
      } catch {
        // Ignore and provide generic guidance below.
      }
    }

    return false;
  }

  function focusPassport() {
    const section = $('#passportSection');

    if (!section) {
      return;
    }

    const button =
      $('#passportCheckButton', section) ||
      $('#checkPassportButton', section) ||
      $('button[type="submit"]', section);

    if (button) {
      button.scrollIntoView({
        behavior: getScrollBehavior(),
        block: 'center'
      });
    }
  }

  function focusApplication() {
    const section = $('#applicationSection');

    if (!section) {
      return;
    }

    const form = $('form', section);

    if (form) {
      form.scrollIntoView({
        behavior: getScrollBehavior(),
        block: 'center'
      });
    }
  }

  function getScrollBehavior() {
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 'auto';
    }

    return 'smooth';
  }

  function validateCurrentStage() {
    const step = STEPS[state.current];

    if (step.id === 'client') {
      const form = $('#clientForm');

      if (
        form &&
        typeof form.checkValidity === 'function' &&
        !form.checkValidity()
      ) {
        if (typeof form.reportValidity === 'function') {
          form.reportValidity();
        }

        showStatus(
          'Preencha corretamente os campos obrigatórios antes de continuar.',
          'error'
        );

        return false;
      }

      if (!isClientReady()) {
        showStatus(
          'Complete os dados do viajante antes de continuar.',
          'error'
        );

        focusElement('#clientFullName');

        return false;
      }

      triggerClientSubmit();

      return true;
    }

    if (step.id === 'passport') {
      if (!isPassportReady()) {
        showStatus(
          'O passaporte ainda não foi validado. Faça a verificação documental para continuar.',
          'error'
        );

        focusPassport();

        return false;
      }

      return true;
    }

    if (step.id === 'identity') {
      const facial = getFacialPreflightState();

      if (facial.failed) {
        showStatus(
          'A verificação facial não foi aprovada. Repita a captura seguindo as instruções apresentadas.',
          'error'
        );

        openFacialCenter();

        return false;
      }

      if (!isIdentityReady()) {
        showStatus(
          'A identidade ainda não foi aprovada. Inicie ou conclua a verificação facial para continuar.',
          'error'
        );

        openFacialCenter();

        return false;
      }

      return true;
    }

    if (step.id === 'application') {
      if (!isApplicationReady()) {
        showStatus(
          'A aplicação ainda não está pronta. Conclua a preparação da aplicação antes de continuar.',
          'error'
        );

        focusApplication();

        return false;
      }

      return true;
    }

    return true;
  }

  function markComplete(index) {
    if (
      typeof index !== 'number' ||
      index < 0 ||
      index >= STEPS.length
    ) {
      return;
    }

    state.completed.add(index);

    updateProgress();
    updateNavigation();

    document.dispatchEvent(
      new CustomEvent('travelworkflow:completed', {
        detail: {
          index,
          step: STEPS[index].id
        }
      })
    );
  }

  function next() {
    if (state.busy) {
      return false;
    }

    if (state.current >= STEPS.length - 1) {
      markComplete(state.current);

      showStatus(
        'Fluxo principal concluído. O centro de operações está disponível.',
        'success'
      );

      nextButton?.classList.add('is-complete');

      return true;
    }

    clearStatus();

    if (!validateCurrentStage()) {
      return false;
    }

    markComplete(state.current);

    const nextIndex = state.current + 1;

    return goTo(nextIndex);
  }

  function back() {
    if (state.busy || state.current === 0) {
      return false;
    }

    clearStatus();

    const previous = state.current - 1;

    return goTo(previous, true);
  }

  function goTo(index, fromBack = false) {
    if (
      state.busy ||
      index < 0 ||
      index >= STEPS.length
    ) {
      return false;
    }

    if (index > state.current) {
      for (let i = 0; i < index; i += 1) {
        if (!state.completed.has(i)) {
          showStatus(
            'Esta etapa está bloqueada. Complete as etapas anteriores primeiro.',
            'error'
          );

          return false;
        }
      }
    }

    if (index === state.current && !fromBack) {
      return true;
    }

    state.busy = true;

    shell?.classList.add('workflow-changing');

    window.setTimeout(() => {
      state.current = index;

      mountCurrentSection();

      state.busy = false;

      document.dispatchEvent(
        new CustomEvent('travelworkflow:stagechange', {
          detail: {
            index,
            step: STEPS[index].id
          }
        })
      );

      window.setTimeout(() => {
        scrollWorkflowIntoView();
      }, 30);
    }, prefersReducedMotion() ? 0 : 180);

    return true;
  }

  function scrollWorkflowIntoView() {
    if (!shell) {
      return;
    }

    const top =
      shell.getBoundingClientRect().top +
      window.scrollY -
      18;

    window.scrollTo({
      top: Math.max(0, top),
      behavior: getScrollBehavior()
    });
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function bindNavigation() {
    if (nextButton) {
      nextButton.addEventListener('click', next);
    }

    if (backButton) {
      backButton.addEventListener('click', back);
    }
  }

  function bindExternalStateListeners() {
    /*
     * Existing modules can update facial/passport/application
     * state asynchronously. Re-evaluate the navigation state
     * without changing the existing modules.
     */
    const observer = new MutationObserver(() => {
      if (!shell || !state.initialized) {
        return;
      }

      updateNavigation();
      updateProgress();

      const facial = getFacialPreflightState();

      if (
        state.current === 2 &&
        facial.failed
      ) {
        showStatus(
          'A verificação facial não foi aprovada. Corrija as condições indicadas e tente novamente.',
          'error'
        );
      }

      if (
        state.current === 2 &&
        facial.ready
      ) {
        showStatus(
          'Identidade aprovada. Pode continuar para a preparação da aplicação.',
          'success'
        );
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'data-status',
        'data-ready',
        'aria-checked'
      ]
    });

    document.addEventListener(
      'travelworkflow:external-update',
      updateNavigation
    );
  }

  function init() {
    if (state.initialized) {
      return window.TravelWorkflow;
    }

    if (!createShell()) {
      return null;
    }

    collectSections();
    buildProgress();
    hideLegacyLayout();
    bindNavigation();
    bindExternalStateListeners();

    state.initialized = true;

    mountCurrentSection();

    shell.classList.add('workflow-visible');

    return window.TravelWorkflow;
  }

  /*
   * Public API kept intentionally compatible with the previous
   * controller.
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
        currentStep: STEPS[state.current]?.id || null,
        completed: Array.from(state.completed),
        initialized: state.initialized
      };
    }
  };

  function boot() {
    const attempt = () => {
      if (document.body) {
        init();
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        attempt,
        { once: true }
      );
    } else {
      attempt();
    }

    /*
     * Some existing application versions render #appView after
     * authentication. Give the controller another opportunity
     * without rebuilding the workflow.
     */
    window.setTimeout(attempt, 250);
    window.setTimeout(attempt, 1000);
  }

  boot();
})();
