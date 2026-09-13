const state = {
  user: null,
  clients: [],
  applications: [],
  selectedPassport: null,
  activities: []
};


const $ = selector =>
  document.querySelector(selector);


function showToast(
  message,
  type = "info"
) {
  const toast = $("#toast");

  if (!toast) {
    return;
  }

  toast.textContent = message;

  toast.className =
    `toast ${type} visible`;

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(() => {
      toast.classList.remove(
        "visible"
      );
    }, 3500);
}


function addActivity(
  title,
  detail = ""
) {
  state.activities.unshift({
    title,
    detail,
    createdAt: new Date()
  });

  state.activities =
    state.activities.slice(0, 12);

  renderActivity();
}


function renderActivity() {
  const container =
    $("#activityFeed");

  if (!container) {
    return;
  }

  if (!state.activities.length) {
    container.innerHTML = `
      <div class="activity-empty">
        Aguardando atividade...
      </div>
    `;

    return;
  }

  container.innerHTML =
    state.activities
      .map(activity => {
        const time =
          activity.createdAt
            .toLocaleTimeString(
              "pt-PT",
              {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
              }
            );

        return `
          <div class="activity-item">

            <span class="activity-dot"></span>

            <div class="activity-content">

              <strong>
                ${escapeHtml(
                  activity.title
                )}
              </strong>

              <span>
                ${escapeHtml(
                  activity.detail ||
                  time
                )}
              </span>

            </div>

          </div>
        `;
      })
      .join("");
}


function getCsrfToken() {
  const match =
    document.cookie.match(
      /(?:^|;\s*)csrf_token=([^;]+)/
    );

  return match
    ? decodeURIComponent(
        match[1]
      )
    : "";
}


async function api(
  url,
  options = {}
) {
  const method =
    (
      options.method ||
      "GET"
    ).toUpperCase();

  const headers = {
    ...(options.headers || {})
  };


  /*
   * JSON body
   */

  if (
    options.body &&
    typeof options.body !==
      "string" &&
    !(options.body instanceof FormData)
  ) {
    headers[
      "Content-Type"
    ] =
      "application/json";

    options.body =
      JSON.stringify(
        options.body
      );
  }


  /*
   * CSRF
   */

  if (
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS"
  ) {
    const csrf =
      getCsrfToken();

    if (csrf) {
      headers[
        "X-CSRF-Token"
      ] = csrf;
    }
  }


  const response =
    await fetch(
      url,
      {
        credentials:
          "same-origin",

        ...options,

        headers
      }
    );


  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }


  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      "Request failed"
    );
  }


  return data;
}


/* =========================
   AUTH
========================= */

function showLogin() {
  $("#loginView")
    .classList.remove(
      "hidden"
    );

  $("#appView")
    .classList.add(
      "hidden"
    );
}


function showApplication() {
  $("#loginView")
    .classList.add(
      "hidden"
    );

  $("#appView")
    .classList.remove(
      "hidden"
    );
}


async function loadCurrentUser() {
  try {
    const data =
      await api(
        "/api/auth/me"
      );

    state.user =
      data.user;

    if (state.user) {
      $("#userName")
        .textContent =
        state.user.name ||
        state.user.email ||
        "";
    }

    showApplication();

    addActivity(
      "Centro de operações iniciado",
      "Sessão operacional carregada."
    );

    await refreshDashboard();

  } catch {
    /*
     * AUTH_ENABLED=false is currently
     * supported by the backend.
     */
    showLogin();
  }
}


async function login(
  email,
  password
) {
  const data =
    await api(
      "/api/auth/login",
      {
        method: "POST",

        body: {
          email,
          password
        }
      }
    );

  state.user =
    data.user;

  $("#userName")
    .textContent =
    state.user?.name ||
    state.user?.email ||
    "";

  showApplication();

  await refreshDashboard();
}


async function logout() {
  try {
    await api(
      "/api/auth/logout",
      {
        method: "POST"
      }
    );
  } catch {
    /*
     * Session may already
     * be invalid.
     */
  }

  state.user = null;

  showLogin();
}


