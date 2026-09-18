(() => {
  "use strict";


  /* =========================================================
     STATE
  ========================================================= */

  const state = {

    user: null,

    clients: [],

    applications: [],

    selectedClientId: null,

    selectedClient: null,

    passportFile: null,

    passportValidation: null,

    facialReady: false,

    csrfToken: null,

    loading: false

  };


  /* =========================================================
     DOM
  ========================================================= */

  const $ = (id) =>
    document.getElementById(id);


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

    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat(
      "pt-PT",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }
    ).format(date);

  }


  function showToast(
    message,
    type = "info"
  ) {

    const container =
      $("toastContainer");

    if (!container) {
      return;
    }

    const toast =
      document.createElement("div");

    toast.className =
      `toast ${type}`;

    toast.textContent =
      message;

    container.appendChild(
      toast
    );

    setTimeout(() => {

      toast.style.opacity =
        "0";

      toast.style.transform =
        "translateY(8px)";

      setTimeout(() => {

        toast.remove();

      }, 200);

    }, 3500);

  }


  function setConnection(
    online,
    text
  ) {

    const element =
      $("connectionText");

    if (!element) {
      return;
    }

    element.textContent =
      text ||
      (
        online
          ? "Sistema operacional"
          : "Sistema indisponível"
      );

  }


  function getCookie(
    name
  ) {

    const cookies =
      document.cookie.split(";");

    for (
      const cookie of cookies
    ) {

      const [
        key,
        ...parts
      ] =
        cookie
          .trim()
          .split("=");

      if (key === name) {

        return decodeURIComponent(
          parts.join("=")
        );

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

  async function api(
    url,
    options = {}
  ) {

    const isFormData =
      options.body instanceof FormData;

    const config = {

      credentials:
        "include",

      ...options,

      headers: {

        ...(isFormData
          ? {}
          : {
              "Content-Type":
                "application/json"
            }),

        ...(options.headers || {})

      }

    };


    const csrf =
      getCsrfToken();


    if (
      csrf &&
      [
        "POST",
        "PUT",
        "PATCH",
        "DELETE"
      ].includes(
        String(
          config.method ||
          "GET"
        ).toUpperCase()
      )
    ) {

      config.headers[
        "x-csrf-token"
      ] = csrf;

    }


    const response =
      await fetch(
        url,
        config
      );


    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    let data;


    if (
      contentType.includes(
        "application/json"
      )
    ) {

      data =
        await response.json();

    } else {

      data =
        await response.text();

    }


    if (!response.ok) {

      const message =
        typeof data === "object"
          ? (
              data.message ||
              data.error ||
              "Erro na operação."
            )
          : (
              data ||
              "Erro na operação."
            );


      const error =
        new Error(message);


      error.status =
        response.status;

      error.data =
        data;


      throw error;

    }


    return data;

  }


  /* =========================================================
     AUTH
  ========================================================= */

  function showLogin() {

    $("loginView")
      ?.classList
      .remove("hidden");

    $("appView")
      ?.classList
      .add("hidden");

  }


  function showApp() {

    $("loginView")
      ?.classList
      .add("hidden");

    $("appView")
      ?.classList
      .remove("hidden");

  }


  async function loadCurrentUser() {
  try {
    const response = await api("/api/auth/me");

    state.user =
      response?.user ||
      response?.data ||
      response ||
      null;

    if (!state.user) {
      throw new Error(
        "O backend não devolveu a identidade da sessão."
      );
    }

    showApp();

    updateUserInterface();

    setConnection(
      true,
      "Sistema operacional"
    );

    await refreshDashboard();

  } catch (error) {
    console.error(
      "[AUTH] Falha ao carregar sessão:",
      error
    );

    setConnection(
      false,
      "Backend indisponível"
    );

    showToast(
      error.message ||
      "Não foi possível ligar à aplicação.",
      "error"
    );
  }
}
  function updateUserInterface() {

    const element =
      $("userName");

    if (!element) {
      return;
    }

    element.textContent =
      state.user?.name ||
      state.user?.email ||
      "Operations Console";

  }


  /* =========================================================
     CLIENTS
  ========================================================= */

  async function loadClients() {

    try {

      const response =
        await api(
          "/api/clients"
        );


      state.clients =
        Array.isArray(response)
          ? response
          : (
              response?.clients ||
              response?.data ||
              []
            );


      renderClientSelectors();

      updateClientCount();


      if (
        state.selectedClientId
      ) {

        const found =
          state.clients.find(
            client =>
              String(
                client._id ||
                client.id
              ) ===
              String(
                state.selectedClientId
              )
          );


        if (found) {

          state.selectedClient =
            found;

          updateSelectedClient();

          await loadPassportStatus(
            state.selectedClientId
          );

        }

      }


      updateReadiness();


    } catch (error) {

      console.error(
        "Erro ao carregar clientes:",
        error
      );

      showToast(
        "Não foi possível carregar os clientes.",
        "error"
      );

    }

  }


  function renderClientSelectors() {

    const passportSelect =
  $("passportClientSelect");

if (passportSelect) {

  const current =
    passportSelect.value;

  passportSelect.innerHTML = `
    <option value="">
      Selecionar viajante
    </option>

    ${state.clients
      .map(client => {

        const id =
          client._id ||
          client.id;

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

  if (current) {
    passportSelect.value =
      current;
  }

  if (state.selectedClientId) {
    passportSelect.value =
      state.selectedClientId;
  }
}
    const ids = [
      "applicationClient",
      "identityClient"
    ];


    ids.forEach(id => {

      const select =
        $(id);

      if (!select) {
        return;
      }


      const current =
        select.value;


      select.innerHTML = `
        <option value="">
          Selecionar cliente
        </option>

        ${state.clients
          .map(client => {

            const id =
              client._id ||
              client.id;

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


      if (current) {
        select.value =
          current;
      }

    });


    if (
      state.selectedClientId
    ) {

      [
        "applicationClient",
        "identityClient"
      ].forEach(id => {

        const select =
          $(id);

        if (select) {

          select.value =
            state.selectedClientId;

        }

      });

    }

  }


  function updateClientCount() {

    const element =
      $("clientCount");

    if (element) {

      element.textContent =
        state.clients.length;

    }

  }


  function getClientById(
    clientId
  ) {

    return state.clients.find(
      client =>
        String(
          client._id ||
          client.id
        ) ===
        String(clientId)
    );

  }


  /* =========================================================
     SELECT CLIENT
  ========================================================= */

  async function selectClient(
    clientId,
    source = "application"
  ) {

    if (!clientId) {

      state.selectedClientId =
        null;

      state.selectedClient =
        null;

      state.passportValidation =
        null;

      state.facialReady =
        false;

      updateSelectedClient();

      resetPassportInterface();

      updateIdentityGate();

      updateReadiness();

      return;

    }


    const client =
      getClientById(
        clientId
      );


    if (!client) {
      return;
    }


    state.selectedClientId =
      String(clientId);

    state.selectedClient =
      client;


    [
      "applicationClient",
      "identityClient"
    ].forEach(id => {

      const select =
        $(id);

      if (select) {

        select.value =
          clientId;

      }

    });


    updateSelectedClient();

    await loadPassportStatus(
      clientId
    );

    updateIdentityGate();

    updateReadiness();


    addActivity(
      "Cliente selecionado",
      `${client.fullName || "Cliente"} foi selecionado para verificação.`,
      "blue"
    );

  }


  function updateSelectedClient() {

    const card =
      $("selectedClientCard");

    const name =
      $("selectedClientName");

    const passport =
      $("selectedClientPassport");


    if (
      !state.selectedClient
    ) {

      card?.classList
        .add("empty");

      if (name) {
        name.textContent =
          "Nenhum cliente";
      }

      if (passport) {
        passport.textContent =
          "Selecione um cliente";
      }

      return;

    }


    card?.classList
      .remove("empty");


    const fullName =
      state.selectedClient.fullName ||
      state.selectedClient.name ||
      "Cliente";


    if (name) {
      name.textContent =
        fullName;
    }


    if (passport) {

      passport.textContent =
        state.selectedClient.passportNumber
          ? `Passaporte ${state.selectedClient.passportNumber}`
          : "Passaporte não definido";

    }


    const avatar =
      card?.querySelector(
        ".selected-client-avatar"
      );


    if (avatar) {

      avatar.textContent =
        fullName
          .split(/\s+/)
          .slice(0, 2)
          .map(
            part =>
              part.charAt(0)
                .toUpperCase()
          )
          .join("");

    }

  }


  /* =========================================================
     CLIENT FORM
  ========================================================= */

  async function handleClientSubmit(
    event
  ) {

    event.preventDefault();


    const form =
      event.currentTarget;


    const button =
      form.querySelector(
        'button[type="submit"]'
      );


    if (button) {
      button.disabled =
        true;
    }


    const payload = {

      fullName:
        $("clientFullName")
          ?.value
          .trim(),

      email:
        $("clientEmail")
          ?.value
          .trim(),

      phone:
        $("clientPhone")
          ?.value
          .trim(),

      dateOfBirth:
        $("clientDateOfBirth")
          ?.value ||
        null,

      nationality:
        $("clientNationality")
          ?.value
          .trim(),

      gender:
        $("clientGender")
          ?.value ||
        null,

      passportNumber:
        $("clientPassportNumber")
          ?.value
          .trim(),

      passportIssueDate:
        $("clientPassportIssueDate")
          ?.value ||
        null,

      passportExpiryDate:
        $("clientPassportExpiryDate")
          ?.value ||
        null,

      passportCountry:
        $("clientPassportCountry")
          ?.value
          .trim(),

      facialConsent:
        Boolean(
          $("clientFacialConsent")
            ?.checked
        )

    };


    try {

      const response =
        await api(
          "/api/clients",
          {
            method:
              "POST",

            body:
              JSON.stringify(
                payload
              )
          }
        );


      const client =
        response?.client ||
        response?.data ||
        response;


      if (
        client &&
        (client._id ||
          client.id)
      ) {

        state.clients.unshift(
          client
        );

      }


      form.reset();


      renderClientSelectors();

      updateClientCount();


      await selectClient(
        client._id ||
        client.id
      );


      showToast(
        "Perfil do cliente criado com sucesso.",
        "success"
      );


      addActivity(
        "Novo cliente",
        "Perfil criado e pronto para validação documental.",
        "blue"
      );


      document
        .getElementById(
          "passportSection"
        )
        ?.scrollIntoView({
          behavior:
            "smooth",
          block:
            "start"
        });


    } catch (error) {

      console.error(
        error
      );


      showToast(
        error.message ||
        "Não foi possível criar o cliente.",
        "error"
      );

    } finally {

      if (button) {
        button.disabled =
          false;
      }

    }

  }


  /* =========================================================
     PASSPORT
  ========================================================= */

  function setupPassportEvents() {

    const fileInput =
      $("passportFile");

    const dropzone =
      $("passportDropzone");

    const uploadButton =
      $("passportUploadButton");

    const clearButton =
      $("passportClearButton");

const chooseButton =
  $("passportChooseButton");

chooseButton?.addEventListener(
  "click",
  () => {
    fileInput?.click();
  }
);
    $("passportClientSelect")
  ?.addEventListener(
    "change",
    async event => {

      await selectClient(
        event.target.value,
        "passport"
      );

      const select =
        $("applicationClient");

      if (select) {
        select.value =
          event.target.value;
      }

      const identity =
        $("identityClient");

      if (identity) {
        identity.value =
          event.target.value;
      }

    }
  );
    fileInput?.addEventListener(
      "change",
      event => {

        const file =
          event.target.files?.[0];

        handlePassportFile(
          file
        );

      }
    );


    [
      "dragenter",
      "dragover"
    ].forEach(type => {

      dropzone?.addEventListener(
        type,
        event => {

          event.preventDefault();

          dropzone.classList
            .add("dragover");

        }
      );

    });


    [
      "dragleave",
      "drop"
    ].forEach(type => {

      dropzone?.addEventListener(
        type,
        event => {

          event.preventDefault();

          dropzone.classList
            .remove("dragover");

        }
      );

    });


    dropzone?.addEventListener(
      "drop",
      event => {

        const file =
          event.dataTransfer
            ?.files?.[0];

        handlePassportFile(
          file
        );

      }
    );


    uploadButton?.addEventListener(
      "click",
      uploadPassport
    );


    clearButton?.addEventListener(
      "click",
      clearPassport
    );

  }


  function handlePassportFile(
    file
  ) {

    if (!file) {
      return;
    }


    if (
      !state.selectedClientId
    ) {

      showToast(
        "Selecione primeiro o cliente.",
        "error"
      );

      return;

    }


    const allowed = [
      "image/jpeg",
      "image/png"
    ];


    if (
      !allowed.includes(
        file.type
      )
    ) {

      showToast(
        "O passaporte deve ser uma imagem JPEG ou PNG.",
        "error"
      );

      return;

    }


    if (
  file.size >
  2 * 1024 * 1024
) {

  showToast(
    "A imagem não pode ultrapassar 2 MB.",
    "error"
  );

  return;

}


    state.passportFile =
      file;


    const preview =
      $("passportPreview");

    const image =
      $("passportPreviewImage");

    const button =
      $("passportUploadButton");

    const status =
      $("passportFileStatus");


    if (preview && image) {

      const reader =
        new FileReader();


      reader.onload =
        event => {

          image.src =
            event.target.result;

          preview.hidden =
            false;

        };


      reader.readAsDataURL(
        file
      );

    }


    if (button) {
      button.disabled =
        false;
    }


    if (status) {

      status.textContent =
        `${file.name} selecionado — ${Math.round(file.size / 1024)} KB`;

    }


    setPassportPanelStatus(
      "DOCUMENTO",
      "blue"
    );

  }


  function clearPassport() {

    state.passportFile =
      null;

    state.passportValidation =
      null;


    const file =
      $("passportFile");

    if (file) {
      file.value =
        "";
    }


    const preview =
      $("passportPreview");

    if (preview) {
      preview.hidden =
        true;
    }


    const button =
      $("passportUploadButton");

    if (button) {
      button.disabled =
        true;
    }


    const status =
      $("passportFileStatus");

    if (status) {

      status.textContent =
        state.selectedClientId
          ? "Selecione uma imagem do passaporte."
          : "Selecione primeiro o cliente.";

    }


    resetPassportChecks();

    updateReadiness();

  }


  function resetPassportInterface() {

    state.passportFile =
      null;

    state.passportValidation =
      null;


    const file =
      $("passportFile");

    if (file) {
      file.value =
        "";
    }


    const preview =
      $("passportPreview");

    if (preview) {
      preview.hidden =
        true;
    }


    const button =
      $("passportUploadButton");

    if (button) {
      button.disabled =
        true;
    }


    const status =
      $("passportFileStatus");

    if (status) {

      status.textContent =
        state.selectedClientId
          ? "Selecione uma imagem do passaporte."
          : "Selecione primeiro o cliente.";

    }


    resetPassportChecks();

  }


  function resetPassportChecks() {

    [
      "passportCheckFile",
      "passportCheckMrz",
      "passportCheckMatch",
      "passportCheckExpiry",
      "passportCheckStorage"
    ].forEach(id => {

      const element =
        $(id);

      if (!element) {
        return;
      }

      element.classList
        .remove(
          "ready",
          "bad"
        );

      const icon =
        element.querySelector(
          "i"
        );

      if (icon) {
        icon.textContent =
          "○";
      }

    });


    const result =
      $("passportResultState");


    if (result) {

      result.className =
        "passport-result-state pending";


      result.innerHTML = `

        <div class="result-state-icon">
          ID
        </div>

        <div>

          <strong>
            Nenhuma validação executada
          </strong>

          <span>
            O resultado aparecerá aqui.
          </span>

        </div>

      `;

    }


    const title =
      $("passportResultTitle");

    if (title) {

      title.textContent =
        "Aguardando documento";

    }


    const issues =
      $("passportIssues");

    if (issues) {

      issues.hidden =
        true;

      issues.innerHTML =
        "";

    }


    const extracted =
      $("passportExtractedData");

    if (extracted) {

      extracted.hidden =
        true;

    }


    setPassportPanelStatus(
      "AGUARDANDO",
      "blue"
    );

  }


  function setDocumentCheck(
    id,
    value
  ) {

    const element =
      $(id);

    if (!element) {
      return;
    }


    element.classList
      .remove(
        "ready",
        "bad"
      );


    const icon =
      element.querySelector(
        "i"
      );


    if (value === true) {

      element.classList
        .add("ready");

      if (icon) {
        icon.textContent =
          "✓";
      }

    } else if (
      value === false
    ) {

      element.classList
        .add("bad");

      if (icon) {
        icon.textContent =
          "!";
      }

    } else {

      if (icon) {
        icon.textContent =
          "○";
      }

    }

  }


  function setPassportPanelStatus(
    text,
    type = "blue"
  ) {

    const element =
      $("passportPanelStatus");

    if (!element) {
      return;
    }


    element.textContent =
      text;


    element.className =
      `panel-status ${type}`;

  }


  async function uploadPassport() {

    if (
      !state.selectedClientId
    ) {

      showToast(
        "Selecione um cliente antes de validar o passaporte.",
        "error"
      );

      return;

    }


    if (
      !state.passportFile
    ) {

      showToast(
        "Selecione a imagem do passaporte.",
        "error"
      );

      return;

    }


    const button =
      $("passportUploadButton");


    if (button) {

      button.disabled =
        true;

      button.innerHTML =
        "A validar documento...";

    }


    setPassportPanelStatus(
      "A VALIDAR",
      "blue"
    );


    setDocumentCheck(
      "passportCheckFile",
      true
    );


    try {

      const formData =
        new FormData();


      formData.append(
        "passport",
        state.passportFile
      );


      const response =
        await api(
          `/api/passports/${encodeURIComponent(
            state.selectedClientId
          )}`,
          {
            method:
              "POST",

            body:
              formData
          }
        );


      processPassportResponse(
        response
      );


      await loadPassportStatus(
        state.selectedClientId
      );


      addActivity(
        "Passaporte validado",
        "A validação documental foi concluída.",
        "blue"
      );


      showToast(
        "Passaporte validado com sucesso.",
        "success"
      );


    } catch (error) {

      console.error(
        "Passport validation:",
        error
      );


      processPassportError(
        error
      );


      showToast(
        error.message ||
        "O passaporte precisa de correção.",
        "error"
      );

    } finally {

      if (button) {

        button.disabled =
          !state.passportFile;

        button.innerHTML =
          `
            Validar documento
            <span>→</span>
          `;

      }

    }

  }


  function processPassportResponse(
    response
  ) {

    const passport =
      response?.passport ||
      response?.passportValidation ||
      {};


    state.passportValidation =
      passport;


    const mrz =
      passport.mrzValid === true;


    const match =
      (
        passport.clientMatch === true ||
        passport.match === true
      );


    const expired =
      passport.expired === true;


    const stored =
      (
        passport.documentStored === true ||
        passport.ready === true
      );


    setDocumentCheck(
      "passportCheckFile",
      true
    );


    setDocumentCheck(
      "passportCheckMrz",
      mrz
    );


    setDocumentCheck(
      "passportCheckMatch",
      match
    );


    setDocumentCheck(
      "passportCheckExpiry",
      !expired
    );


    setDocumentCheck(
      "passportCheckStorage",
      stored
    );


    const passed =
      (
        response?.success === true &&
        (
          response?.status === "passed" ||
          passport.ready === true ||
          (
            mrz &&
            match &&
            !expired
          )
        )
      );


    renderPassportResult(
      passed,
      passport,
      response
    );


    updateIdentityGate();

    updateReadiness();

  }


  function processPassportError(
    error
  ) {

    const data =
      error?.data || {};


    const passport =
      data?.passportValidation ||
      {};


    state.passportValidation =
      passport;


    const mrz =
      passport.mrzValid === true
        ? true
        : (
            passport.mrzPresent === true
              ? false
              : null
          );


    const match =
      passport.clientMatch === true
        ? true
        : (
            passport.mrzPresent
              ? false
              : null
          );


    const expired =
      passport.expired === true
        ? true
        : (
            passport.mrzPresent
              ? false
              : null
          );


    setDocumentCheck(
      "passportCheckFile",
      true
    );


    setDocumentCheck(
      "passportCheckMrz",
      mrz
    );


    setDocumentCheck(
      "passportCheckMatch",
      match
    );


    setDocumentCheck(
      "passportCheckExpiry",
      expired === null
        ? null
        : !expired
    );


    setDocumentCheck(
      "passportCheckStorage",
      false
    );


    renderPassportResult(
      false,
      passport,
      data
    );


    updateIdentityGate();

    updateReadiness();

  }


  function renderPassportResult(
    passed,
    passport,
    response
  ) {

    const result =
      $("passportResultState");


    const title =
      $("passportResultTitle");


    if (!result) {
      return;
    }


    if (passed) {

      result.className =
        "passport-result-state success";


      result.innerHTML = `

        <div class="result-state-icon">
          ✓
        </div>

        <div>

          <strong>
            Passaporte aprovado
          </strong>

          <span>
            Documento conforme e utilizável
            na preparação da operação.
          </span>

        </div>

      `;


      if (title) {
        title.textContent =
          "Documento conforme";
      }


      setPassportPanelStatus(
        "APROVADO",
        ""
      );

    } else {

      result.className =
        "passport-result-state error";


      result.innerHTML = `

        <div class="result-state-icon">
          !
        </div>

        <div>

          <strong>
            Passaporte precisa de correção
          </strong>

          <span>
            O bot não deverá avançar com este documento.
          </span>

        </div>

      `;


      if (title) {
        title.textContent =
          "Correção necessária";
      }


      setPassportPanelStatus(
        "CORRIGIR",
        ""
      );

    }


    const issues =
      Array.isArray(
        passport.issues
      )
        ? passport.issues
        : [];


    const issuesBox =
      $("passportIssues");


    if (issuesBox) {

      if (issues.length) {

        issuesBox.hidden =
          false;

        issuesBox.innerHTML = `

          <strong>
            O que precisa de atenção
          </strong>

          <ul>
            ${issues
              .slice(0, 8)
              .map(
                issue =>
                  `<li>${escapeHtml(issue)}</li>`
              )
              .join("")}
          </ul>

        `;

      } else {

        issuesBox.hidden =
          true;

      }

    }


    const extracted =
      $("passportExtractedData");


    if (extracted) {

      extracted.hidden =
        false;

      const type =
        $("passportExtractedType");

      const mrz =
        $("passportExtractedMrz");

      const match =
        $("passportExtractedMatch");

      const expiry =
        $("passportExtractedExpiry");


      if (type) {

        type.textContent =
          passport.passportType ||
          passport.type ||
          "—";

      }


      if (mrz) {

        mrz.textContent =
          passport.mrzValid === true
            ? "Válida"
            : "Não validada";

      }


      if (match) {

        match.textContent =
          (
            passport.clientMatch === true ||
            passport.match === true
          )
            ? "Confirmada"
            : "Não confirmada";

      }


      if (expiry) {

        expiry.textContent =
          passport.expired === true
            ? "Expirado"
            : "Válido";

      }

    }

  }


  async function loadPassportStatus(
    clientId
  ) {

    if (!clientId) {
      return;
    }


    try {

      const response =
        await api(
          `/api/passports/${encodeURIComponent(
            clientId
          )}/status`
        );


      state.passportValidation =
        response?.passportValidation ||
        null;


      const validation =
        state.passportValidation;


      if (!validation) {

        resetPassportChecks();

        return;

      }


      const passed =
        validation.status ===
          "passed";


      setDocumentCheck(
        "passportCheckMrz",
        validation.mrzValid === true
      );


      setDocumentCheck(
        "passportCheckMatch",
        validation.clientMatch === true
      );


      setDocumentCheck(
        "passportCheckExpiry",
        validation.expired !== true
      );


      setDocumentCheck(
        "passportCheckStorage",
        passed
      );


      if (passed) {

        setPassportPanelStatus(
          "APROVADO",
          ""
        );

      } else {

        setPassportPanelStatus(
          "CORRIGIR",
          ""
        );

      }


      updateIdentityGate();

      updateReadiness();


    } catch (error) {

      /*
       * Um cliente novo pode ainda não possuir
       * validação de passaporte.
       */

      console.debug(
        "Passport status:",
        error.message
      );

    }

  }


  /* =========================================================
     IDENTITY / FACIAL
  ========================================================= */

  function setupIdentityEvents() {

    const identitySelect =
      $("identityClient");


    identitySelect?.addEventListener(
      "change",
      async event => {

        await selectClient(
          event.target.value,
          "identity"
        );


        updateFacialModuleSelection();

      }
    );


    const applicationSelect =
      $("applicationClient");


    applicationSelect?.addEventListener(
      "change",
      async event => {

        await selectClient(
          event.target.value,
          "application"
        );


        updateFacialModuleSelection();

      }
    );


    /*
     * O módulo facial existente cria
     * o painel dinamicamente.
     *
     * Depois da criação, movemos o painel
     * para dentro da secção Identity.
     */

    setTimeout(
      moveFacialPanel,
      250
    );

  }


  function moveFacialPanel() {

    const panel =
      $("facialPreflightPanel");


    const mount =
      $("facialMount");


    if (
      panel &&
      mount &&
      panel.parentElement !== mount
    ) {

      mount.appendChild(
        panel
      );

    }


    updateFacialModuleSelection();

  }


  function updateFacialModuleSelection() {

    const identitySelect =
      $("identityClient");


    const applicationSelect =
      $("applicationClient");


    if (
      state.selectedClientId
    ) {

      if (identitySelect) {
        identitySelect.value =
          state.selectedClientId;
      }

      if (applicationSelect) {
        applicationSelect.value =
          state.selectedClientId;
      }

    }


    /*
     * O módulo existente observa applicationClient.
     * Disparamos change para sincronizar a UI.
     */

    if (
      applicationSelect &&
      state.selectedClientId
    ) {

      applicationSelect.dispatchEvent(
        new Event(
          "change",
          {
            bubbles:
              true
          }
        )
      );

    }

  }


  function updateIdentityGate() {

    const validation =
      state.passportValidation;


    const passportPassed =
      validation?.status ===
      "passed";


    const selected =
      Boolean(
        state.selectedClient
      );


    const facePassed =
      state.facialReady === true;


    const message =
      $("identityGateMessage");


    const summary =
      $("identityClientSummary");


    if (summary) {

      const strong =
        summary.querySelector(
          "strong"
        );


      if (strong) {

        strong.textContent =
          state.selectedClient
            ? (
                state.selectedClient.fullName ||
                state.selectedClient.name ||
                "Cliente"
              )
            : "Nenhum cliente selecionado";

      }

    }


    if (!message) {
      return;
    }


    message.classList
      .remove(
        "ready",
        "bad"
      );


    if (!selected) {

      message.innerHTML = `
        <div>!</div>
        <span>
          Selecione um cliente para iniciar
          a verificação de identidade.
        </span>
      `;

      return;

    }


    if (!passportPassed) {

      message.innerHTML = `
        <div>!</div>
        <span>
          Valide primeiro o passaporte deste cliente.
          O reconhecimento facial não libera a operação
          sem documento conforme.
        </span>
      `;

      return;

    }


    if (facePassed) {

      message.classList
        .add("ready");

      message.innerHTML = `
        <div>✓</div>
        <span>
          Identidade facial aprovada para a preparação.
          O cliente está apto para o gate da VFS.
        </span>
      `;

      return;

    }


    message.innerHTML = `
      <div>!</div>
      <span>
        Passaporte aprovado. Execute agora a verificação
        facial para confirmar a identidade antes da VFS.
      </span>
    `;

  }


  /*
   * Verifica o estado exposto pelo módulo facial.
   *
   * O módulo existente envia o resultado para o backend.
   * Aqui monitorizamos a interface e atualizamos o gate.
   */

  function monitorFacialResult() {

  const result =
    $("identityResult");

  const applicationForm =
    $("applicationForm");

  if (!result) {
    return;
  }

  const passed =
    result.classList.contains(
      "passed"
    );

  const backendPassed =
    applicationForm?.dataset
      ?.facialPreflight ===
    "passed";

  state.facialReady =
    passed &&
    backendPassed;

  const status =
    $("facialPanelStatus");

  if (status) {

    if (state.facialReady) {

      status.textContent =
        "APROVADA";

      status.className =
        "panel-status";

    } else if (
      result.classList.contains(
        "failed"
      )
    ) {

      status.textContent =
        "CORRIGIR";

      status.className =
        "panel-status blue";

    } else {

      status.textContent =
        "AGUARDANDO";

      status.className =
        "panel-status blue";
    }

  }

  updateIdentityGate();
  updateReadiness();

}

  /* =========================================================
     APPLICATIONS
  ========================================================= */

  async function loadApplications() {

    try {

      const response =
        await api(
          "/api/applications"
        );


      state.applications =
        Array.isArray(response)
          ? response
          : (
              response?.applications ||
              response?.data ||
              []
            );


      renderApplications();

      updateApplicationStats();

      updateReadiness();

    } catch (error) {

      console.error(
        "Erro ao carregar aplicações:",
        error
      );


      state.applications =
        [];


      renderApplications();

      updateApplicationStats();

    }

  }


  function getStatusLabel(
    status
  ) {

    const labels = {

      created:
        "Criada",

      preparing:
        "Preparando",

      otp_required:
        "OTP necessário",

      otp_verified:
        "OTP verificado",

      identity_verification:
        "Verificação de identidade",

      calendar:
        "Calendário",

      waiting_for_slot:
        "No radar",

      slot_received:
        "Vaga encontrada",

      continuing:
        "A continuar",

      completed:
        "Concluída",

      error:
        "Erro",

      cancelled:
        "Cancelada"

    };


    return (
      labels[status] ||
      status ||
      "Desconhecido"
    );

  }


  function getApplicationClientName(
    application
  ) {

    const client =
      application.client ||
      application.clientData ||
      null;


    if (
      typeof client ===
      "string"
    ) {

      const found =
        getClientById(
          client
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

    const container =
      $("applicationsList");


    if (!container) {
      return;
    }


    if (
      !state.applications.length
    ) {

      container.innerHTML = `

        <div class="empty-state">

          <div class="empty-icon">
            ◎
          </div>

          <strong>
            Nenhuma aplicação em operação
          </strong>

          <p>
            Complete a preparação e crie
            uma aplicação.
          </p>

        </div>

      `;

      return;

    }


    container.innerHTML =
      state.applications
        .map(
          application => {

            const id =
              application._id ||
              application.id;


            const clientName =
              getApplicationClientName(
                application
              );


            const status =
              application.status ||
              "created";


            const start =
              application.preferredDates
                ?.start ||
              application.preferredStartDate;


            const end =
              application.preferredDates
                ?.end ||
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
                    ${escapeHtml(
                      String(id).slice(-12)
                    )}
                  </small>

                </div>


                <div>

                  <span class="application-status">
                    ${escapeHtml(
                      getStatusLabel(
                        status
                      )
                    )}
                  </span>


                  <div class="application-meta">

                    <strong>
                      ${
                        slotDate
                          ? `${escapeHtml(
                              formatDate(
                                slotDate
                              )
                            )} ${
                              slotTime
                                ? escapeHtml(
                                    slotTime
                                  )
                                : ""
                            }`
                          : (
                              start &&
                              end
                            )
                            ? `${escapeHtml(
                                formatDate(
                                  start
                                )
                              )} — ${escapeHtml(
                                formatDate(
                                  end
                                )
                              )}`
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
                    (
                      status === "created" ||
                      status === "error"
                    )
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
                    status ===
                    "otp_required"
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

          }
        )
        .join("");

  }


  function updateApplicationStats() {

    const total =
      state.applications.length;


    const prepared =
      state.applications.filter(
        application =>
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
          ].includes(
            application.status
          )
      ).length;


    const monitoring =
      state.applications.filter(
        application =>
          application.status ===
            "waiting_for_slot" ||
          application.bot2?.monitoring ===
            true
      ).length;


    /*
     * Existem dois elementos com applicationCount
     * no HTML legado. O novo HTML mantém o mesmo ID
     * para compatibilidade, por isso atualizamos todos.
     */

    document
      .querySelectorAll(
        "#applicationCount"
      )
      .forEach(
        element => {
          element.textContent =
            total;
        }
      );


    if ($("preparedCount")) {

      $("preparedCount")
        .textContent =
        prepared;

    }


    if ($("monitoringCount")) {

      $("monitoringCount")
        .textContent =
        monitoring;

    }


    updateBotCenter();

  }

  
  /* =========================================================
     READINESS
  ========================================================= */

  function updateReadiness() {

    const client =
      state.selectedClient;


    const clientScore =
      client
        ? 100
        : 0;


    const passportScore =
      state.passportValidation
        ?.status === "passed"
        ? 100
        : 0;


    const identityScore =
      state.facialReady
        ? 100
        : 0;


    const applicationScore =
      state.applications.length >
      0
        ? 100
        : 0;


    const gateScore =
      canCreateApplication()
        ? 100
        : 0;


    const score =
      Math.round(
        (
          clientScore +
          passportScore +
          identityScore +
          applicationScore +
          gateScore
        ) / 5
      );


    if ($("readinessScore")) {

      $("readinessScore")
        .textContent =
        score;

    }


    setText(
      "readinessClient",
      `${clientScore}%`
    );


    setText(
      "readinessPassport",
      `${passportScore}%`
    );


    setText(
      "readinessIdentity",
      `${identityScore}%`
    );


    setText(
      "readinessApplication",
      `${applicationScore}%`
    );


    setText(
      "readinessOperation",
      `${gateScore}%`
    );


    const values = [
      clientScore,
      passportScore,
      identityScore,
      applicationScore,
      gateScore
    ];


    document
      .querySelectorAll(
        ".readiness-list > div"
      )
      .forEach(
        (
          element,
          index
        ) => {

          element.classList.toggle(
            "ready",
            values[index] >= 100
          );

        }
      );


    const ring =
      document.querySelector(
        ".score-ring"
      );


    if (ring) {

      const degrees =
        score * 3.6;


      ring.style.background =
        `
          conic-gradient(
            var(--blue-600)
            ${degrees}deg,
            #e4eff7
            ${degrees}deg
          )
        `;

    }


    const label =
      $("readinessLabel");


    if (label) {

      if (
        gateScore === 100
      ) {

        label.textContent =
          "Cliente apto para VFS";

      } else if (
        identityScore === 100
      ) {

        label.textContent =
          "Identidade confirmada";

      } else if (
        passportScore === 100
      ) {

        label.textContent =
          "Passaporte confirmado";

      } else if (
        clientScore > 0
      ) {

        label.textContent =
          "Verificação pendente";

      } else {

        label.textContent =
          "Aguardando cliente";

      }

    }


    updateVfsGate();

  }


  function setText(
    id,
    text
  ) {

    const element =
      $(id);

    if (element) {
      element.textContent =
        text;
    }

  }


  /* =========================================================
     VFS GATE
  ========================================================= */

  function updateVfsGate() {

    const clientReady =
      Boolean(
        state.selectedClient
      );


    const passportReady =
      state.passportValidation
        ?.status ===
      "passed";


    const faceReady =
      state.facialReady ===
      true;


    const gateReady =
      (
        clientReady &&
        passportReady &&
        faceReady
      );


    setGateCheck(
      "gateClientCheck",
      clientReady
    );


    setGateCheck(
      "gatePassportCheck",
      passportReady
    );


    setGateCheck(
      "gateFaceCheck",
      faceReady
    );


    setGateCheck(
      "gateOperationCheck",
      gateReady
    );


    const icon =
      $("vfsGateIcon");


    const title =
      $("vfsGateTitle");


    const description =
      $("vfsGateDescription");


    const heroStatus =
      $("heroGateStatus");


    const heroMessage =
      $("heroGateMessage");


    const routeProgress =
      $("heroRouteProgress");


    if (gateReady) {

      icon?.classList.remove(
        "blocked"
      );

      icon?.classList.add(
        "ready"
      );


      if (icon) {
        icon.textContent =
          "✓";
      }


      if (title) {

        title.textContent =
          "CLIENTE APTO PARA VFS";

      }


      if (description) {

        description.textContent =
          "Perfil, passaporte e identidade facial estão conformes. O bot pode avançar para a próxima etapa.";

      }


      if (heroStatus) {

        heroStatus.innerHTML =
          `
            <i></i>
            VFS READY
          `;

      }


      if (heroMessage) {

        heroMessage.textContent =
          "Autorizado para avançar";

      }


      if (routeProgress) {

        routeProgress.style.width =
          "100%";

      }


    } else {

      icon?.classList.remove(
        "ready"
      );

      icon?.classList.add(
        "blocked"
      );


      if (icon) {
        icon.textContent =
          "!";
      }


      if (title) {

        title.textContent =
          "VERIFICAÇÕES PENDENTES";

      }


      if (description) {

        if (
          !clientReady
        ) {

          description.textContent =
            "Selecione um cliente para iniciar a preparação.";

        } else if (
          !passportReady
        ) {

          description.textContent =
            "O passaporte ainda não foi validado. O bot não deve avançar.";

        } else {

          description.textContent =
            "O passaporte está conforme, mas a identidade facial ainda precisa ser confirmada.";

        }

      }


      if (heroStatus) {

        heroStatus.innerHTML =
          `
            <i></i>
            AGUARDANDO
          `;

      }


      if (heroMessage) {

        heroMessage.textContent =
          "Verificações pendentes";

      }


      if (routeProgress) {

        let width =
          0;


        if (clientReady) {
          width =
            30;
        }


        if (passportReady) {
          width =
            65;
        }


        if (faceReady) {
          width =
            85;
        }


        routeProgress.style.width =
          `${width}%`;

      }

    }


    const applicationNotice =
      $("applicationSecurityNotice");


    const applicationButton =
      $("applicationSubmitButton");


    const applicationStatus =
      $("applicationPanelStatus");


    if (gateReady) {

      applicationNotice
        ?.classList
        .add("ready");


      if (applicationNotice) {

        applicationNotice.innerHTML = `

          <div class="security-notice-icon">
            ✓
          </div>

          <div>

            <strong>
              Aplicação liberada
            </strong>

            <span>
              O cliente passou pelas verificações
              necessárias para iniciar a operação.
            </span>

          </div>

        `;

      }


      if (applicationButton) {

  const applicationSubmitted =
    Boolean(
      document.body.dataset.applicationSubmitted === "true"
    );

  applicationButton.disabled =
    applicationSubmitted;

}


      if (applicationStatus) {

        applicationStatus.textContent =
          "READY";

        applicationStatus.className =
          "panel-status";

      }

    } else {

      applicationNotice
        ?.classList
        .remove("ready");


      if (applicationNotice) {

        let message =
          "Complete as verificações antes de iniciar a operação.";


        if (
          clientReady &&
          passportReady &&
          !faceReady
        ) {

          message =
            "O passaporte está conforme. Falta confirmar a identidade facial.";

        }


        applicationNotice.innerHTML = `

          <div class="security-notice-icon">
            !
          </div>

          <div>

            <strong>
              Aplicação bloqueada
            </strong>

            <span>
              ${escapeHtml(message)}
            </span>

          </div>

        `;

      }


      if (applicationButton) {

        applicationButton.disabled =
          true;

      }


      if (applicationStatus) {

        applicationStatus.textContent =
          "BLOCKED";

        applicationStatus.className =
          "panel-status blue";

      }

    }


    updatePipeline(
      clientReady,
      passportReady,
      faceReady,
      gateReady
    );

  }


  function setGateCheck(
    id,
    ready
  ) {

    const element =
      $(id);


    if (!element) {
      return;
    }


    element.classList
      .remove(
        "ready",
        "bad"
      );


    if (ready) {

      element.classList
        .add("ready");


      const icon =
        element.querySelector(
          "i"
        );


      if (icon) {
        icon.textContent =
          "✓";
      }

    } else {

      const icon =
        element.querySelector(
          "i"
        );


      if (icon) {
        icon.textContent =
          "○";
      }

    }

  }


  function updatePipeline(
    client,
    passport,
    face,
    gate
  ) {

    const bot1 =
      $("bot1State");


    const bot2 =
      $("bot2State");


    const supervisor =
      $("supervisorState");


    if (bot1) {

      bot1.textContent =
        client
          ? "READY"
          : "WAITING";

    }


    if (bot2) {

      if (face) {

        bot2.textContent =
          "VERIFIED";

      } else if (
        passport
      ) {

        bot2.textContent =
          "FACE CHECK";

      } else {

        bot2.textContent =
          "WAITING";

      }

    }


    if (supervisor) {

      supervisor.textContent =
        gate
          ? "AUTHORIZED"
          : "BLOCKED";

    }


    const pipelineVfs =
      $("pipelineVfs");


    if (pipelineVfs) {

      pipelineVfs.classList.toggle(
        "active",
        gate
      );

    }

  }


  /* =========================================================
     BOT CENTER
  ========================================================= */

  function updateBotCenter() {

    const active =
      state.applications.find(
        application =>
          [
            "preparing",
            "waiting_for_slot",
            "continuing"
          ].includes(
            application.status
          )
      );


    const bot1Running =
      state.applications.some(
        application =>
          application.bot1?.status ===
            "running" ||
          application.status ===
            "preparing"
      );


    const bot2Running =
      state.applications.some(
        application =>
          application.bot2?.monitoring ===
            true ||
          application.status ===
            "waiting_for_slot"
      );


    setBotVisual(
      "bot1",
      bot1Running,
      bot1Running
        ? "Processando preparação"
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
      Boolean(active),
      active
        ? "Coordenando processo"
        : (
            canCreateApplication()
              ? "Gate autorizado"
              : "Aguardando condições"
          )
    );

  }


  function setBotVisual(
    name,
    online,
    message
  ) {

    const indicator =
      $(`${name}Indicator`);


    const progress =
      $(`${name}Progress`);


    const action =
      $(`${name}LastAction`);


    indicator?.classList.toggle(
      "online",
      online
    );


    if (progress) {

      progress.style.width =
        online
          ? "68%"
          : "0%";

    }


    if (action) {

      action.textContent =
        message;

    }

  }


  /* =========================================================
     ACTIVITY
  ========================================================= */

  function addActivity(
    title,
    description,
    color = ""
  ) {

    const feed =
      $("activityFeed");


    if (!feed) {
      return;
    }


    const item =
      document.createElement(
        "div"
      );


    item.className =
      "activity-item";


    item.innerHTML = `

      <div
        class="activity-marker ${escapeHtml(
          color
        )}"
      ></div>

      <div>

        <strong>
          ${escapeHtml(title)}
        </strong>

        <span>
          ${escapeHtml(description)}
        </span>

      </div>

    `;


    feed.prepend(
      item
    );


    while (
      feed.children.length >
      6
    ) {

      feed.lastElementChild
        ?.remove();

    }

  }


  /* =========================================================
     DASHBOARD REFRESH
  ========================================================= */

  async function refreshDashboard() {

    if (state.loading) {
      return;
    }


    state.loading =
      true;


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

      console.error(
        error
      );


      setConnection(
        false,
        "Falha na atualização"
      );

    } finally {

      state.loading =
        false;

    }


    updateIdentityGate();

    updateReadiness();

    updateBotCenter();

  }


  /* =========================================================
     EVENTS
  ========================================================= */

  function setupEvents() {

    $("loginButton")
  ?.addEventListener(
    "click",
    loadCurrentUser
  );


    $("refreshButton")
      ?.addEventListener(
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

              button.style.transform =
                "";

            }

          }, 400);

        }
      );


    const clientForm = $("clientForm");

if (
  clientForm &&
  !clientForm.dataset.eventsBound
) {
  clientForm.addEventListener(
    "submit",
    handleClientSubmit
  );

  clientForm.dataset.eventsBound = "true";
}

    setupPassportEvents();

    setupIdentityEvents();


    /*
     * Campos de passaporte declarados
     * também atualizam a prontidão.
     */

    [
      "clientPassportNumber",
      "clientPassportIssueDate",
      "clientPassportExpiryDate",
      "clientPassportCountry"
    ].forEach(id => {

      $(id)?.addEventListener(
        "input",
        updateReadiness
      );

      $(id)?.addEventListener(
        "change",
        updateReadiness
      );

    });


    /*
     * Verificação contínua do resultado
     * produzido pelo módulo facial.
     */

  setInterval(
  monitorFacialResult,
  500
);

    /*
     * Navegação suave.
     */

    document
      .querySelectorAll(
        'a[href^="#"]'
      )
      .forEach(link => {

        link.addEventListener(
          "click",
          event => {

            const href =
              link.getAttribute(
                "href"
              );


            const target =
              document.querySelector(
                href
              );


            if (!target) {
              return;
            }


            event.preventDefault();


            target.scrollIntoView({
              behavior:
                "smooth",
              block:
                "start"
            });

          }
        );

      });

  }


  /* =========================================================
     INIT
  ========================================================= */

  let initialized = false;

async function init() {
  if (initialized) {
    return;
  }

  initialized = true;

  try {
    setupEvents();
    resetPassportInterface();
    updateIdentityGate();
    updateReadiness();

    await loadCurrentUser();
  } catch (error) {
    console.error(
      "[APP] Erro durante a inicialização:",
      error
    );

    setConnection(
      false,
      "Erro ao iniciar a aplicação"
    );

    showToast(
      error?.message ||
      "Não foi possível iniciar a aplicação.",
      "error"
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );
} else {
  init();
}

window.addEventListener(
  "load",
  () => {
    if (!initialized) {
      init();
    }
  },
  { once: true }
);
  /* =========================================================
     TRAVEL WORKFLOW
     Fluxo:
     Perfil → Viagem → Documentos → Identidade
     → Candidatura → OTP → VFS → Radar → Vaga
  ========================================================= */

  const TRAVEL_WORKFLOW_KEY =
    "travelAutomationPreferences";

  const travelWorkflow = {
    currentStage: "client",

    stages: [
      {
        id: "client",
        label: "Perfil",
        description: "Dados do viajante"
      },
      {
        id: "travel",
        label: "Viagem",
        description: "Destino e preferências"
      },
      {
        id: "passport",
        label: "Documentos",
        description: "Passaporte e documentos"
      },
      {
        id: "identity",
        label: "Identidade",
        description: "Verificação de identidade"
      },
      {
        id: "application",
        label: "Candidatura",
        description: "Preparação da candidatura"
      },
      {
        id: "otp",
        label: "OTP",
        description: "Confirmação"
      },
      {
        id: "vfs",
        label: "VFS",
        description: "Preparação do atendimento"
      },
      {
        id: "radar",
        label: "Radar",
        description: "Monitorização de vagas"
      },
      {
        id: "slot",
        label: "Vaga",
        description: "Agendamento encontrado"
      }
    ]
  };

  function getDefaultTravelPreferences() {
    return {
      origin: "Angola",
      destination: "Portugal",
      center: "",
      visaType: "",
      travelDate: "",
      appointmentDeadline: "",
      timePreference: "any",
      slotFlexibility: "flexible"
    };
  }

  function getTravelPreferences() {
    try {
      const saved =
        localStorage.getItem(
          TRAVEL_WORKFLOW_KEY
        );

      if (!saved) {
        return getDefaultTravelPreferences();
      }

      const parsed =
        JSON.parse(saved);

      return {
        ...getDefaultTravelPreferences(),
        ...(parsed || {}),
        origin: "Angola",
        destination: "Portugal"
      };
    } catch (error) {
      console.warn(
        "Não foi possível carregar as preferências de viagem.",
        error
      );

      return getDefaultTravelPreferences();
    }
  }

  function saveTravelPreferences(preferences) {
    const normalized = {
      ...getDefaultTravelPreferences(),
      ...(preferences || {}),
      origin: "Angola",
      destination: "Portugal"
    };

    if (
      !["Schengen", "Nacional"].includes(
        normalized.visaType
      )
    ) {
      throw new Error(
        "Selecione Schengen ou Nacional."
      );
    }

    if (!normalized.center) {
      throw new Error(
        "Selecione o centro VFS."
      );
    }

    if (!normalized.travelDate) {
      throw new Error(
        "Informe a data pretendida da viagem."
      );
    }

    localStorage.setItem(
      TRAVEL_WORKFLOW_KEY,
      JSON.stringify(normalized)
    );

    travelWorkflow.currentStage =
      "passport";

    document.dispatchEvent(
      new CustomEvent(
        "travel:preferences:changed",
        {
          detail: normalized
        }
      )
    );

    updateTravelWorkflowUI();

    addActivity?.(
      "Preferências de viagem",
      `Viagem para Portugal configurada com visto ${normalized.visaType}.`,
      "blue"
    );

    return normalized;
  }

  function clearTravelPreferences() {
    localStorage.removeItem(
      TRAVEL_WORKFLOW_KEY
    );

    travelWorkflow.currentStage =
      "travel";

    updateTravelWorkflowUI();
  }

  function setTravelStage(stage) {
    const valid =
      travelWorkflow.stages.some(
        item => item.id === stage
      );

    if (!valid) {
      return false;
    }

    travelWorkflow.currentStage =
      stage;

    document.dispatchEvent(
      new CustomEvent(
        "travel:stage:changed",
        {
          detail: {
            stage
          }
        }
      )
    );

    updateTravelWorkflowUI();

    return true;
  }

  function getTravelStage() {
    return travelWorkflow.currentStage;
  }

  function updateTravelWorkflowUI() {
    const preferences =
      getTravelPreferences();

    const visaElement =
      $("visaType");

    if (
      visaElement &&
      preferences.visaType
    ) {
      visaElement.value =
        preferences.visaType;
    }

    const destination =
      $("travelDestination");

    if (destination) {
      destination.value =
        "Portugal";
    }

    const center =
      $("travelCenter");

    if (
      center &&
      preferences.center
    ) {
      center.value =
        preferences.center;
    }

    const travelDate =
      $("travelDate");

    if (
      travelDate &&
      preferences.travelDate
    ) {
      travelDate.value =
        preferences.travelDate;
    }

    const deadline =
      $("appointmentDeadline");

    if (
      deadline &&
      preferences.appointmentDeadline
    ) {
      deadline.value =
        preferences.appointmentDeadline;
    }

    const timePreference =
      $("timePreference");

    if (
      timePreference &&
      preferences.timePreference
    ) {
      timePreference.value =
        preferences.timePreference;
    }

    const flexibility =
      $("slotFlexibility");

    if (
      flexibility &&
      preferences.slotFlexibility
    ) {
      flexibility.value =
        preferences.slotFlexibility;
    }

    document
      .querySelectorAll(
        "[data-travel-stage]"
      )
      .forEach(element => {
        const stage =
          element.dataset.travelStage;

        element.classList.toggle(
          "active",
          stage ===
            travelWorkflow.currentStage
        );

        element.classList.toggle(
          "completed",
          isTravelStageCompleted(stage)
        );
      });
  }

  function isTravelStageCompleted(stage) {
    const preferences =
      getTravelPreferences();

    switch (stage) {
      case "client":
        return Boolean(
          state.selectedClient
        );

      case "travel":
        return Boolean(
          preferences.visaType &&
          preferences.center &&
          preferences.travelDate
        );

      case "passport":
        return Boolean(
          state.passportValidation
        );

      case "identity":
        return Boolean(
          state.facialReady
        );

      default:
        return false;
    }
  }

  function collectTravelPreferencesFromDOM() {
    return {
      origin: "Angola",
      destination:
        $("travelDestination")
          ?.value ||
        "Portugal",

      center:
        $("travelCenter")
          ?.value ||
        "",

      visaType:
        $("visaType")
          ?.value ||
        "",

      travelDate:
        $("travelDate")
          ?.value ||
        "",

      appointmentDeadline:
        $("appointmentDeadline")
          ?.value ||
        "",

      timePreference:
        $("timePreference")
          ?.value ||
        "any",

      slotFlexibility:
        $("slotFlexibility")
          ?.value ||
        "flexible"
    };
  }

  function handleTravelPreferencesSubmit(
    event
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const submitButton =
      form?.querySelector(
        'button[type="submit"]'
      );

    if (submitButton) {
      submitButton.disabled =
        true;
    }

    try {
      const preferences =
        collectTravelPreferencesFromDOM();

      saveTravelPreferences(
        preferences
      );

      showToast(
        "Preferências de viagem guardadas. O próximo passo é preparar os documentos.",
        "success"
      );

      setTravelStage(
        "passport"
      );
    } catch (error) {
      console.error(error);

      showToast(
        error.message ||
          "Não foi possível guardar as preferências.",
        "error"
      );
    } finally {
      if (submitButton) {
        submitButton.disabled =
          false;
      }
    }
  }

  function bindTravelWorkflow() {
    const travelForm =
      $("travelForm");

    if (travelForm) {
      travelForm.addEventListener(
        "submit",
        handleTravelPreferencesSubmit
      );
    }

    document.addEventListener(
      "travel:preferences:changed",
      event => {
        const preferences =
          event.detail || {};

        console.info(
          "Preferências de viagem atualizadas:",
          preferences
        );

        updateTravelWorkflowUI();
      }
    );

    document.addEventListener(
      "travel:stage:changed",
      () => {
        updateTravelWorkflowUI();
      }
    );

    updateTravelWorkflowUI();
  }

  /*
   * API pública para os próximos módulos:
   * radar, VFS, OTP e agendamento.
   */
  window.TravelWorkflow = {
    getTravelPreferences,
    saveTravelPreferences,
    clearTravelPreferences,
    setStage: setTravelStage,
    getStage: getTravelStage,
    getStages: () =>
      travelWorkflow.stages.map(
        stage => ({ ...stage })
      )
  };

  /*
   * Não falha caso o HTML ainda não tenha
   * o formulário da viagem.
   */
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      bindTravelWorkflow,
      { once: true }
    );
  } else {
    bindTravelWorkflow();
  }
})();
