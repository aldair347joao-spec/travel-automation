(() => {
  "use strict";

  const state = {
    user: null,
    clients: [],
    applications: [],
    csrfToken: null,
    loading: false
  };


  /* =========================================================
     DOM
  ========================================================= */

  const $ = (id) => document.getElementById(id);


  /* =========================================================
     HELPERS
  ========================================================= */

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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


  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }


  function showToast(message, type = "info") {
    const container = $("toastContainer");

    if (!container) return;

    const toast = document.createElement("div");

    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";

      setTimeout(() => {
        toast.remove();
      }, 200);
    }, 3500);
  }


  function setConnection(online, text) {
    const connectionText = $("connectionText");

    if (connectionText) {
      connectionText.textContent =
        text || (online ? "Sistema operacional" : "Sistema indisponível");
    }
  }


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
      getCookie("csrfToken")
    );
  }


  /* =========================================================
     API
  ========================================================= */

  async function api(url, options = {}) {
    const config = {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : {
              "Content-Type": "application/json"
            }),
        ...(options.headers || {})
      }
    };

    const csrf = getCsrfToken();

    if (
      csrf &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(
        String(config.method || "GET").toUpperCase()
      )
    ) {
      config.headers["x-csrf-token"] = csrf;
    }

    const response = await fetch(url, config);

    const contentType = response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message =
        typeof data === "object"
          ? data.message || data.error || "Erro na operação."
          : data || "Erro na operação.";

      const error = new Error(message);

      error.status = response.status;
      error.data = data;

      throw error;
    }

    return data;
  }


  /* =========================================================
     LOGIN / SESSION
  ========================================================= */

  function showLogin() {
    $("loginView")?.classList.remove("hidden");
    $("appView")?.classList.add("hidden");
  }


  function showApp() {
    $("loginView")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");
  }


  async function loadCurrentUser() {
    try {
      const response = await api("/api/auth/me");

      state.user =
        response?.user ||
        response?.data ||
        response ||
        null;

      showApp();

      updateUserInterface();

      await refreshDashboard();

      setConnection(true, "Sistema operacional");

    } catch (error) {
      /*
       * Quando AUTH_ENABLED=false, algumas versões da API
       * podem não expor /api/auth/me. Nesse caso tentamos
       * continuar através de /api/health.
       */

      try {
        await api("/api/health");

        state.user = {
          name: "Operations Console",
          email: "dev@travel-automation.local"
        };

        showApp();

        updateUserInterface();

        await refreshDashboard();

        setConnection(true, "Sistema operacional");

      } catch (healthError) {
        console.error(healthError);

        showLogin();

        setConnection(false, "Sistema indisponível");
      }
    }
  }


  async function login() {
    try {
      const response = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({})
      });

      state.user =
        response?.user ||
        response?.data ||
        response ||
        null;

      showApp();

      updateUserInterface();

      await refreshDashboard();

      showToast("Sessão iniciada.", "success");

    } catch (error) {

      /*
       * AUTH_ENABLED=false não exige login.
       * Neste cenário mostramos diretamente o console.
       */

      try {
        await api("/api/health");

        state.user = {
          name: "Operations Console",
          email: "dev@travel-automation.local"
        };

        showApp();

        updateUserInterface();

        await refreshDashboard();

        showToast("Centro de operações iniciado.", "success");

      } catch (fallbackError) {
        console.error(error);
        console.error(fallbackError);

        showToast(
          error.message || "Não foi possível iniciar a sessão.",
          "error"
        );
      }
    }
  }


  function updateUserInterface() {
    const userName = $("userName");

    if (!userName) return;

    userName.textContent =
      state.user?.name ||
      state.user?.email ||
      "Operations Console";
  }


  /* =========================================================
     CLIENTS
  ========================================================= */

  async function loadClients() {
    try {
      const response = await api("/api/clients");

      state.clients =
        Array.isArray(response)
          ? response
          : response?.clients ||
            response?.data ||
            [];

      renderClientSelector();
      updateClientCount();
      updateReadiness();

    } catch (error) {
      console.error("Erro ao carregar clientes:", error);

      state.clients = [];

      renderClientSelector();

      showToast(
        "Não foi possível carregar os clientes.",
        "error"
      );
    }
  }


  function renderClientSelector() {
    const select = $("applicationClient");

    if (!select) return;

    const currentValue = select.value;

    select.innerHTML = `
      <option value="">Selecionar cliente</option>
      ${state.clients
        .map((client) => {
          const id = client._id || client.id;

          const name =
            client.fullName ||
            client.name ||
            "Cliente sem nome";

          return `
            <option value="${escapeHtml(id)}">
              ${escapeHtml(name)}
            </option>
          `;
        })
        .join("")}
    `;

    if (currentValue) {
      select.value = currentValue;
    }
  }


  function updateClientCount() {
    const element = $("clientCount");

    if (element) {
      element.textContent = state.clients.length;
    }
  }


  /* =========================================================
     CLIENT FORM
  ========================================================= */

  async function handleClientSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;

    const button = form.querySelector(
      'button[type="submit"]'
    );

    if (button) {
      button.disabled = true;
    }

    const payload = {
      fullName: $("clientFullName")?.value.trim(),
      email: $("clientEmail")?.value.trim(),
      phone: $("clientPhone")?.value.trim(),
      dateOfBirth: $("clientDateOfBirth")?.value || null,
      nationality: $("clientNationality")?.value.trim(),
      gender: $("clientGender")?.value || null,

      passportNumber:
        $("clientPassportNumber")?.value.trim(),

      passportIssueDate:
        $("clientPassportIssueDate")?.value || null,

      passportExpiryDate:
        $("clientPassportExpiryDate")?.value || null,

      passportCountry:
        $("clientPassportCountry")?.value.trim(),

      facialConsent:
        Boolean($("clientFacialConsent")?.checked)
    };


    try {
      const response = await api("/api/clients", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const client =
        response?.client ||
        response?.data ||
        response;

      if (client && (client._id || client.id)) {
        state.clients.unshift(client);
      }

      renderClientSelector();
      updateClientCount();
      updateReadiness();

      form.reset();

      updatePassportChecks();

      showToast(
        "Perfil do cliente criado com sucesso.",
        "success"
      );

      addActivity(
        "Novo cliente",
        "Perfil de cliente criado no sistema.",
        "blue"
      );

    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Não foi possível criar o cliente.",
        "error"
      );

    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }


  /* =========================================================
     PASSPORT READINESS
  ========================================================= */

  function hasPassportData() {
    return Boolean(
      $("clientPassportNumber")?.value.trim() ||
      $("clientPassportIssueDate")?.value ||
      $("clientPassportExpiryDate")?.value ||
      $("clientPassportCountry")?.value.trim()
    );
  }


  function updatePassportChecks() {
    const fileCheck = $("passportCheckFile");
    const dataCheck = $("passportCheckData");
    const readyCheck = $("passportCheckReady");

    const dataReady = hasPassportData();

    if (fileCheck) {
      fileCheck.classList.remove("ready");
      fileCheck.innerHTML = `
        <span>○</span>
        <span>Documento anexado</span>
      `;
    }

    if (dataCheck) {
      dataCheck.classList.toggle("ready", dataReady);

      dataCheck.innerHTML = dataReady
        ? `
          <span>✓</span>
          <span>Dados preenchidos</span>
        `
        : `
          <span>○</span>
          <span>Dados preenchidos</span>
        `;
    }

    if (readyCheck) {
      readyCheck.classList.toggle("ready", dataReady);

      readyCheck.innerHTML = dataReady
        ? `
          <span>✓</span>
          <span>Dados prontos para operação</span>
        `
        : `
          <span>○</span>
          <span>Pronto para operação</span>
        `;
    }
  }


  /* =========================================================
     APPLICATIONS
  ========================================================= */

  async function loadApplications() {
    try {
      const response = await api("/api/applications");

      state.applications =
        Array.isArray(response)
          ? response
          : response?.applications ||
            response?.data ||
            [];

      renderApplications();
      updateApplicationStats();
      updateReadiness();

    } catch (error) {
      console.error("Erro ao carregar aplicações:", error);

      state.applications = [];

      renderApplications();
      updateApplicationStats();

      showToast(
        "Não foi possível carregar as aplicações.",
        "error"
      );
    }
  }


  function getStatusLabel(status) {
    const labels = {
      created: "Criada",
      preparing: "Preparando",
      otp_required: "OTP necessário",
      otp_verified: "OTP verificado",
      identity_verification: "Verificação de identidade",
      calendar: "Calendário",
      waiting_for_slot: "No radar",
      slot_received: "Vaga encontrada",
      continuing: "A continuar",
      completed: "Concluída",
      error: "Erro",
      cancelled: "Cancelada"
    };

    return labels[status] || status || "Desconhecido";
  }


  function getApplicationClientName(application) {
    const client =
      application.client ||
      application.clientData ||
      null;

    if (typeof client === "string") {
      const found = state.clients.find(
        (item) =>
          String(item._id || item.id) === String(client)
      );

      return (
        found?.fullName ||
        "Cliente"
      );
    }

    return (
      client?.fullName ||
      client?.name ||
      "Cliente"
    );
  }


  function renderApplications() {
    const container = $("applicationsList");

    if (!container) return;

    if (!state.applications.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">◎</div>

          <strong>Nenhuma aplicação em operação</strong>

          <p>
            Crie um cliente e inicie uma aplicação
            para acompanhar o processo aqui.
          </p>
        </div>
      `;

      return;
    }


    container.innerHTML = state.applications
      .map((application) => {

        const id =
          application._id ||
          application.id;

        const clientName =
          getApplicationClientName(application);

        const status =
          application.status || "created";

        const preferredStart =
          application.preferredDates?.start ||
          application.preferredStartDate;

        const preferredEnd =
          application.preferredDates?.end ||
          application.preferredEndDate;

        const slotDate =
          application.slot?.date ||
          application.slotDate;

        const slotTime =
          application.slot?.time ||
          application.slotTime;


        return `
          <article
            class="application-card"
            data-application-id="${escapeHtml(id)}"
          >

            <div class="application-main">

              <strong>
                ${escapeHtml(clientName)}
              </strong>

              <small>
                ID:
                ${escapeHtml(String(id).slice(-12))}
              </small>

            </div>


            <div>

              <span class="application-status">
                ${escapeHtml(getStatusLabel(status))}
              </span>

              <div class="application-meta">

                <strong>
                  ${
                    slotDate
                      ? `${escapeHtml(formatDate(slotDate))} ${
                          slotTime
                            ? escapeHtml(slotTime)
                            : ""
                        }`
                      : preferredStart && preferredEnd
                        ? `${escapeHtml(formatDate(preferredStart))} — ${escapeHtml(formatDate(preferredEnd))}`
                        : "Janela não definida"
                  }
                </strong>

                <span>
                  ${escapeHtml(
                    application.preferredTime ||
                    "Horário flexível"
                  )}
                </span>

              </div>

            </div>


            <div class="application-actions">

              ${
                status === "created" ||
                status === "error"
                  ? `
                    <button
                      type="button"
                      data-action="prepare"
                      data-id="${escapeHtml(id)}"
                    >
                      Preparar
                    </button>
                  `
                  : ""
              }


              ${
                status === "otp_required"
                  ? `
                    <button
                      type="button"
                      data-action="continue"
                      data-id="${escapeHtml(id)}"
                    >
                      Continuar
                    </button>
                  `
                  : ""
              }


              ${
                status !== "completed" &&
                status !== "cancelled"
                  ? `
                    <button
                      type="button"
                      data-action="cancel"
                      data-id="${escapeHtml(id)}"
                    >
                      Cancelar
                    </button>
                  `
                  : ""
              }

            </div>

          </article>
        `;
      })
      .join("");
  }


  function updateApplicationStats() {
    const total = state.applications.length;

    const prepared = state.applications.filter(
      (application) =>
        [
          "otp_required",
          "otp_verified",
          "identity_verification",
          "calendar",
          "waiting_for_slot",
          "slot_received",
          "continuing",
          "completed"
        ].includes(application.status)
    ).length;

    const monitoring = state.applications.filter(
      (application) =>
        application.status === "waiting_for_slot" ||
        application.bot2?.monitoring === true
    ).length;


    if ($("applicationCount")) {
      $("applicationCount").textContent = total;
    }

    if ($("preparedCount")) {
      $("preparedCount").textContent = prepared;
    }

    if ($("monitoringCount")) {
      $("monitoringCount").textContent = monitoring;
    }


    updateBotCenter();
  }


  /* =========================================================
     CREATE APPLICATION
  ========================================================= */

  async function handleApplicationSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;

    const button = form.querySelector(
      'button[type="submit"]'
    );

    const clientId =
      $("applicationClient")?.value;

    if (!clientId) {
      showToast(
        "Selecione um cliente.",
        "error"
      );

      return;
    }

    const payload = {
      clientId,

      preferredDates: {
        start:
          $("preferredStartDate")?.value || null,

        end:
          $("preferredEndDate")?.value || null
      },

      preferredTime:
        $("preferredTime")?.value || null
    };


    if (button) {
      button.disabled = true;
    }


    try {
      const response = await api(
        "/api/applications",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      const application =
        response?.application ||
        response?.data ||
        response;

      if (application) {
        state.applications.unshift(application);
      }

      renderApplications();
      updateApplicationStats();
      updateReadiness();

      showToast(
        "Aplicação criada. A operação está pronta.",
        "success"
      );

      addActivity(
        "Nova aplicação",
        "Processo criado e disponível para PREPARATION.",
        "blue"
      );

      form.reset();

    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Não foi possível criar a aplicação.",
        "error"
      );

    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }


  /* =========================================================
     APPLICATION ACTIONS
  ========================================================= */

  async function prepareApplication(id) {
    try {
      showToast(
        "PREPARATION iniciou o processo.",
        "info"
      );

      addActivity(
        "PREPARATION",
        "Preparação do processo iniciada.",
        "blue"
      );

      await api(
        `/api/applications/${encodeURIComponent(id)}/prepare`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );

      await loadApplications();

      showToast(
        "Processo preparado.",
        "success"
      );

    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Falha na preparação.",
        "error"
      );
    }
  }


  async function continueApplication(id) {
    /*
     * Mantemos a rota atual, mas não tentamos inventar
     * um OTP no frontend. Quando o endpoint de verificação
     * estiver disponível, a UI deverá solicitar o código
     * antes desta etapa.
     */

    try {
      await api(
        `/api/applications/${encodeURIComponent(id)}/continue`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );

      await loadApplications();

      addActivity(
        "ORCHESTRATOR",
        "Processo continuado.",
        "blue"
      );

      showToast(
        "Processo continuado.",
        "success"
      );

    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Não foi possível continuar.",
        "error"
      );
    }
  }


  async function cancelApplication(id) {
    const confirmed = window.confirm(
      "Tem a certeza que pretende cancelar esta aplicação?"
    );

    if (!confirmed) return;


    try {
      await api(
        `/api/applications/${encodeURIComponent(id)}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );

      await loadApplications();

      addActivity(
        "Aplicação cancelada",
        "O processo foi cancelado.",
        "blue"
      );

      showToast(
        "Aplicação cancelada.",
        "success"
      );

    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Não foi possível cancelar.",
        "error"
      );
    }
  }


  /* =========================================================
     APPLICATION EVENT DELEGATION
  ========================================================= */

  function setupApplicationActions() {
    const container = $("applicationsList");

    if (!container) return;

    container.addEventListener("click", async (event) => {

      const button =
        event.target.closest("button[data-action]");

      if (!button) return;

      const action = button.dataset.action;
      const id = button.dataset.id;

      if (!id) return;

      button.disabled = true;

      try {

        if (action === "prepare") {
          await prepareApplication(id);
        }

        if (action === "continue") {
          await continueApplication(id);
        }

        if (action === "cancel") {
          await cancelApplication(id);
        }

      } finally {
        button.disabled = false;
      }
    });
  }


  /* =========================================================
     READINESS
  ========================================================= */

  function updateReadiness() {
    const hasClients =
      state.clients.length > 0;

    const hasPassport =
      hasPassportData();

    const hasApplications =
      state.applications.length > 0;

    const hasOperationalApplication =
      state.applications.some(
        (application) =>
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
          ].includes(application.status)
      );


    const clientScore =
      hasClients ? 100 : 0;

    const passportScore =
      hasPassport ? 100 : 0;

    const applicationScore =
      hasApplications ? 100 : 0;

    const operationScore =
      hasOperationalApplication ? 100 : 0;


    const score = Math.round(
      (
        clientScore +
        passportScore +
        applicationScore +
        operationScore
      ) / 4
    );


    if ($("readinessScore")) {
      $("readinessScore").textContent = score;
    }

    if ($("readinessClient")) {
      $("readinessClient").textContent =
        `${clientScore}%`;
    }

    if ($("readinessPassport")) {
      $("readinessPassport").textContent =
        `${passportScore}%`;
    }

    if ($("readinessApplication")) {
      $("readinessApplication").textContent =
        `${applicationScore}%`;
    }

    if ($("readinessOperation")) {
      $("readinessOperation").textContent =
        `${operationScore}%`;
    }


    document
      .querySelectorAll(".readiness-list > div")
      .forEach((element, index) => {
        const values = [
          clientScore,
          passportScore,
          applicationScore,
          operationScore
        ];

        element.classList.toggle(
          "ready",
          values[index] >= 100
        );
      });


    const ring =
      document.querySelector(".score-ring");

    if (ring) {
      ring.style.background = `
        conic-gradient(
          var(--blue-600) ${score * 3.6}deg,
          #e4eff7 ${score * 3.6}deg
        )
      `;
    }


    const label = $("readinessLabel");

    if (label) {
      if (score === 100) {
        label.textContent = "Operação pronta";
      } else if (score >= 75) {
        label.textContent = "Quase pronta";
      } else if (score >= 50) {
        label.textContent = "Em preparação";
      } else if (score > 0) {
        label.textContent = "Dados incompletos";
      } else {
        label.textContent = "Aguardando dados";
      }
    }


    updatePassportChecks();
  }


  /* =========================================================
     BOT CENTER
  ========================================================= */

  function updateBotCenter() {
    const activeApplication =
      state.applications.find(
        (application) =>
          application.status === "waiting_for_slot" ||
          application.status === "preparing" ||
          application.status === "continuing"
      );

    const bot1Running =
      state.applications.some(
        (application) =>
          application.bot1?.status === "running" ||
          application.status === "preparing"
      );

    const bot2Running =
      state.applications.some(
        (application) =>
          application.bot2?.monitoring === true ||
          application.status === "waiting_for_slot"
      );


    setBotVisual(
      "bot1",
      bot1Running,
      bot1Running
        ? "Processando aplicação"
        : "Aguardando operação"
    );


    setBotVisual(
      "bot2",
      bot2Running,
      bot2Running
        ? "Monitorização ativa"
        : "Monitorização inativa"
    );


    setBotVisual(
      "supervisor",
      Boolean(activeApplication),
      activeApplication
        ? "Coordenando processo"
        : "Sistema pronto"
    );


    const bot1State = $("bot1State");

    if (bot1State) {
      bot1State.textContent =
        bot1Running ? "RUNNING" : "READY";
    }


    const bot2State = $("bot2State");

    if (bot2State) {
      bot2State.textContent =
        bot2Running ? "MONITORING" : "IDLE";
    }


    const supervisorState = $("supervisorState");

    if (supervisorState) {
      supervisorState.textContent =
        activeApplication
          ? "ACTIVE"
          : "READY";
    }
  }


  function setBotVisual(name, online, message) {
    const indicator =
      $(`${name}Indicator`);

    const progress =
      $(`${name}Progress`);

    const action =
      $(`${name}LastAction`);

    if (indicator) {
      indicator.classList.toggle(
        "online",
        online
      );
    }

    if (progress) {
      progress.style.width =
        online ? "68%" : "0%";
    }

    if (action) {
      action.textContent = message;
    }
  }


  /* =========================================================
     ACTIVITY FEED
  ========================================================= */

  function addActivity(title, description, color = "") {
    const feed = $("activityFeed");

    if (!feed) return;

    const item = document.createElement("div");

    item.className = "activity-item";

    item.innerHTML = `
      <div class="activity-marker ${escapeHtml(color)}"></div>

      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
    `;

    feed.prepend(item);

    while (feed.children.length > 5) {
      feed.lastElementChild.remove();
    }
  }


  /* =========================================================
     DASHBOARD REFRESH
  ========================================================= */

  async function refreshDashboard() {
    if (state.loading) return;

    state.loading = true;

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
      console.error(error);

      setConnection(
        false,
        "Falha na atualização"
      );

    } finally {
      state.loading = false;
    }
  }


  /* =========================================================
     EVENTS
  ========================================================= */

  function setupEvents() {

    $("loginButton")?.addEventListener(
      "click",
      login
    );


    $("refreshButton")?.addEventListener(
      "click",
      async () => {

        const button =
          $("refreshButton");

        if (button) {
          button.style.transform =
            "rotate(360deg)";
        }

        await refreshDashboard();

        setTimeout(() => {
          if (button) {
            button.style.transform = "";
          }
        }, 400);
      }
    );


    $("clientForm")?.addEventListener(
      "submit",
      handleClientSubmit
    );


    $("applicationForm")?.addEventListener(
      "submit",
      handleApplicationSubmit
    );


    [
      "clientPassportNumber",
      "clientPassportIssueDate",
      "clientPassportExpiryDate",
      "clientPassportCountry"
    ].forEach((id) => {

      $(id)?.addEventListener(
        "input",
        updateReadiness
      );

      $(id)?.addEventListener(
        "change",
        updateReadiness
      );

    });


    $("applicationClient")?.addEventListener(
      "change",
      updateReadiness
    );


    setupApplicationActions();


    document
      .querySelectorAll('a[href^="#"]')
      .forEach((link) => {

        link.addEventListener(
          "click",
          (event) => {

            const target =
              document.querySelector(
                link.getAttribute("href")
              );

            if (!target) return;

            event.preventDefault();

            target.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }
        );

      });
  }


  /* =========================================================
     INITIALIZATION
  ========================================================= */

  async function init() {
    setupEvents();

    updatePassportChecks();

    updateReadiness();

    await loadCurrentUser();
  }


  document.addEventListener(
    "DOMContentLoaded",
    init
  );

})();
