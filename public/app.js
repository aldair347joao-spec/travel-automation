const state = {
  user: null,
  clients: [],
  applications: []
};

const $ = selector =>
  document.querySelector(
    selector
  );

function showToast(
  message,
  type = "info"
) {
  const toast =
    $("#toast");

  toast.textContent =
    message;

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

  if (
    options.body &&
    typeof options.body !==
      "string"
  ) {
    headers[
      "Content-Type"
    ] = "application/json";

    options.body =
      JSON.stringify(
        options.body
      );
  }

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
        "Request failed"
    );
  }

  return data;
}

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

    $("#userName")
      .textContent =
      state.user.name;

    showApplication();

    await refreshDashboard();
  } catch {
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
    state.user.name;

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
    // Session may already be invalid.
  }

  state.user = null;

  showLogin();
}

async function loadClients() {
  const data =
    await api(
      "/api/clients"
    );

  state.clients =
    data.clients || [];

  const select =
    $("#applicationClient");

  select.innerHTML =
    '<option value="">Selecione um cliente</option>';

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
      client.fullName;

    select.appendChild(
      option
    );
  }
}

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

    identity_verification:
      "Verificação de identidade",

    calendar:
      "Abrindo calendário",

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
    status
  );
}

function renderApplications() {
  const container =
    $("#applicationsList");

  container.innerHTML = "";

  $("#applicationCount")
    .textContent =
    state.applications.length;

  if (
    !state.applications.length
  ) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">+</div>
        <strong>Nenhum processo ainda</strong>
        <span>Crie o primeiro processo acima.</span>
      </div>
    `;

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
      application.slot
        ?.date
        ? `${application.slot.date} · ${application.slot.time || ""}`
        : "Sem vaga";

    card.innerHTML = `
      <div class="application-main">
        <div class="application-avatar">
          ${clientName
            .slice(0, 1)
            .toUpperCase()}
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
        <span class="status-pill status-${application.status}">
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
                data-id="${application._id}"
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
                data-id="${application._id}"
              >
                Continuar
              </button>
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
                class="small-button danger-button cancel-button"
                data-id="${application._id}"
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
}

function escapeHtml(
  value
) {
  return String(value)
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

async function loadApplications() {
  const data =
    await api(
      "/api/applications"
    );

  state.applications =
    data.applications || [];

  renderApplications();
}

async function loadStats() {
  try {
    const data =
      await api(
        "/api/system/status"
      );

    const apps =
      data.applications;

    $("#statTotal")
      .textContent =
      apps.total;

    $("#statWaiting")
      .textContent =
      apps.waiting;

    $("#statProcessing")
      .textContent =
      apps.processing;

    $("#statCompleted")
      .textContent =
      apps.completed;

    $("#connectionDot")
      .classList.add(
        "online"
      );

    $("#connectionText")
      .textContent =
      "Online";
  } catch {
    $("#connectionDot")
      .classList.remove(
        "online"
      );

    $("#connectionText")
      .textContent =
      "Offline";
  }
}

async function refreshDashboard() {
  await Promise.all([
    loadClients(),
    loadApplications(),
    loadStats()
  ]);
}

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

$("#logoutButton")
  .addEventListener(
    "click",
    logout
  );

$("#refreshButton")
  .addEventListener(
    "click",
    async () => {
      try {
        await refreshDashboard();

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

$("#clientForm")
  .addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      try {
        await api(
          "/api/clients",
          {
            method: "POST",
            body: {
              fullName:
                $(
                  "#clientFullName"
                ).value,

              email:
                $(
                  "#clientEmail"
                ).value,

              phone:
                $(
                  "#clientPhone"
                ).value,

              dateOfBirth:
                $(
                  "#clientDateOfBirth"
                ).value,

              nationality:
                $(
                  "#clientNationality"
                ).value,

              gender:
                $(
                  "#clientGender"
                ).value,

              passportNumber:
                $(
                  "#clientPassportNumber"
                ).value,

              passportCountry:
                $(
                  "#clientPassportCountry"
                ).value,

              passportIssueDate:
                $(
                  "#clientPassportIssueDate"
                ).value,

              passportExpiryDate:
                $(
                  "#clientPassportExpiryDate"
                ).value
            }
          }
        );

        event.target.reset();

        await loadClients();

        showToast(
          "Cliente criado com sucesso.",
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

$("#applicationForm")
  .addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const clientId =
        $(
          "#applicationClient"
        ).value;

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
                    $(
                      "#preferredStart"
                    ).value ||
                    null,

                  end:
                    $(
                      "#preferredEnd"
                    ).value ||
                    null
                },

                preferredTime:
                  $(
                    "#preferredTime"
                  ).value ||
                  null
              }
            }
          );

        event.target.reset();

        await loadApplications();

        showToast(
          `Processo ${data.application._id} criado.`,
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

      try {
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

          showToast(
            "Preparação iniciada.",
            "success"
          );
        }

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

          showToast(
            "Processo colocado em monitoramento.",
            "success"
          );
        }

        if (
          button.classList.contains(
            "cancel-button"
          )
        ) {
          await api(
            `/api/applications/${id}/cancel`,
            {
              method: "POST"
            }
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

loadCurrentUser();
