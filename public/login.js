(() => {
  "use strict";


  /* =========================================================
     ROLES
  ========================================================== */

  const ADMIN_ROLES = [
    "owner",
    "admin",
    "operator",
    "viewer"
  ];

  const CLIENT_ROLE =
    "client";


  /* =========================================================
     LOGIN ELEMENTS
  ========================================================== */

  const loginView =
    document.getElementById(
      "loginView"
    );

  const form =
    document.getElementById(
      "loginForm"
    );

  const emailInput =
    document.getElementById(
      "loginEmail"
    );

  const passwordInput =
    document.getElementById(
      "loginPassword"
    );

  const errorBox =
    document.getElementById(
      "loginError"
    );

  const loginButton =
    document.getElementById(
      "loginButton"
    );

  const loginButtonText =
    document.getElementById(
      "loginButtonText"
    );

  const loginButtonArrow =
    document.getElementById(
      "loginButtonArrow"
    );


  /* =========================================================
     ACCESS REQUEST ELEMENTS
  ========================================================== */

  const accessRequestView =
    document.getElementById(
      "accessRequestView"
    );

  const accessRequestForm =
    document.getElementById(
      "accessRequestForm"
    );

  const accessRequestName =
    document.getElementById(
      "accessRequestName"
    );

  const accessRequestEmail =
    document.getElementById(
      "accessRequestEmail"
    );

  const accessRequestPhone =
    document.getElementById(
      "accessRequestPhone"
    );

  const accessRequestCompany =
    document.getElementById(
      "accessRequestCompany"
    );

  const accessRequestReason =
    document.getElementById(
      "accessRequestReason"
    );

  const accessRequestError =
    document.getElementById(
      "accessRequestError"
    );

  const accessRequestSuccess =
    document.getElementById(
      "accessRequestSuccess"
    );

  const accessRequestButton =
    document.getElementById(
      "accessRequestButton"
    );

  const accessRequestButtonText =
    document.getElementById(
      "accessRequestButtonText"
    );

  const accessRequestButtonArrow =
    document.getElementById(
      "accessRequestButtonArrow"
    );

  const showAccessRequestButton =
    document.getElementById(
      "showAccessRequestButton"
    );

  const backToLoginButton =
    document.getElementById(
      "backToLoginButton"
    );


  /* =========================================================
     STATE
  ========================================================== */

  let loginSubmitting = false;

  let accessRequestSubmitting = false;

  let accessRequestReturnTimer = null;


  /* =========================================================
     BASIC HELPERS
  ========================================================== */

  function showError(
    message
  ) {
    if (!errorBox) {
      return;
    }

    errorBox.textContent =
      message ||
      "Não foi possível iniciar a sessão.";

    errorBox.classList.remove(
      "hidden"
    );

    errorBox.setAttribute(
      "aria-hidden",
      "false"
    );
  }


  function clearError() {
    if (!errorBox) {
      return;
    }

    errorBox.textContent =
      "";

    errorBox.classList.add(
      "hidden"
    );

    errorBox.setAttribute(
      "aria-hidden",
      "true"
    );
  }


  function showAccessRequestError(
    message
  ) {
    if (!accessRequestError) {
      return;
    }

    accessRequestError.textContent =
      message ||
      "Não foi possível enviar o pedido de acesso.";

    accessRequestError.classList.remove(
      "hidden"
    );

    accessRequestError.setAttribute(
      "aria-hidden",
      "false"
    );
  }


  function clearAccessRequestError() {
    if (!accessRequestError) {
      return;
    }

    accessRequestError.textContent =
      "";

    accessRequestError.classList.add(
      "hidden"
    );

    accessRequestError.setAttribute(
      "aria-hidden",
      "true"
    );
  }


  function showAccessRequestSuccess(
    message
  ) {
    if (!accessRequestSuccess) {
      return;
    }

    accessRequestSuccess.textContent =
      message ||
      "Pedido de acesso enviado com sucesso.";

    accessRequestSuccess.classList.remove(
      "hidden"
    );

    accessRequestSuccess.setAttribute(
      "aria-hidden",
      "false"
    );
  }


  function clearAccessRequestSuccess() {
    if (!accessRequestSuccess) {
      return;
    }

    accessRequestSuccess.textContent =
      "";

    accessRequestSuccess.classList.add(
      "hidden"
    );

    accessRequestSuccess.setAttribute(
      "aria-hidden",
      "true"
    );
  }


  /* =========================================================
     INPUT VISUAL STATE
  ========================================================== */

  function updateFieldState(
    input
  ) {
    if (!input) {
      return;
    }

    const shell =
      input.closest(
        ".login-input-shell"
      );

    if (!shell) {
      return;
    }

    shell.classList.remove(
      "is-filled",
      "is-valid",
      "is-invalid"
    );

    if (
      input.value &&
      input.value.trim() !== ""
    ) {
      shell.classList.add(
        "is-filled"
      );
    }

    if (
      input.value &&
      input.checkValidity()
    ) {
      shell.classList.add(
        "is-valid"
      );
    }

    if (
      input.value &&
      !input.checkValidity()
    ) {
      shell.classList.add(
        "is-invalid"
      );
    }
  }


  function attachFieldState(
    input
  ) {
    if (!input) {
      return;
    }

    input.addEventListener(
      "input",
      () => {
        updateFieldState(
          input
        );
      }
    );

    input.addEventListener(
      "blur",
      () => {
        updateFieldState(
          input
        );
      }
    );

    input.addEventListener(
      "focus",
      () => {
        const shell =
          input.closest(
            ".login-input-shell"
          );

        if (shell) {
          shell.classList.add(
            "is-focused"
          );
        }
      }
    );

    input.addEventListener(
      "blur",
      () => {
        const shell =
          input.closest(
            ".login-input-shell"
          );

        if (shell) {
          shell.classList.remove(
            "is-focused"
          );
        }
      }
    );

    updateFieldState(
      input
    );
  }


  /* =========================================================
     PASSWORD VISIBILITY
  ========================================================== */

  function createPasswordToggle() {
    if (!passwordInput) {
      return;
    }

    const shell =
      passwordInput.closest(
        ".login-input-shell"
      );

    if (!shell) {
      return;
    }

    if (
      shell.querySelector(
        ".login-password-toggle"
      )
    ) {
      return;
    }

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "login-password-toggle";

    button.setAttribute(
      "aria-label",
      "Mostrar palavra-passe"
    );

    button.setAttribute(
      "aria-pressed",
      "false"
    );

    button.innerHTML = `
      <svg
        class="password-eye password-eye-open"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.8 12s3.1-5.2 9.2-5.2S21.2 12 21.2 12 18.1 17.2 12 17.2 2.8 12 2.8 12Z"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
        <circle
          cx="12"
          cy="12"
          r="2.5"
          stroke="currentColor"
          stroke-width="1.7"
        />
      </svg>

      <svg
        class="password-eye password-eye-closed"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 3l18 18"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          d="M10.6 6.9A10.7 10.7 0 0 1 12 6.8c6.1 0 9.2 5.2 9.2 5.2a17 17 0 0 1-3.1 3.3"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M6.7 9.1C4.2 10.5 2.8 12 2.8 12s3.1 5.2 9.2 5.2c1.2 0 2.3-.2 3.2-.6"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `;

    shell.appendChild(
      button
    );

    button.addEventListener(
      "click",
      () => {
        const showing =
          passwordInput.type ===
          "text";

        passwordInput.type =
          showing
            ? "password"
            : "text";

        button.setAttribute(
          "aria-pressed",
          showing
            ? "false"
            : "true"
        );

        button.setAttribute(
          "aria-label",
          showing
            ? "Mostrar palavra-passe"
            : "Ocultar palavra-passe"
        );

        shell.classList.toggle(
          "password-visible",
          !showing
        );

        passwordInput.focus();
      }
    );
  }


  /* =========================================================
     LOGIN LOADING
  ========================================================== */

  function setLoading(
    loading
  ) {
    if (!loginButton) {
      return;
    }

    loginSubmitting =
      loading;

    loginButton.disabled =
      loading;

    loginButton.setAttribute(
      "aria-busy",
      loading
        ? "true"
        : "false"
    );

    if (loginButtonText) {
      loginButtonText.textContent =
        loading
          ? "A iniciar sessão..."
          : "Entrar na plataforma";
    }

    if (loginButtonArrow) {
      loginButtonArrow.textContent =
        loading
          ? "…"
          : "→";
    }

    if (loading) {
      loginButton.classList.add(
        "is-loading"
      );
    } else {
      loginButton.classList.remove(
        "is-loading"
      );
    }
  }


  /* =========================================================
     ACCESS REQUEST LOADING
  ========================================================== */

  function setAccessRequestLoading(
    loading
  ) {
    if (!accessRequestButton) {
      return;
    }

    accessRequestSubmitting =
      loading;

    accessRequestButton.disabled =
      loading;

    accessRequestButton.setAttribute(
      "aria-busy",
      loading
        ? "true"
        : "false"
    );

    if (accessRequestButtonText) {
      accessRequestButtonText.textContent =
        loading
          ? "A enviar pedido..."
          : "Solicitar acesso";
    }

    if (accessRequestButtonArrow) {
      accessRequestButtonArrow.textContent =
        loading
          ? "…"
          : "→";
    }

    if (loading) {
      accessRequestButton.classList.add(
        "is-loading"
      );
    } else {
      accessRequestButton.classList.remove(
        "is-loading"
      );
    }
  }


  /* =========================================================
     ROLE REDIRECTION
  ========================================================== */

  function redirectByRole(
    role
  ) {
    if (
      ADMIN_ROLES.includes(
        role
      )
    ) {
      window.location.replace(
        "/admin"
      );

      return;
    }

    if (
      role ===
      CLIENT_ROLE
    ) {
      window.location.replace(
        "/"
      );

      return;
    }

    showError(
      "A sua conta não possui um perfil de acesso válido."
    );

    setLoading(
      false
    );
  }


  /* =========================================================
     CURRENT SESSION
  ========================================================== */

  async function getCurrentUser() {
    try {
      const response =
        await fetch(
          "/api/auth/me",
          {
            method:
              "GET",

            credentials:
              "include",

            headers: {
              Accept:
                "application/json"
            },

            cache:
              "no-store"
          }
        );

      if (
        !response.ok
      ) {
        return null;
      }

      const data =
        await response.json();

      if (
        !data ||
        data.success !== true ||
        !data.user
      ) {
        return null;
      }

      return data.user;

    } catch (
      error
    ) {
      return null;
    }
  }


  async function checkExistingSession() {
    const user =
      await getCurrentUser();

    if (
      !user ||
      !user.role
    ) {
      return;
    }

    redirectByRole(
      user.role
    );
  }


  /* =========================================================
     LOGIN
  ========================================================== */

  async function handleLogin(
    event
  ) {
    event.preventDefault();

    if (
      loginSubmitting
    ) {
      return;
    }

    clearError();

    const email =
      String(
        emailInput?.value ||
        ""
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        passwordInput?.value ||
        ""
      );

    if (!email) {
      showError(
        "Introduza o seu e-mail."
      );

      emailInput?.focus();

      return;
    }

    if (
      !isValidEmail(
        email
      )
    ) {
      showError(
        "Introduza um e-mail válido."
      );

      emailInput?.focus();

      return;
    }

    if (!password) {
      showError(
        "Introduza a sua palavra-passe."
      );

      passwordInput?.focus();

      return;
    }

    setLoading(
      true
    );

    try {
      const response =
        await fetch(
          "/api/auth/login",
          {
            method:
              "POST",

            credentials:
              "include",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body:
              JSON.stringify({
                email,
                password
              })
          }
        );

      let data =
        null;

      try {
        data =
          await response.json();

      } catch (
        error
      ) {
        data =
          null;
      }

      if (
        !response.ok ||
        !data ||
        data.success !== true
      ) {
        const message =
          data?.error ||
          data?.message ||
          "E-mail ou palavra-passe inválidos.";

        showError(
          message
        );

        setLoading(
          false
        );

        return;
      }

      const role =
        data.user?.role;

      if (!role) {
        showError(
          "A sessão foi iniciada, mas a conta não possui um perfil de acesso."
        );

        setLoading(
          false
        );

        return;
      }

      redirectByRole(
        role
      );

    } catch (
      error
    ) {
      console.error(
        "[LOGIN]",
        error
      );

      showError(
        "Não foi possível contactar a plataforma. Verifique a sua ligação e tente novamente."
      );

      setLoading(
        false
      );
    }
  }


  /* =========================================================
     SHOW LOGIN
  ========================================================== */

  function showLoginView() {
    if (
      accessRequestReturnTimer
    ) {
      window.clearTimeout(
        accessRequestReturnTimer
      );

      accessRequestReturnTimer =
        null;
    }

    clearError();

    clearAccessRequestError();
    clearAccessRequestSuccess();

    setAccessRequestLoading(
      false
    );

    if (accessRequestForm) {
      accessRequestForm.reset();
    }

    if (accessRequestView) {
      accessRequestView.classList.add(
        "hidden"
      );
    }

    if (loginView) {
      loginView.classList.remove(
        "hidden"
      );
    }

    updateFieldState(
      emailInput
    );

    updateFieldState(
      passwordInput
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    window.setTimeout(
      () => {
        emailInput?.focus();
      },
      120
    );
  }


  /* =========================================================
     SHOW ACCESS REQUEST
  ========================================================== */

  function showAccessRequestView() {
    clearError();

    clearAccessRequestError();
    clearAccessRequestSuccess();

    if (loginView) {
      loginView.classList.add(
        "hidden"
      );
    }

    if (accessRequestView) {
      accessRequestView.classList.remove(
        "hidden"
      );
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    window.setTimeout(
      () => {
        accessRequestName?.focus();
      },
      120
    );
  }


  /* =========================================================
     EMAIL VALIDATION
  ========================================================== */

  function isValidEmail(
    email
  ) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(
        email
      );
  }


  /* =========================================================
     ACCESS REQUEST
  ========================================================== */

  async function handleAccessRequest(
    event
  ) {
    event.preventDefault();

    if (
      accessRequestSubmitting
    ) {
      return;
    }

    clearAccessRequestError();
    clearAccessRequestSuccess();

    const name =
      String(
        accessRequestName?.value ||
        ""
      )
        .trim();

    const email =
      String(
        accessRequestEmail?.value ||
        ""
      )
        .trim()
        .toLowerCase();

    const phone =
      String(
        accessRequestPhone?.value ||
        ""
      )
        .trim();

    const company =
      String(
        accessRequestCompany?.value ||
        ""
      )
        .trim();

    const reason =
      String(
        accessRequestReason?.value ||
        ""
      )
        .trim();

    if (
      name.length <
      2
    ) {
      showAccessRequestError(
        "Introduza o seu nome completo."
      );

      accessRequestName?.focus();

      return;
    }

    if (
      !isValidEmail(
        email
      )
    ) {
      showAccessRequestError(
        "Introduza um e-mail válido."
      );

      accessRequestEmail?.focus();

      return;
    }

    if (
      phone.length >
      40
    ) {
      showAccessRequestError(
        "O telefone não pode ultrapassar 40 caracteres."
      );

      accessRequestPhone?.focus();

      return;
    }

    if (
      company.length >
      160
    ) {
      showAccessRequestError(
        "O nome da empresa ou organização é demasiado longo."
      );

      accessRequestCompany?.focus();

      return;
    }

    if (
      reason.length >
      1000
    ) {
      showAccessRequestError(
        "A descrição do pedido é demasiado longa."
      );

      accessRequestReason?.focus();

      return;
    }

    setAccessRequestLoading(
      true
    );

    try {
      const response =
        await fetch(
          "/api/access-requests",
          {
            method:
              "POST",

            credentials:
              "include",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body:
              JSON.stringify({
                name,
                email,
                phone,
                company,
                reason
              })
          }
        );

      let data =
        null;

      try {
        data =
          await response.json();

      } catch (
        error
      ) {
        data =
          null;
      }

      if (
        !response.ok ||
        !data ||
        data.success !== true
      ) {
        const message =
          data?.error ||
          data?.message ||
          "Não foi possível enviar o pedido de acesso.";

        showAccessRequestError(
          message
        );

        setAccessRequestLoading(
          false
        );

        return;
      }

      showAccessRequestSuccess(
        data.message ||
        "Pedido de acesso enviado com sucesso. Aguarde a análise da administração."
      );

      if (
        accessRequestForm
      ) {
        accessRequestForm.reset();
      }

      [
        accessRequestName,
        accessRequestEmail,
        accessRequestPhone,
        accessRequestCompany,
        accessRequestReason
      ].forEach(
        updateFieldState
      );

      setAccessRequestLoading(
        false
      );

      accessRequestReturnTimer =
        window.setTimeout(
          () => {
            showLoginView();
          },
          4500
        );

    } catch (
      error
    ) {
      console.error(
        "[ACCESS REQUEST]",
        error
      );

      showAccessRequestError(
        "Não foi possível contactar a plataforma. Verifique a sua ligação e tente novamente."
      );

      setAccessRequestLoading(
        false
      );
    }
  }


  /* =========================================================
     EVENT LISTENERS
  ========================================================== */

  if (form) {
    form.addEventListener(
      "submit",
      handleLogin
    );
  }


  if (accessRequestForm) {
    accessRequestForm.addEventListener(
      "submit",
      handleAccessRequest
    );
  }


  if (emailInput) {
    emailInput.addEventListener(
      "input",
      clearError
    );
  }


  if (passwordInput) {
    passwordInput.addEventListener(
      "input",
      clearError
    );
  }


  if (accessRequestName) {
    accessRequestName.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (accessRequestEmail) {
    accessRequestEmail.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (accessRequestPhone) {
    accessRequestPhone.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (accessRequestCompany) {
    accessRequestCompany.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (accessRequestReason) {
    accessRequestReason.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (showAccessRequestButton) {
    showAccessRequestButton.addEventListener(
      "click",
      showAccessRequestView
    );
  }


  if (backToLoginButton) {
    backToLoginButton.addEventListener(
      "click",
      showLoginView
    );
  }


  /* =========================================================
     KEYBOARD
  ========================================================== */

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
        "Escape"
      ) {
        if (
          accessRequestView &&
          !accessRequestView.classList.contains(
            "hidden"
          )
        ) {
          showLoginView();
        }
      }
    }
  );


  /* =========================================================
     FIELD INITIALIZATION
  ========================================================== */

  [
    emailInput,
    passwordInput,
    accessRequestName,
    accessRequestEmail,
    accessRequestPhone,
    accessRequestCompany,
    accessRequestReason
  ].forEach(
    attachFieldState
  );


  /* =========================================================
     PASSWORD TOGGLE
  ========================================================== */

  createPasswordToggle();


  /* =========================================================
     START
  ========================================================== */

  checkExistingSession();

})();