/* =========================
   CLIENTS
========================= */

async function loadClients() {
  const data =
    await api(
      "/api/clients"
    );

  state.clients =
    data.clients || [];

  renderClientSelector();

  updateReadiness();
}


function renderClientSelector() {
  const select =
    $("#applicationClient");

  if (!select) {
    return;
  }

  select.innerHTML =
    `
      <option value="">
        Selecione um cliente
      </option>
    `;


  for (
    const client
    of state.clients
  ) {
    const option =
      document.createElement(
        "option"
      );

    option.value =
      client._id;

    option.textContent =
      client.fullName ||
      "Cliente";

    select.appendChild(
      option
    );
  }
}


/* =========================
   PASSPORT
========================= */

function formatBytes(
  bytes
) {
  if (!Number.isFinite(bytes)) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}


function updatePassportUI() {
  const file =
    state.selectedPassport;

  const status =
    $("#passportFileStatus");

  const ring =
    $("#passportReadinessRing");

  const title =
    $("#passportReadinessTitle");

  const text =
    $("#passportReadinessText");

  const checkFile =
    $("#passportCheckFile");

  const checkData =
    $("#passportCheckData");

  const checkReady =
    $("#passportCheckReady");


  if (!file) {
    status.textContent =
      "Nenhum documento selecionado";

    status.classList.remove(
      "ready"
    );

    ring.textContent =
      "0%";

    title.textContent =
      "Documento não adicionado";

    text.textContent =
      "Adicione o passaporte para iniciar a preparação.";

    checkFile.innerHTML =
      "Passaporte <b>—</b>";

    checkData.innerHTML =
      "Dados extraídos <b>—</b>";

    checkReady.innerHTML =
      "Pronto para automação <b>—</b>";

    setReadinessRing(
      ring,
      0
    );

    return;
  }


  status.textContent =
    `${file.name} · ${formatBytes(file.size)}`;

  status.classList.add(
    "ready"
  );


  /*
   * Neste momento o frontend
   * apenas confirma o documento.
   *
   * A extração real será feita
   * pelo backend no próximo passo.
   */

  ring.textContent =
    "33%";

  title.textContent =
    "Documento selecionado";

  text.textContent =
    "O passaporte está pronto para ser enviado ao processamento seguro.";

  checkFile.innerHTML =
    "Passaporte <b>✓</b>";

  checkData.innerHTML =
    "Dados extraídos <b>—</b>";

  checkReady.innerHTML =
    "Pronto para automação <b>—</b>";

  setReadinessRing(
    ring,
    33
  );
}


function setReadinessRing(
  element,
  percentage
) {
  if (!element) {
    return;
  }

  const degrees =
    Math.max(
      0,
      Math.min(
        100,
        percentage
      )
    ) * 3.6;

  element.style.background =
    `
      radial-gradient(
        circle,
        #101a29 58%,
        transparent 60%
      ),
      conic-gradient(
        var(--blue)
        0deg
        ${degrees}deg,
        rgba(255,255,255,.08)
        ${degrees}deg
      )
    `;
}


function setScore(
  percentage
) {
  const score =
    $("#readinessScore");

  if (!score) {
    return;
  }

  const safe =
    Math.max(
      0,
      Math.min(
        100,
        percentage
      )
    );

  score.textContent =
    `${safe}%`;

  const degrees =
    safe * 3.6;

  score.parentElement.style.background =
    `
      radial-gradient(
        circle,
        #111a28 58%,
        transparent 60%
      ),
      conic-gradient(
        var(--blue)
        0deg
        ${degrees}deg,
        rgba(255,255,255,.08)
        ${degrees}deg
      )
    `;
}


