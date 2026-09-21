(() => {
  "use strict";


  /*
   * =========================================================
   * ROLES
   * =========================================================
   */

  const ADMIN_ROLES = [
    "owner",
    "admin",
    "operator",
    "viewer"
  ];

  const CLIENT_ROLE =
    "client";


  /*
   * =========================================================
   * LOGIN ELEMENTS
   * =========================================================
   */

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


  /*
   * =========================================================
   * ACCESS REQUEST ELEMENTS
   * =========================================================
   */

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


  /*
   * =========================================================
   * BASIC HELPERS
   * =========================================================
   */

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
  }


  /*
   * =========================================================
   * LOGIN LOADING
   * =========================================================
   */

  function setLoading(
    loading
  ) {
    if (!loginButton) {
      return;
    }

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
  }


  /*
   * =========================================================
   * ACCESS REQUEST LOADING
   * =========================================================
   */

  function setAccessRequestLoading(
    loading
  ) {
    if (!accessRequestButton) {
      return;
    }

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
  }


  /*
   * =========================================================
   * ROLE REDIRECTION
   * =========================================================
   */

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


  /*
   * =========================================================
   * CURRENT SESSION
   * =========================================================
   */

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


  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function handleLogin(
    event
  ) {
    event.preventDefault();


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
      showError(
        "Não foi possível contactar a plataforma. Verifique a sua ligação e tente novamente."
      );

      setLoading(
        false
      );
    }
  }


  /*
   * =========================================================
   * SHOW LOGIN
   * =========================================================
   */

  function showLoginView() {
    clearAccessRequestError();
    clearAccessRequestSuccess();


    if (accessRequestForm) {
      accessRequestForm.reset();
    }


    if (accessRequestView) {
      accessRequestView.classList.add(
        "hidden"
      );
    }


    const loginView =
      document.getElementById(
        "loginView"
      );


    if (loginView) {
      loginView.classList.remove(
        "hidden"
      );
    }


    emailInput?.focus();
  }


  /*
   * =========================================================
   * SHOW ACCESS REQUEST
   * =========================================================
   */

  function showAccessRequestView() {
    clearError();
    clearAccessRequestError();
    clearAccessRequestSuccess();


    const loginView =
      document.getElementById(
        "loginView"
      );


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


    accessRequestName?.focus();
  }


  /*
   * =========================================================
   * EMAIL VALIDATION
   * =========================================================
   */

  function isValidEmail(
    email
  ) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(
        email
      );
  }


  /*
   * =========================================================
   * ACCESS REQUEST
   * =========================================================
   */

  async function handleAccessRequest(
    event
  ) {
    event.preventDefault();


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


      setAccessRequestLoading(
        false
      );


      /*
       * Depois de alguns segundos voltamos ao login.
       * O pedido permanece registado no servidor.
       */

      window.setTimeout(
        () => {
          showLoginView();
        },
        3500
      );

    } catch (
      error
    ) {
      showAccessRequestError(
        "Não foi possível contactar a plataforma. Verifique a sua ligação e tente novamente."
      );

      setAccessRequestLoading(
        false
      );
    }
  }


  /*
   * =========================================================
   * EVENT LISTENERS
   * =========================================================
   */

  if (
    form
  ) {
    form.addEventListener(
      "submit",
      handleLogin
    );
  }


  if (
    accessRequestForm
  ) {
    accessRequestForm.addEventListener(
      "submit",
      handleAccessRequest
    );
  }


  if (
    emailInput
  ) {
    emailInput.addEventListener(
      "input",
      clearError
    );
  }


  if (
    passwordInput
  ) {
    passwordInput.addEventListener(
      "input",
      clearError
    );
  }


  if (
    accessRequestName
  ) {
    accessRequestName.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (
    accessRequestEmail
  ) {
    accessRequestEmail.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (
    accessRequestPhone
  ) {
    accessRequestPhone.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (
    accessRequestCompany
  ) {
    accessRequestCompany.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (
    accessRequestReason
  ) {
    accessRequestReason.addEventListener(
      "input",
      clearAccessRequestError
    );
  }


  if (
    showAccessRequestButton
  ) {
    showAccessRequestButton.addEventListener(
      "click",
      showAccessRequestView
    );
  }


  if (
    backToLoginButton
  ) {
    backToLoginButton.addEventListener(
      "click",
      showLoginView
    );
  }


  /*
   * =========================================================
   * START
   * =========================================================
   */

  checkExistingSession();

})();
