/*
 * ============================================================
 * TRAVEL AUTOMATION
 * PASSPORT FIRST FLOW
 * ============================================================
 *
 * Fluxo:
 *
 * PASSAPORTE
 *    ↓
 * OCR + MRZ + validação
 *    ↓
 * criação automática do perfil
 *    ↓
 * seleção automática do viajante
 *    ↓
 * reconhecimento facial
 *    ↓
 * candidatura
 *
 * Não substitui o motor facial existente.
 * Não altera os IDs existentes.
 * Intercepta apenas o fluxo antigo de seleção manual.
 * ============================================================
 */

(() => {
  "use strict";

  const $ = (id) =>
    document.getElementById(id);

  const state = {
    file: null,
    processing: false
  };


  /* =========================================================
     HELPERS
  ========================================================= */

  function getCookie(name) {

    const cookies =
      document.cookie.split(";");

    for (const cookie of cookies) {

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


  function csrfToken() {

    return (
      getCookie("csrf_token") ||
      getCookie("csrfToken") ||
      null
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


  function toast(
    message,
    type = "info"
  ) {

    const container =
      $("toastContainer");

    if (!container) {
      console[type === "error" ? "error" : "log"](
        "[PASSPORT FIRST]",
        message
      );
      return;
    }

    const element =
      document.createElement("div");

    element.className =
      `toast ${type}`;

    element.textContent =
      message;

    container.appendChild(
      element
    );

    setTimeout(() => {

      element.style.opacity =
        "0";

      element.style.transform =
        "translateY(8px)";

      setTimeout(
        () => element.remove(),
        250
      );

    }, 4000);

  }


  function setStatus(
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


  function setFileStatus(
    text
  ) {

    const element =
      $("passportFileStatus");

    if (element) {
      element.textContent =
        text;
    }

  }


  function setButtonLoading(
    loading
  ) {

    const button =
      $("passportUploadButton");

    if (!button) {
      return;
    }

    button.disabled =
      loading;

    button.innerHTML =
      loading
        ? `
          <span class="button-spinner"></span>
          A analisar passaporte...
        `
        : `
          Continuar
          <span>→</span>
        `;

  }


  /* =========================================================
     CLIENT SELECTORS
  ========================================================= */

  function getClientId(
    client
  ) {

    return (
      client?._id ||
      client?.id ||
      null
    );

  }


  function getClientName(
    client
  ) {

    return (
      client?.fullName ||
      client?.name ||
      "Viajante"
    );

  }


  function addClientToSelector(
    selector,
    client
  ) {

    if (!selector || !client) {
      return;
    }

    const clientId =
      getClientId(client);

    if (!clientId) {
      return;
    }

    const existing =
      Array.from(
        selector.options
      ).find(
        option =>
          String(option.value) ===
          String(clientId)
      );

    if (!existing) {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        clientId;

      option.textContent =
        getClientName(client);

      selector.appendChild(
        option
      );

    }

    selector.value =
      clientId;

  }


  function selectCreatedClient(
    client
  ) {

    const clientId =
      getClientId(client);

    if (!clientId) {
      return false;
    }

    const selectors = [
      $("applicationClient"),
      $("identityClient"),
      $("passportClientSelect")
    ];

    selectors.forEach(
      selector => {
        addClientToSelector(
          selector,
          client
        );
      }
    );


    /*
     * O app.js já possui os listeners
     * de applicationClient e identityClient.
     *
     * Disparamos o evento para que o
     * estado interno do app seja atualizado.
     */

    const application =
      $("applicationClient");

    if (application) {

      application.value =
        clientId;

      application.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );

    }


    const identity =
      $("identityClient");

    if (identity) {

      identity.value =
        clientId;

      identity.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );

    }


    return true;

  }


  /* =========================================================
     CLIENT CARD
  ========================================================= */

  function renderCreatedClient(
    client
  ) {

    const card =
      $("selectedClientCard");

    const name =
      $("selectedClientName");

    const passport =
      $("selectedClientPassport");

    const avatar =
      $("selectedClientAvatar");


    if (card) {
      card.classList.remove(
        "empty"
      );
    }


    const fullName =
      getClientName(client);


    if (name) {
      name.textContent =
        fullName;
    }


    if (passport) {

      passport.textContent =
        client.passportNumber
          ? `Passaporte ${client.passportNumber}`
          : "Passaporte validado";

    }


    if (avatar) {

      avatar.textContent =
        fullName
          .split(/\s+/)
          .slice(0, 2)
          .map(
            part =>
              part
                .charAt(0)
                .toUpperCase()
          )
          .join("");

    }

  }


  /* =========================================================
     PASSPORT RESULT
  ========================================================= */

  function renderSuccess(
    response
  ) {

    const validation =
      response?.passportValidation ||
      response?.passport ||
      {};

    const result =
      $("passportResultState");

    const title =
      $("passportResultTitle");


    if (result) {

      result.className =
        "passport-result-state success";

      result.innerHTML = `
        <div class="result-state-icon">
          ✓
        </div>

        <div>

          <strong>
            Passaporte validado
          </strong>

          <span>
            O perfil foi criado automaticamente.
            A próxima etapa é a verificação de identidade.
          </span>

        </div>
      `;

    }


    if (title) {

      title.textContent =
        "Perfil criado automaticamente";

    }


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
        validation.passportType ||
        validation.type ||
        response?.passport?.passportType ||
        "—";

    }


    if (mrz) {

      mrz.textContent =
        validation.mrzValid === true
          ? "Válida"
          : "Validada";

    }


    if (match) {

      match.textContent =
        validation.clientMatch === true
          ? "Confirmada"
          : "Perfil criado";

    }


    if (expiry) {

      expiry.textContent =
        validation.expired === true
          ? "Expirado"
          : "Válido";

    }


    const extracted =
      $("passportExtractedData");

    if (extracted) {
      extracted.hidden =
        false;
    }


    setStatus(
      "PERFIL CRIADO",
      "success"
    );

  }


  function renderError(
    error
  ) {

    const data =
      error?.data || {};

    const validation =
      data?.passportValidation ||
      {};


    const result =
      $("passportResultState");


    if (result) {

      result.className =
        "passport-result-state error";

      result.innerHTML = `
        <div class="result-state-icon">
          !
        </div>

        <div>

          <strong>
            Não foi possível validar
          </strong>

          <span>
            Verifique a fotografia do passaporte
            e tente novamente.
          </span>

        </div>
      `;

    }


    const title =
      $("passportResultTitle");

    if (title) {

      title.textContent =
        "Correção necessária";

    }


    const issues =
      $("passportIssues");

    if (
      issues &&
      Array.isArray(
        validation.issues
      ) &&
      validation.issues.length
    ) {

      issues.hidden =
        false;

      issues.innerHTML = `
        <strong>
          O que precisa de atenção
        </strong>

        <ul>
          ${validation.issues
            .slice(0, 8)
            .map(
              issue =>
                `<li>${escapeHtml(issue)}</li>`
            )
            .join("")}
        </ul>
      `;

    }


    setStatus(
      "CORRIGIR",
      "error"
    );

  }


  /* =========================================================
     AUTOMATIC IMPORT
  ========================================================= */

  async function importPassport() {

    if (
      state.processing
    ) {
      return;
    }


    if (!state.file) {

      toast(
        "Fotografe ou selecione uma imagem do passaporte.",
        "error"
      );

      return;

    }


    state.processing =
      true;

    setButtonLoading(
      true
    );

    setStatus(
      "A ANALISAR",
      "blue"
    );

    setFileStatus(
      "A analisar o passaporte automaticamente..."
    );


    try {

      const formData =
        new FormData();

      formData.append(
        "passport",
        state.file
      );


      const headers = {};

      const csrf =
        csrfToken();

      if (csrf) {

        headers[
          "x-csrf-token"
        ] =
          csrf;

      }


      const response =
        await fetch(
          "/api/passports/import",
          {
            method:
              "POST",

            credentials:
              "include",

            headers,

            body:
              formData
          }
        );


      const contentType =
        response.headers.get(
          "content-type"
        ) || "";


      const data =
        contentType.includes(
          "application/json"
        )
          ? await response.json()
          : {
              message:
                await response.text()
            };


      if (!response.ok) {

        const error =
          new Error(
            data?.message ||
            data?.error ||
            "Não foi possível validar o passaporte."
          );

        error.status =
          response.status;

        error.data =
          data;

        throw error;

      }


      if (
        data?.success !== true ||
        !data?.client
      ) {

        throw new Error(
          "O servidor não devolveu o perfil criado."
        );

      }


      /*
       * 1. Mostra o resultado
       */
      renderSuccess(
        data
      );


      /*
       * 2. Guarda o cliente no frontend
       * através dos selectors existentes.
       */
      const client =
        data.client;


      renderCreatedClient(
        client
      );


      /*
       * 3. Seleciona automaticamente
       * o viajante recém-criado.
       */
      selectCreatedClient(
        client
      );


      /*
       * 4. Atualiza o texto do ficheiro.
       */
      setFileStatus(
        `Passaporte validado — ${getClientName(client)}`
      );


      /*
       * 5. Pequeno atraso para permitir
       * ao app.js atualizar o estado.
       */
      setTimeout(
        () => {

          const identity =
            $("identityClient");

          if (identity) {

            identity.value =
              getClientId(client);

            identity.dispatchEvent(
              new Event(
                "change",
                {
                  bubbles: true
                }
              )
            );

          }


          /*
           * O painel facial existente
           * é aberto pelo próprio módulo.
           *
           * Se existir o botão de continuação,
           * clicamos nele.
           */
          const continueButton =
            $("identityContinueButton");

          if (
            continueButton &&
            typeof continueButton.click ===
              "function"
          ) {

            continueButton.click();

          } else {

            /*
             * Caso o módulo facial ainda
             * não tenha criado o botão,
             * mostramos a etapa.
             */
            document
              .getElementById(
                "verificationSection"
              )
              ?.scrollIntoView({
                behavior:
                  "smooth",
                block:
                  "start"
              });

          }

        },
        500
      );


      toast(
        "Passaporte validado. Perfil criado automaticamente.",
        "success"
      );


    } catch (error) {

      console.error(
        "[PASSPORT FIRST]",
        error
      );

      renderError(
        error
      );

      toast(
        error.message ||
        "Não foi possível validar o passaporte.",
        "error"
      );

    } finally {

      state.processing =
        false;

      setButtonLoading(
        false
      );

    }

  }


  /* =========================================================
     FILE HANDLING
  ========================================================= */

  function acceptFile(
    file
  ) {

    if (!file) {
      return;
    }


    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp"
      ].includes(
        file.type
      )
    ) {

      toast(
        "Use uma fotografia JPEG, PNG ou WebP.",
        "error"
      );

      return;

    }


    if (
      file.size >
      6 * 1024 * 1024
    ) {

      toast(
        "A fotografia não pode ultrapassar 6 MB.",
        "error"
      );

      return;

    }


    state.file =
      file;


    const preview =
      $("passportPreview");

    const image =
      $("passportPreviewImage");


    if (
      preview &&
      image
    ) {

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


    setFileStatus(
      `${file.name} selecionado — pronto para análise.`
    );


    const button =
      $("passportUploadButton");

    if (button) {

      button.disabled =
        false;

      button.innerHTML = `
        Analisar passaporte
        <span>→</span>
      `;

    }


    setStatus(
      "DOCUMENTO PRONTO",
      "blue"
    );

  }


  function clearFile() {

    state.file =
      null;


    const input =
      $("passportFile");

    if (input) {
      input.value =
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

      button.innerHTML = `
        Analisar passaporte
        <span>→</span>
      `;

    }


    setFileStatus(
      "Fotografe ou selecione o passaporte."
    );


    setStatus(
      "AGUARDANDO",
      "blue"
    );

  }


  /* =========================================================
     UI
  ========================================================= */

  function configureInput() {

    const input =
      $("passportFile");

    if (!input) {
      return;
    }

    /*
     * Permite câmera no telemóvel.
     */
    input.setAttribute(
      "accept",
      "image/jpeg,image/png,image/webp"
    );

    input.setAttribute(
      "capture",
      "environment"
    );

  }


  function configurePassportTexts() {

    const section =
      $("documentsSection");

    if (!section) {
      return;
    }


    const heading =
      section.querySelector(
        "h2"
      );

    if (heading) {

      heading.textContent =
        "Comece pelo passaporte";

    }


    const description =
      section.querySelector(
        ".panel-heading p"
      );

    if (description) {

      description.textContent =
        "Fotografe ou anexe o passaporte. O sistema irá analisar o documento e criar automaticamente o perfil do viajante.";

    }


    const clientBar =
      section.querySelector(
        ".passport-client-bar"
      );

    if (clientBar) {

      clientBar.classList.add(
        "passport-first-mode"
      );

    }


    const select =
      $("passportClientSelect");

    if (select) {

      const field =
        select.closest(
          ".field"
        );

      if (field) {

        field.style.display =
          "none";

      }

    }

  }


  function movePassportSection() {

    const documents =
      $("documentsSection");

    const client =
      $("clientSection");

    const dashboard =
      document.querySelector(
        ".dashboard-main"
      );

    if (
      !documents ||
      !client ||
      !dashboard
    ) {
      return;
    }


    /*
     * O passaporte passa a ser
     * a primeira ação.
     */
    if (
      client.compareDocumentPosition(
        documents
      ) &
      Node.DOCUMENT_POSITION_FOLLOWING
    ) {

      dashboard.insertBefore(
        documents,
        client
      );

    }

  }


  function hideManualProfile() {

    const section =
      $("clientSection");

    if (!section) {
      return;
    }


    /*
     * Mantemos o formulário no DOM
     * para não quebrar IDs nem
     * código existente.
     *
     * Apenas deixamos de o apresentar
     * como primeiro passo.
     */
    section.classList.add(
      "passport-first-hidden"
    );

  }


  /* =========================================================
     EVENT BINDING
  ========================================================= */

  function bindEvents() {

    const input =
      $("passportFile");

    const dropzone =
      $("passportDropzone");

    const uploadButton =
      $("passportUploadButton");

    const clearButton =
      $("passportClearButton");


    /*
     * CAPTURE
     *
     * Impede que o handler antigo
     * do app.js tente exigir
     * selectedClientId.
     */
    input?.addEventListener(
      "change",
      event => {

        event.stopImmediatePropagation();

        const file =
          event.target.files?.[0];

        acceptFile(
          file
        );

      },
      true
    );


    uploadButton?.addEventListener(
      "click",
      event => {

        event.stopImmediatePropagation();

        event.preventDefault();

        importPassport();

      },
      true
    );


    clearButton?.addEventListener(
      "click",
      event => {

        event.stopImmediatePropagation();

        event.preventDefault();

        clearFile();

      },
      true
    );


    dropzone?.addEventListener(
      "dragover",
      event => {

        event.preventDefault();

        dropzone.classList.add(
          "dragover"
        );

      }
    );


    dropzone?.addEventListener(
      "dragleave",
      () => {

        dropzone.classList.remove(
          "dragover"
        );

      }
    );


    dropzone?.addEventListener(
      "drop",
      event => {

        event.preventDefault();

        event.stopImmediatePropagation();

        dropzone.classList.remove(
          "dragover"
        );

        const file =
          event.dataTransfer
            ?.files?.[0];

        acceptFile(
          file
        );

      },
      true
    );

  }


  /* =========================================================
     INITIALIZE
  ========================================================= */

  function init() {

    configureInput();

    configurePassportTexts();

    movePassportSection();

    hideManualProfile();

    bindEvents();

    setTimeout(
      () => {

        configureInput();

        configurePassportTexts();

      },
      1000
    );

  }


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