function updateReadiness() {
  const clients =
    state.clients.length;

  const applications =
    state.applications.length;

  const passport =
    state.selectedPassport
      ? 1
      : 0;

  const radar =
    state.applications.filter(
      application =>
        application.status ===
        "waiting_for_slot"
    ).length;


  $("#readyClient")
    .textContent =
    clients > 0
      ? "✓"
      : "0";

  $("#readyPassport")
    .textContent =
    passport
      ? "✓"
      : "0";

  $("#readyApplications")
    .textContent =
    applications;

  $("#readyRadar")
    .textContent =
    radar;


  let score = 0;

  if (clients > 0) {
    score += 25;
  }

  if (passport > 0) {
    score += 25;
  }

  if (applications > 0) {
    score += 25;
  }

  if (radar > 0) {
    score += 25;
  }


  setScore(score);


  if (score === 0) {
    $("#readinessTitle")
      .textContent =
      "A preparar";

    $("#readinessDescription")
      .textContent =
      "Adicione clientes e documentos para começar.";

  } else if (score < 50) {
    $("#readinessTitle")
      .textContent =
      "Preparação inicial";

    $("#readinessDescription")
      .textContent =
      "Ainda faltam elementos para a automação.";

  } else if (score < 100) {
    $("#readinessTitle")
      .textContent =
      "Quase pronto";

    $("#readinessDescription")
      .textContent =
      "Complete os elementos pendentes.";

  } else {
    $("#readinessTitle")
      .textContent =
      "Operacional";

    $("#readinessDescription")
      .textContent =
      "O processo possui todos os elementos principais.";
  }
}


/* =========================
   APPLICATION STATUS
========================= */

function statusLabel(
  status
) {
  const labels = {

    created:
      "Criado",

    preparing:
      "Preparando",

    otp_required:
      "Aguardando OTP",

    otp_verified:
      "OTP verificado",

    identity_verification:
      "Verificação de identidade",

    calendar:
      "Calendário",

    waiting_for_slot:
      "Aguardando vaga",

    slot_received:
      "Vaga encontrada",

    continuing:
      "A concluir",

    completed:
      "Concluído",

    error:
      "Erro",

    cancelled:
      "Cancelado"
  };

  return (
    labels[status] ||
    status ||
    "Desconhecido"
  );
}


