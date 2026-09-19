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
 * preenchimento automático do formulário do perfil
 *    ↓
 * seleção automática do viajante
 *    ↓
 * reconhecimento facial
 *    ↓
 * candidatura
 *
 * IMPORTANTE:
 * - O utilizador pode fotografar ou anexar uma imagem.
 * - Não força a abertura da câmera.
 * - Não altera os IDs existentes.
 * - Intercepta o fluxo antigo de seleção manual.
 * - Email e telefone permanecem vazios porque
 *   não são fornecidos pelo passaporte.
 * ============================================================
 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    file: null,
    processing: false
  };


  /* =========================================================
     HELPERS
  ========================================================= */

  function getCookie(name) {
    const cookies = document.cookie.split(";");

    for (const cookie of cookies) {
      const [key, ...parts] =
        cookie.trim().split("=");

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


  function toast(message, type = "info") {
    const container = $("toastContainer");

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

    container.appendChild(element);

    setTimeout(() => {
      element.style.opacity = "0";
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


  function setFileStatus(text) {
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
          Analisar passaporte
          <span>→</span>
        `;
  }


  /* =========================================================
     CLIENT SELECTORS
  ========================================================= */

  function getClientId(client) {
    return (
      client?._id ||
      client?.id ||
      null
    );
  }


  function getClientName(client) {
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

    const passport =
      $("passportClientSelect");

    if (passport) {
      passport.value =
        clientId;
    }

    return true;
  }


  /* =========================================================
     AUTOMATIC PROFILE FILL
  ========================================================= */

  function normalizeDateForInput(
    value
  ) {
    if (!value) {
      return "";
    }

    const text =
      String(value)
        .trim();

    if (!text) {
      return "";
    }

    /*
     * Formato já correto para
     * <input type="date">
     */
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        text
      )
    ) {
      return text;
    }

    /*
     * ISO:
     * 2000-01-31T00:00:00.000Z
     */
    const iso =
      text.match(
        /^(\d{4}-\d{2}-\d{2})T/
      );

    if (iso) {
      return iso[1];
    }

    /*
     * DD/MM/YYYY
     * DD-MM-YYYY
     */
    const european =
      text.match(
        /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/
      );

    if (european) {
      return (
        european[3] +
        "-" +
        european[2] +
        "-" +
        european[1]
      );
    }

    /*
     * Último recurso:
     * tentar interpretar como Date.
     */
    const date =
      new Date(text);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date
        .toISOString()
        .slice(0, 10);
    }

    return "";
  }


  function normalizeGenderForProfile(
    value
  ) {
    const text =
      String(value || "")
        .trim()
        .toLowerCase();

    if (
      [
        "m",
        "male",
        "masculino"
      ].includes(text)
    ) {
      return "male";
    }

    if (
      [
        "f",
        "female",
        "feminino"
      ].includes(text)
    ) {
      return "female";
    }

    if (
      [
        "o",
        "other",
        "outro"
      ].includes(text)
    ) {
      return "other";
    }

    return "";
  }


  function setProfileField(
    id,
    value
  ) {
    const field =
      $(id);

    if (!field) {
      return;
    }

    field.value =
      value == null
        ? ""
        : String(value);

    /*
     * Disparamos os eventos para que
     * qualquer lógica existente do
     * app.js perceba que o campo foi
     * preenchido automaticamente.
     */
    field.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    field.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
  }


  function populateProfileForm(
    client
  ) {
    if (!client) {
      return false;
    }

    /*
     * =======================================================
     * DADOS DO PASSAPORTE
     * =======================================================
     *
     * Estes campos vêm do cliente criado pelo endpoint
     * /api/passports/import.
     */

    setProfileField(
      "clientFullName",
      client.fullName ||
      client.name ||
      ""
    );


    setProfileField(
      "clientDateOfBirth",
      normalizeDateForInput(
        client.dateOfBirth
      )
    );


    setProfileField(
      "clientNationality",
      client.nationality ||
      ""
    );


    setProfileField(
      "clientGender",
      normalizeGenderForProfile(
        client.gender
      )
    );


    setProfileField(
      "clientPassportNumber",
      client.passportNumber ||
      ""
    );


    setProfileField(
      "clientPassportIssueDate",
      normalizeDateForInput(
        client.passportIssueDate
      )
    );


    setProfileField(
      "clientPassportExpiryDate",
      normalizeDateForInput(
        client.passportExpiryDate
      )
    );


    setProfileField(
      "clientPassportCountry",
      client.passportCountry ||
      ""
    );


    /*
     * =======================================================
     * DADOS QUE O PASSAPORTE NÃO FORNECE
     * =======================================================
     *
     * O backend pode possuir um email interno para
     * identificação técnica do cliente, mas esse email
     * NÃO deve aparecer no formulário do perfil.
     *
     * O utilizador deverá preencher estes dois campos.
     */

    setProfileField(
      "clientEmail",
      ""
    );


    setProfileField(
      "clientPhone",
      ""
    );


    /*
     * Atualiza a prontidão do formulário, caso o app.js
     * esteja a observar estes campos.
     */
    document.dispatchEvent(
      new CustomEvent(
        "passport:profile:populated",
        {
          detail: {
            client
          }
        }
      )
    );


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
    if (state.processing) {
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
        headers["x-csrf-token"] =
          csrf;
      }

      const response =
        await fetch(
          "/api/passports/import",
          {
            method: "POST",
            credentials: "include",
            headers,
            body: formData
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
       * =====================================================
       * PASSAPORTE VALIDADO
       * =====================================================
       */

      renderSuccess(
        data
      );


      const client =
        data.client;


      /*
       * =====================================================
       * NOVO:
       * PREENCHER O FORMULÁRIO DO PERFIL
       * =====================================================
       *
       * Este é o ponto importante.
       *
       * O mesmo cliente devolvido pelo endpoint que antes
       * era usado apenas para selecionar o cliente passa
       * agora também a preencher o formulário completo.
       */

      populateProfileForm(
        client
      );


      /*
       * Atualiza o cartão visual do cliente.
       */

      renderCreatedClient(
        client
      );


      /*
       * Mantém o comportamento existente de seleção
       * automática do cliente.
       */

      selectCreatedClient(
        client
      );


      setFileStatus(
        `Passaporte validado — ${getClientName(client)}`
      );


      /*
       * =====================================================
       * CONTINUAR PARA IDENTIDADE
       * =====================================================
       */

      setTimeout(() => {
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

        const continueButton =
          $("identityContinueButton");

        if (
          continueButton &&
          typeof continueButton.click ===
            "function"
        ) {
          continueButton.click();
        } else {
          $("verificationSection")
            ?.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
        }
      }, 500);


      toast(
        "Passaporte validado. Perfil preenchido automaticamente.",
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

    /*
     * O backend atual trabalha com JPEG e PNG.
     */
    if (
      ![
        "image/jpeg",
        "image/png"
      ].includes(file.type)
    ) {
      toast(
        "Use uma fotografia JPEG ou PNG.",
        "error"
      );
      return;
    }

    if (
      file.size >
      2 * 1024 * 1024
    ) {
      toast(
        "A fotografia não pode ultrapassar 2 MB.",
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

    const image =
      $("passportPreviewImage");

    if (image) {
      image.removeAttribute(
        "src"
      );
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
     INPUT CONFIGURATION
  ========================================================= */

  function configureInput() {
    const input =
      $("passportFile");

    if (!input) {
      return;
    }

    /*
     * Não usamos capture="environment".
     *
     * Sem capture, o Android pode apresentar:
     * - Galeria
     * - Ficheiros
     * - Câmera
     *
     * dependendo do dispositivo/navegador.
     */

    input.setAttribute(
      "accept",
      "image/jpeg,image/png,.jpg,.jpeg,.png"
    );

    input.removeAttribute(
      "capture"
    );
  }


  /* =========================================================
     PASSPORT TEXTS
  ========================================================= */

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


  /* =========================================================
     MOVE PASSPORT TO FIRST POSITION
  ========================================================= */

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


  /* =========================================================
     HIDE MANUAL PROFILE
  ========================================================= */

  function hideManualProfile() {
    const section =
      $("clientSection");

    if (!section) {
      return;
    }

    section.classList.add(
      "passport-first-hidden"
    );
  }


  /* =========================================================
     UPDATE VISIBLE LOGIN / SUMMARY NUMBERS
  ========================================================= */

  function updateVisibleStepNumbers() {
    const features =
      document.querySelectorAll(
        ".login-feature"
      );

    if (!features.length) {
      return;
    }

    const items = [
      {
        number: "01",
        label: "Passaporte"
      },
      {
        number: "02",
        label: "Identidade"
      },
      {
        number: "03",
        label: "Candidatura"
      }
    ];

    features.forEach(
      (feature, index) => {
        const item =
          items[index];

        if (!item) {
          return;
        }

        const number =
          feature.querySelector(
            "strong"
          );

        const label =
          feature.querySelector(
            "span"
          );

        if (number) {
          number.textContent =
            item.number;
        }

        if (label) {
          label.textContent =
            item.label;
        }
      }
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
     * Capture phase:
     *
     * Impede o app.js antigo de tentar
     * exigir selectedClientId antes do
     * passaporte ser analisado.
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

    updateVisibleStepNumbers();

    bindEvents();

    setTimeout(() => {
      configureInput();
      configurePassportTexts();
      updateVisibleStepNumbers();
    }, 1000);
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