function renderApplications() {
  const container =
    $("#applicationsList");

  container.innerHTML =
    "";

  $("#applicationCount")
    .textContent =
    state.applications.length;


  if (
    !state.applications.length
  ) {
    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-icon">
          +
        </div>

        <strong>
          Nenhum processo ainda
        </strong>

        <span>
          Crie o primeiro processo acima.
        </span>

      </div>
    `;

    updateReadiness();

    return;
  }


  for (
    const application
    of state.applications
  ) {

    const card =
      document.createElement(
        "article"
      );

    card.className =
      "application-card";


    const clientName =
      application.client
        ?.fullName ||
      "Cliente";


    const slot =
      application.slot?.date
        ? `${application.slot.date} · ${application.slot.time || ""}`
        : "Sem vaga";


    const bot1 =
      application.bot1?.status ||
      "idle";


    const bot2 =
      application.bot2?.status ||
      "idle";


    card.innerHTML = `

      <div class="application-main">

        <div class="application-avatar">
          ${escapeHtml(
            clientName
              .slice(0, 1)
              .toUpperCase()
          )}
        </div>


        <div class="application-info">

          <strong>
            ${escapeHtml(
              clientName
            )}
          </strong>

          <span>
            ${escapeHtml(
              application._id
            )}
          </span>

        </div>

      </div>


      <div class="application-status">

        <span
          class="
            status-pill
            status-${escapeHtml(
              application.status
            )}
          "
        >
          ${escapeHtml(
            statusLabel(
              application.status
            )
          )}
        </span>


        <small>
          ${escapeHtml(
            slot
          )}
        </small>

      </div>


      <div class="application-actions">

        ${
          application.status ===
          "created"
            ? `
              <button
                class="small-button prepare-button"
                data-id="${escapeHtml(
                  application._id
                )}"
              >
                Preparar
              </button>
            `
            : ""
        }


        ${
          application.status ===
          "otp_required"
            ? `
              <button
                class="small-button continue-button"
                data-id="${escapeHtml(
                  application._id
                )}"
              >
                Continuar
              </button>
            `
            : ""
        }


        ${
          application.status ===
          "waiting_for_slot"
            ? `
              <span
                class="small-button"
              >
                RADAR: ${escapeHtml(
                  bot2
                )}
              </span>
            `
            : ""
        }


        ${
          application.status ===
          "preparing"
            ? `
              <span
                class="small-button"
              >
                BOT 1: ${escapeHtml(
                  bot1
                )}
              </span>
            `
            : ""
        }


        ${
          [
            "completed",
            "cancelled",
            "error"
          ].includes(
            application.status
          )
            ? ""
            : `
              <button
                class="
                  small-button
                  danger-button
                  cancel-button
                "
                data-id="${escapeHtml(
                  application._id
                )}"
              >
                Cancelar
              </button>
            `
        }

      </div>
    `;


    container.appendChild(
      card
    );
  }


  updateReadiness();
}


/* =========================
   APPLICATIONS API
========================= */

async function loadApplications() {
  const data =
    await api(
      "/api/applications"
    );

  state.applications =
    data.applications || [];

  renderApplications();
}


/* =========================
   SYSTEM STATUS
========================= */

async function loadStats() {
  try {

    const data =
      await api(
        "/api/system/status"
      );


    const apps =
      data.applications ||
      {};


    $("#statTotal")
      .textContent =
      apps.total ??
      state.applications.length;


    $("#statWaiting")
      .textContent =
      apps.waiting ??
      state.applications.filter(
        application =>
          application.status ===
          "waiting_for_slot"
      ).length;


    $("#statProcessing")
      .textContent =
      apps.processing ??
      state.applications.filter(
        application =>
          [
            "preparing",
            "continuing",
            "identity_verification",
            "calendar"
          ].includes(
            application.status
          )
      ).length;


    $("#statCompleted")
      .textContent =
      apps.completed ??
      state.applications.filter(
        application =>
          application.status ===
          "completed"
      ).length;


    $("#connectionDot")
      .classList.add(
        "online"
      );

    $("#connectionText")
      .textContent =
      "Online";


    $("#systemHeartbeat")
      .textContent =
      `Última sincronização: ${
        new Date()
          .toLocaleTimeString(
            "pt-PT"
          )
      }`;


    /*
     * Try to reflect supervisor
     * information when the API
     * provides it.
     */

    const supervisor =
      data.supervisor ||
      data.orchestrator ||
      null;


    if (supervisor) {

      const running =
        supervisor.running ??
        supervisor.status ===
        "running";


      $("#orchestratorState")
        .textContent =
        running
          ? "Running"
          : "Idle";


      $("#orchestratorMetric")
        .textContent =
        running
          ? "Running"
          : "Idle";


      $("#orchestratorPill")
        .textContent =
        running
          ? "RUNNING"
          : "READY";
    }


  } catch {

    $("#connectionDot")
      .classList.remove(
        "online"
      );

    $("#connectionText")
      .textContent =
      "Offline";

    $("#systemHeartbeat")
      .textContent =
      "Sem ligação ao backend";
  }
}


/* =========================
   BOT UI
========================= */

function updateBotUi() {
  const applications =
    state.applications;


  const preparing =
    applications.filter(
      application =>
        [
          "preparing",
          "otp_required",
          "otp_verified",
          "identity_verification",
          "calendar"
        ].includes(
          application.status
        )
    ).length;


  const monitoring =
    applications.filter(
      application =>
        application.status ===
        "waiting_for_slot"
    ).length;


  const completed =
    applications.filter(
      application =>
        application.status ===
        "completed"
    ).length;


  $("#bot1Metric")
    .textContent =
    preparing > 0
      ? `${preparing} processo(s)`
      : "Idle";


  $("#bot2Metric")
    .textContent =
    monitoring;


  $("#bot1State")
    .textContent =
    preparing > 0
      ? "Running"
      : "Ready";


  $("#bot2State")
    .textContent =
    monitoring > 0
      ? "Monitoring"
      : "Ready";


  $("#orchestratorState")
    .textContent =
    completed > 0
      ? "Active"
      : "Ready";


  $("#bot1Pill")
    .textContent =
    preparing > 0
      ? "RUNNING"
      : "READY";


  $("#bot2Pill")
    .textContent =
    monitoring > 0
      ? "MONITORING"
      : "READY";


  $("#orchestratorPill")
    .textContent =
    completed > 0
      ? "ACTIVE"
      : "READY";


  $("#orchestratorMetric")
    .textContent =
    completed > 0
      ? `${completed} concluído(s)`
      : "Idle";
}


/* =========================
   DASHBOARD
========================= */

async function refreshDashboard() {

  await Promise.all([
    loadClients(),
    loadApplications(),
    loadStats()
  ]);

  updateBotUi();
  updateReadiness();
}


/* =========================
   EVENTS
========================= */


/*
 * Login
 */

$("#loginForm")
  .addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const email =
        $("#loginEmail")
          .value
          .trim();


      const password =
        $("#loginPassword")
          .value;


      try {

        await login(
          email,
          password
        );


        addActivity(
          "Sessão iniciada",
          "Centro de operações disponível."
        );


        showToast(
          "Sessão iniciada.",
          "success"
        );

      } catch (error) {

        showToast(
          error.message,
          "error"
        );
      }
    }
  );


/*
 * Logout
 */

$("#logoutButton")
  .addEventListener(
    "click",
    logout
  );


/*
 * Refresh
 */

$("#refreshButton")
  .addEventListener(
    "click",
    async () => {

      try {

        await refreshDashboard();


        addActivity(
          "Dashboard atualizado",
          "Dados sincronizados com o backend."
        );


        showToast(
          "Dashboard atualizado.",
          "success"
        );

      } catch (error) {

        showToast(
          error.message,
          "error"
        );
      }
    }
  );


/*
 * Passport selection
 */

$("#clientPassportFile")
  .addEventListener(
    "change",
    event => {

      const file =
        event.target.files?.[0] ||
        null;


      if (!file) {

        state.selectedPassport =
          null;

        updatePassportUI();

        return;
      }


      const maxSize =
        10 * 1024 * 1024;


      if (
        file.size >
        maxSize
      ) {

        event.target.value =
          "";

        state.selectedPassport =
          null;

        updatePassportUI();


        showToast(
          "O passaporte não pode ultrapassar 10 MB.",
          "error"
        );

        return;
      }


      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf"
      ];


      if (
        !allowedTypes.includes(
          file.type
        )
      ) {

        event.target.value =
          "";

        state.selectedPassport =
          null;

        updatePassportUI();


        showToast(
          "Formato de passaporte não suportado.",
          "error"
        );

        return;
      }


      state.selectedPassport =
        file;


      updatePassportUI();


      addActivity(
        "Passaporte selecionado",
        `${file.name} · ${formatBytes(file.size)}`
      );
    }
  );


/*
 * Client creation
 */

$("#clientForm")
  .addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const button =
        $("#saveClientButton");


      button.disabled =
        true;

      button.textContent =
        "A guardar...";


      try {

        /*
         * The current backend accepts
         * client information as JSON.
         *
         * The actual passport binary
         * upload will be connected
         * when the secure upload endpoint
         * is implemented.
         */

        const payload = {

          fullName:
            $("#clientFullName")
              .value
              .trim(),

          email:
            $("#clientEmail")
              .value
              .trim(),

          phone:
            $("#clientPhone")
              .value
              .trim(),

          dateOfBirth:
            $("#clientDateOfBirth")
              .value,

          nationality:
            $("#clientNationality")
              .value
              .trim(),

          gender:
            $("#clientGender")
              .value,

          passportNumber:
            $("#clientPassportNumber")
              .value
              .trim(),

          passportCountry:
            $("#clientPassportCountry")
              .value
              .trim(),

          passportIssueDate:
            $("#clientPassportIssueDate")
              .value,

          passportExpiryDate:
            $("#clientPassportExpiryDate")
              .value
        };


        const data =
          await api(
            "/api/clients",
            {
              method: "POST",
              body: payload
            }
          );


        event.target.reset();

        state.selectedPassport =
          null;


        updatePassportUI();


        await loadClients();


        addActivity(
          "Cliente criado",
          data.client?.fullName ||
          "Novo cliente"
        );


        showToast(
          "Cliente criado com sucesso.",
          "success"
        );


      } catch (error) {

        showToast(
          error.message,
          "error"
        );

      } finally {

        button.disabled =
          false;

        button.textContent =
          "Guardar cliente e documento";
      }
    }
  );


/*
 * Application creation
 */

$("#applicationForm")
  .addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const clientId =
        $("#applicationClient")
          .value;


      if (!clientId) {

        showToast(
          "Selecione um cliente.",
          "error"
        );

        return;
      }


      try {

        const data =
          await api(
            "/api/applications",
            {
              method: "POST",

              headers: {
                "Idempotency-Key":
                  crypto.randomUUID()
              },

              body: {

                clientId,

                preferredDates: {

                  start:
                    $("#preferredStart")
                      .value ||
                    null,

                  end:
                    $("#preferredEnd")
                      .value ||
                    null
                },

                preferredTime:
                  $("#preferredTime")
                    .value ||
                  null
              }
            }
          );


        event.target.reset();


        await loadApplications();

        await loadStats();


        updateBotUi();


        addActivity(
          "Novo processo criado",
          `Processo ${
            data.application?._id ||
            ""
          }`
        );


        showToast(
          "Processo criado com sucesso.",
          "success"
        );


      } catch (error) {

        showToast(
          error.message,
          "error"
        );
      }
    }
  );


/*
 * Application actions
 */

$("#applicationsList")
  .addEventListener(
    "click",
    async event => {

      const button =
        event.target.closest(
          "button"
        );


      if (!button) {
        return;
      }


      const id =
        button.dataset.id;


      if (!id) {
        return;
      }


      try {

        /*
         * PREPARE
         */

        if (
          button.classList.contains(
            "prepare-button"
          )
        ) {

          await api(
            `/api/applications/${id}/prepare`,
            {
              method: "POST"
            }
          );


          addActivity(
            "PREPARATION iniciada",
            `Processo ${id}`
          );


          showToast(
            "Preparação iniciada.",
            "success"
          );
        }


        /*
         * CONTINUE
         */

        if (
          button.classList.contains(
            "continue-button"
          )
        ) {

          await api(
            `/api/applications/${id}/continue`,
            {
              method: "POST"
            }
          );


          addActivity(
            "Processo retomado",
            `Processo ${id}`
          );


          showToast(
            "Processo retomado.",
            "success"
          );
        }


        /*
         * CANCEL
         */

        if (
          button.classList.contains(
            "cancel-button"
          )
        ) {

          const confirmed =
            window.confirm(
              "Tem a certeza que pretende cancelar este processo?"
            );


          if (!confirmed) {
            return;
          }


          await api(
            `/api/applications/${id}/cancel`,
            {
              method: "POST"
            }
          );


          addActivity(
            "Processo cancelado",
            `Processo ${id}`
          );


          showToast(
            "Processo cancelado.",
            "success"
          );
        }


        await refreshDashboard();


      } catch (error) {

        showToast(
          error.message,
          "error"
        );
      }
    }
  );


/* =========================
   HELPERS
========================= */

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================
   AUTO REFRESH
========================= */

let refreshTimer = null;


function startAutoRefresh() {

  if (refreshTimer) {
    clearInterval(
      refreshTimer
    );
  }


  refreshTimer =
    setInterval(
      async () => {

        if (
          $("#appView")
            .classList
            .contains(
              "hidden"
            )
        ) {
          return;
        }


        try {

          await refreshDashboard();

        } catch {
          /*
           * The status indicator
           * will show the backend
           * connection state.
           */
        }

      },
      5000
    );
}


/* =========================
   START
========================= */

updatePassportUI();

renderActivity();

loadCurrentUser();

startAutoRefresh();
