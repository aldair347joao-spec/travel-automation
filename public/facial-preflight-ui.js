/*
 * ============================================================
 * TRAVEL AUTOMATION
 * RECONHECIMENTO FACIAL — INTERFACE OPERACIONAL
 * ============================================================
 *
 * Interface visual dedicada à preparação facial.
 *
 * PRINCÍPIO:
 *
 * O motor facial conhece a sequência de movimentos.
 * A interface NÃO mostra essa sequência ao utilizador.
 *
 * A tela apenas:
 *
 * - apresenta o viajante;
 * - apresenta a câmera;
 * - apresenta o enquadramento facial;
 * - apresenta a orientação atual;
 * - apresenta o estado real da captura;
 * - conduz o utilizador para o próximo movimento.
 *
 * NÃO:
 *
 * - lista as 10 posições;
 * - mostra bolinhas das posições;
 * - repete a sequência biométrica;
 * - inicia câmera automaticamente;
 * - simula reconhecimento;
 * - grava vídeo;
 * - envia vídeo.
 *
 * O motor TravelFacialPreflight continua responsável por:
 *
 * - câmera;
 * - detecção facial;
 * - análise;
 * - movimentos;
 * - progresso;
 * - áudio;
 * - callbacks;
 * - resultado;
 * - backend.
 *
 * ============================================================
 */

(() => {
  "use strict";


  const $ = (id) =>
    document.getElementById(id);


  /*
   * ==========================================================
   * SEQUÊNCIA INTERNA
   * ==========================================================
   *
   * Esta informação continua necessária para interpretar
   * os callbacks do motor.
   *
   * NÃO é apresentada como lista na interface.
   */

  const POSITIONS = [
    {
      id: "frontal",
      number: "01",
      short: "FRONTAL",
      title: "Olhe para a frente",
      instruction:
        "Mantenha o rosto de frente para a câmera."
    },

    {
      id: "left",
      number: "02",
      short: "ESQUERDA",
      title: "Vire para a esquerda",
      instruction:
        "Vire lentamente a cabeça para a esquerda."
    },

    {
      id: "right",
      number: "03",
      short: "DIREITA",
      title: "Vire para a direita",
      instruction:
        "Vire lentamente a cabeça para a direita."
    },

    {
      id: "up",
      number: "04",
      short: "CIMA",
      title: "Olhe para cima",
      instruction:
        "Levante ligeiramente o olhar e a cabeça."
    },

    {
      id: "down",
      number: "05",
      short: "BAIXO",
      title: "Olhe para baixo",
      instruction:
        "Baixe ligeiramente o olhar e a cabeça."
    },

    {
      id: "left_up",
      number: "06",
      short: "ESQ. + CIMA",
      title: "Esquerda e cima",
      instruction:
        "Vire ligeiramente para a esquerda e para cima."
    },

    {
      id: "right_up",
      number: "07",
      short: "DIR. + CIMA",
      title: "Direita e cima",
      instruction:
        "Vire ligeiramente para a direita e para cima."
    },

    {
      id: "left_down",
      number: "08",
      short: "ESQ. + BAIXO",
      title: "Esquerda e baixo",
      instruction:
        "Vire ligeiramente para a esquerda e para baixo."
    },

    {
      id: "right_down",
      number: "09",
      short: "DIR. + BAIXO",
      title: "Direita e baixo",
      instruction:
        "Vire ligeiramente para a direita e para baixo."
    },

    {
      id: "smile",
      number: "10",
      short: "SORRISO",
      title: "Sorria naturalmente",
      instruction:
        "Olhe para a câmera e faça um sorriso natural."
    }
  ];


  let selectedClient = null;

  let running = false;

  let saving = false;

  let completed = false;

  let overlay = null;


  /*
   * Estado real recebido do motor.
   *
   * Mantemos isto internamente para garantir que a
   * conclusão não depende apenas de um contador visual.
   */

  const completedPositions = new Set();

  let activePositionIndex = 0;


  /*
   * ==========================================================
   * UTILITÁRIOS
   * ==========================================================
   */

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  function getClientFromSelection() {
    const selectors = [
      "applicationClient",
      "identityClient",
      "passportClientSelect"
    ];

    for (const id of selectors) {
      const select = $(id);

      if (!select?.value) {
        continue;
      }

      const option =
        select.options?.[select.selectedIndex];

      return {
        id: select.value,
        name:
          option?.textContent?.trim() ||
          "Cliente"
      };
    }

    return null;
  }


  function normalizeClient(client) {
    if (!client) {
      return null;
    }

    const id =
      client.id ||
      client._id ||
      client.clientId;

    if (!id) {
      return null;
    }

    return {
      id: String(id),

      name:
        client.fullName ||
        client.name ||
        client.displayName ||
        "Cliente"
    };
  }


  /*
   * ==========================================================
   * OVERLAY
   * ==========================================================
   */

  function createOverlay() {
    if ($("identityCenter")) {
      overlay =
        $("identityCenter");

      return overlay;
    }


    overlay =
      document.createElement("section");


    overlay.id =
      "identityCenter";


    overlay.className =
      "identity-center hidden";


    overlay.innerHTML = `
      <div class="identity-background">
        <div class="identity-grid"></div>
        <div class="identity-glow identity-glow-one"></div>
        <div class="identity-glow identity-glow-two"></div>
      </div>


      <header class="identity-topbar">

        <div class="identity-brand">

          <div class="identity-brand-mark">
            TA
          </div>

          <div>
            <strong>
              TRAVEL AUTOMATION
            </strong>

            <span>
              RECONHECIMENTO FACIAL
            </span>
          </div>

        </div>


        <div class="identity-operation">

          <span class="identity-live-dot"></span>

          <span>
            PREPARAÇÃO DE IDENTIDADE
          </span>

        </div>


        <button
          id="identityClose"
          class="identity-close"
          type="button"
          aria-label="Fechar reconhecimento facial"
        >
          ×
        </button>

      </header>


      <main class="identity-main">


        <!-- ==================================================
             IDENTIFICAÇÃO DO VIAJANTE
             ================================================== -->

        <section class="identity-heading">

          <div class="identity-heading-copy">

            <span class="identity-eyebrow">
              RECONHECIMENTO FACIAL
            </span>

            <h1>
              Preparação de
              <strong>identidade</strong>
            </h1>

          </div>


          <div class="identity-client">

            <div class="identity-client-avatar">
              <span id="identityClientInitials">
                TA
              </span>
            </div>

            <div>

              <span>
                VIAJANTE
              </span>

              <strong id="identityClientName">
                Nenhum cliente
              </strong>

            </div>

          </div>

        </section>


        <!-- ==================================================
             ÁREA PRINCIPAL
             ================================================== -->

        <section class="identity-workspace">


          <!-- =================================================
               CÂMERA
               ================================================= -->

          <div class="identity-camera-column">

            <div class="identity-camera-shell">


              <div class="identity-camera-header">

                <div>

                  <span>
                    CAPTURA FACIAL
                  </span>

                  <strong
                    id="identityCameraState"
                  >
                    CÂMERA DESATIVADA
                  </strong>

                </div>


                <div
                  id="identityLiveBadge"
                  class="identity-live-badge"
                >
                  OFFLINE
                </div>

              </div>


              <div class="identity-camera">


                <video
                  id="facialPreflightVideo"
                  autoplay
                  playsinline
                  muted
                ></video>


                <div
                  class="identity-camera-shade"
                ></div>


                <!-- =========================================
                     GUIA FACIAL PERSONALIZADO
                     ========================================= -->

                <div
                  class="identity-face-guide"
                  aria-hidden="true"
                >

                  <div
                    class="identity-face-frame"
                  >

                    <span
                      class="identity-frame-corner identity-frame-corner-tl"
                    ></span>

                    <span
                      class="identity-frame-corner identity-frame-corner-tr"
                    ></span>

                    <span
                      class="identity-frame-corner identity-frame-corner-bl"
                    ></span>

                    <span
                      class="identity-frame-corner identity-frame-corner-br"
                    ></span>

                    <span
                      class="identity-face-axis identity-face-axis-v"
                    ></span>

                    <span
                      class="identity-face-axis identity-face-axis-h"
                    ></span>

                    <span
                      class="identity-face-scan"
                    ></span>

                  </div>

                </div>


                <!-- =========================================
                     ORIENTAÇÃO PRINCIPAL
                     ========================================= -->

                <div
                  class="identity-camera-instruction"
                >

                  <span
                    class="identity-camera-instruction-label"
                  >
                    ORIENTAÇÃO
                  </span>

                  <strong
                    id="identityCameraMessage"
                  >
                    Posicione o rosto
                  </strong>

                </div>


                <!-- =========================================
                     ESTADOS DA CÂMERA
                     ========================================= -->

                <div
                  class="identity-camera-status"
                >

                  <div
                    id="identityFaceStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    <span>Rosto</span>
                  </div>


                  <div
                    id="identitySingleStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    <span>Uma pessoa</span>
                  </div>


                  <div
                    id="identityLightStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    <span>Iluminação</span>
                  </div>


                  <div
                    id="identityFrameStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    <span>Enquadramento</span>
                  </div>

                </div>


              </div>


              <div class="identity-camera-footer">

                <span>
                  Captura facial local
                </span>

                <span>
                  Travel Automation
                </span>

              </div>

            </div>

          </div>


          <!-- =================================================
               CONTROLO DA ORIENTAÇÃO
               ================================================= -->

          <aside class="identity-control-column">


            <div class="identity-instruction">


              <span class="identity-instruction-label">
                SIGA A ORIENTAÇÃO
              </span>


              <div
                class="identity-instruction-command"
              >

                <span
                  id="identityCurrentNumber"
                  class="identity-instruction-number"
                  aria-hidden="true"
                >
                  01
                </span>


                <div>

                  <strong
                    id="facialPreflightStepName"
                  >
                    Posicione o rosto
                  </strong>

                  <p
                    id="facialPreflightInstruction"
                  >
                    Quando iniciar, siga apenas a orientação apresentada pelo sistema.
                  </p>

                </div>

              </div>


              <div
                id="facialPreflightStatus"
                class="identity-status-message"
              >
                A câmera ainda não foi iniciada.
              </div>


            </div>


            <!-- =================================================
                 ESTADO DA CAPTURA
                 ================================================= -->

            <div class="identity-quality">


              <div
                class="identity-quality-header"
              >

                <span>
                  CONDIÇÕES DE CAPTURA
                </span>

                <strong
                  id="identityQualityValue"
                >
                  —
                </strong>

              </div>


              <div
                class="identity-quality-track"
              >

                <div
                  id="identityQualityBar"
                  class="identity-quality-fill"
                ></div>

              </div>


              <small
                id="identityQualityText"
              >
                Aguardando câmera
              </small>


            </div>


            <!-- =================================================
                 PROGRESSO DISCRETO
                 ================================================= -->

            <div
              class="identity-progress-card"
            >

              <div
                class="identity-progress-top"
              >

                <div>

                  <span>
                    PREPARAÇÃO
                  </span>

                  <strong
                    id="facialPreflightStep"
                  >
                    0 / 10
                  </strong>

                </div>


                <div
                  id="identityProgressPercent"
                  class="identity-progress-percent"
                >
                  0%
                </div>

              </div>


              <div
                class="identity-progress-track"
              >

                <div
                  id="facialPreflightProgress"
                  class="identity-progress-fill"
                ></div>

              </div>

            </div>


            <!-- =================================================
                 AÇÕES
                 ================================================= -->

            <div class="identity-actions">


              <button
                id="facialPreflightStart"
                class="identity-primary-button"
                type="button"
                disabled
              >

                <span>
                  Iniciar reconhecimento
                </span>

                <b>
                  →
                </b>

              </button>


              <button
                id="facialPreflightStop"
                class="identity-secondary-button"
                type="button"
                hidden
              >
                Parar reconhecimento
              </button>


            </div>


            <div
              class="identity-operation-note"
            >

              <span>
                PREPARAÇÃO DE VIAGEM
              </span>

              <p>
                O sistema orienta cada movimento automaticamente.
              </p>

            </div>


          </aside>

        </section>


        <!-- ==================================================
             RESULTADO
             ================================================== -->

        <section
          id="identityResult"
          class="identity-result"
          hidden
        ></section>


      </main>
    `;


    document.body.appendChild(
      overlay
    );


    bindOverlayEvents();


    return overlay;
  }


  /*
   * ==========================================================
   * EVENTOS
   * ==========================================================
   */

  function bindOverlayEvents() {

    $("identityClose")
      ?.addEventListener(
        "click",
        closeIdentityCenter
      );


    $("facialPreflightStart")
      ?.addEventListener(
        "click",
        startPreflight
      );


    $("facialPreflightStop")
      ?.addEventListener(
        "click",
        stopPreflight
      );
  }


  /*
   * ==========================================================
   * ABRIR
   * ==========================================================
   */

  function openIdentityCenter(client = null) {

    const target =
      normalizeClient(client) ||
      normalizeClient(
        getClientFromSelection()
      );


    if (!target) {

      if (
        typeof window.showToast ===
        "function"
      ) {

        window.showToast(
          "Selecione primeiro um cliente.",
          "error"
        );

      } else {

        alert(
          "Selecione primeiro um cliente."
        );
      }

      return;
    }


    selectedClient =
      target;


    createOverlay();


    /*
     * Abrir a interface NÃO liga a câmera.
     */

    overlay.classList.remove(
      "hidden"
    );


    overlay.classList.add(
      "is-open"
    );


    document.body.classList.add(
      "identity-open"
    );


    updateClientIdentity();


    resetInterface();


    const start =
      $("facialPreflightStart");


    if (start) {
      start.disabled = false;
    }


    setStatus(
      "Quando estiver pronto, inicie o reconhecimento."
    );


    setState(
      "AGUARDANDO",
      "idle"
    );


    setCameraState(
      false
    );
  }


  /*
   * ==========================================================
   * FECHAR
   * ==========================================================
   */

  function closeIdentityCenter() {

    if (!overlay) {
      return;
    }


    if (running) {
      stopPreflight();
    }


    try {

      window
        .TravelFacialPreflight
        ?.stop();

    } catch (error) {

      console.warn(
        "[IdentityCenter] stop on close",
        error
      );
    }


    running = false;


    setCameraState(
      false
    );


    overlay.classList.remove(
      "is-open"
    );


    overlay.classList.add(
      "hidden"
    );


    document.body.classList.remove(
      "identity-open"
    );
  }


  /*
   * ==========================================================
   * CLIENTE
   * ==========================================================
   */

  function updateClientIdentity() {

    if (!selectedClient) {
      return;
    }


    const name =
      $("identityClientName");


    if (name) {

      name.textContent =
        selectedClient.name;
    }


    const initials =
      $("identityClientInitials");


    if (initials) {

      const parts =
        selectedClient.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2);


      initials.textContent =
        parts
          .map(
            part =>
              part
                .charAt(0)
                .toUpperCase()
          )
          .join("") ||
        "TA";
    }
  }


  /*
   * ==========================================================
   * RESET
   * ==========================================================
   */

  function resetInterface() {

    completed = false;

    saving = false;

    completedPositions.clear();

    activePositionIndex = 0;


    setState(
      "AGUARDANDO",
      "idle"
    );


    setStatus(
      "A câmera ainda não foi iniciada."
    );


    setCameraState(
      false
    );


    updateProgress({
      current: 0,
      total: 10
    });


    updateQuality(
      null
    );


    setAnalysis(
      null
    );


    const result =
      $("identityResult");


    if (result) {

      result.hidden = true;

      result.innerHTML = "";
    }


    const start =
      $("facialPreflightStart");


    if (start) {

      start.disabled =
        !selectedClient;


      start.innerHTML = `
        <span>
          Iniciar reconhecimento
        </span>

        <b>
          →
        </b>
      `;
    }


    const stop =
      $("facialPreflightStop");


    if (stop) {
      stop.hidden = true;
    }


    /*
     * Estado inicial da orientação.
     */

    setInstruction(
      "Posicione o rosto",
      "Quando iniciar, siga apenas a orientação apresentada pelo sistema."
    );
  }


  /*
   * ==========================================================
   * ESTADO SUPERIOR
   * ==========================================================
   */

  function setState(
    text,
    type = "idle"
  ) {

    const element =
      $("identityCameraState");


    const badge =
      $("identityLiveBadge");


    if (element) {
      element.textContent =
        text;
    }


    if (badge) {

      badge.textContent =
        type === "success"
          ? "ATIVO"
          : type === "error"
            ? "ATENÇÃO"
            : type === "warning"
              ? "ANÁLISE"
              : "PRONTO";


      badge.className =
        `identity-live-badge ${type}`;
    }
  }


  /*
   * ==========================================================
   * STATUS
   * ==========================================================
   */

  function setStatus(message) {

    const element =
      $("facialPreflightStatus");


    if (element) {

      element.textContent =
        message ||
        "";
    }


    const cameraMessage =
      $("identityCameraMessage");


    if (cameraMessage) {

      cameraMessage.textContent =
        message ||
        "Aguardando...";
    }
  }


  /*
   * ==========================================================
   * ORIENTAÇÃO
   * ==========================================================
   */

  function setInstruction(
    title,
    instruction
  ) {

    const name =
      $("facialPreflightStepName");


    const description =
      $("facialPreflightInstruction");


    const number =
      $("identityCurrentNumber");


    if (name) {

      name.textContent =
        title ||
        "Aguardando";
    }


    if (description) {

      description.textContent =
        instruction ||
        "";
    }


    if (number) {

      /*
       * O número é mantido apenas como estado interno
       * de compatibilidade.
       *
       * O CSS pode ocultá-lo visualmente.
       */

      const position =
        POSITIONS[
          activePositionIndex
        ];

      number.textContent =
        position?.number ||
        "";
    }
  }


  /*
   * ==========================================================
   * CÂMERA
   * ==========================================================
   */

  function setCameraState(active) {

    const element =
      $("identityCameraState");


    const badge =
      $("identityLiveBadge");


    if (element) {

      element.textContent =
        active
          ? "CÂMERA ATIVA"
          : "CÂMERA DESATIVADA";
    }


    if (badge) {

      badge.textContent =
        active
          ? "ATIVO"
          : "PRONTO";


      badge.className =
        `identity-live-badge ${
          active
            ? "success"
            : ""
        }`;
    }


    if (overlay) {

      overlay.classList.toggle(
        "camera-active",
        Boolean(active)
      );
    }
  }


  /*
   * ==========================================================
   * ANÁLISE
   * ==========================================================
   */

  function setAnalysis(analysis) {

    if (!analysis) {

      setStatusChip(
        "identityFaceStatus",
        null
      );


      setStatusChip(
        "identitySingleStatus",
        null
      );


      setStatusChip(
        "identityLightStatus",
        null
      );


      setStatusChip(
        "identityFrameStatus",
        null
      );


      return;
    }


    setStatusChip(
      "identityFaceStatus",
      analysis.faceDetected === true
    );


    setStatusChip(
      "identitySingleStatus",
      analysis.singleFace === true
    );


    const brightness =
      Number(
        analysis.quality
          ?.brightnessScore ||
        0
      );


    setStatusChip(
      "identityLightStatus",
      brightness >= 0.55
    );


    const area =
      Number(
        analysis.faceArea ||
        analysis.boundingBox?.area ||
        0
      );


    const framed =
      area === 0 ||
      (
        area >= 0.08 &&
        area <= 0.72
      );


    setStatusChip(
      "identityFrameStatus",
      framed
    );
  }


  /*
   * ==========================================================
   * CHIP DE ESTADO
   * ==========================================================
   */

  function setStatusChip(
    id,
    value
  ) {

    const element =
      $(id);


    if (!element) {
      return;
    }


    element.classList.remove(
      "ok",
      "bad",
      "waiting"
    );


    const icon =
      element.querySelector("i");


    const label =
      element.querySelector("span");


    if (value === true) {

      element.classList.add(
        "ok"
      );


      if (icon) {
        icon.textContent =
          "✓";
      }


      if (label) {

        /*
         * Mantém o significado do indicador.
         */

        label.textContent =
          label.textContent
            .replace(/^! /, "")
            .replace(/^✓ /, "");
      }


      return;
    }


    if (value === false) {

      element.classList.add(
        "bad"
      );


      if (icon) {
        icon.textContent =
          "!";
      }


      return;
    }


    element.classList.add(
      "waiting"
    );


    if (icon) {
      icon.textContent =
        "·";
    }
  }


  /*
   * ==========================================================
   * PROGRESSO
   * ==========================================================
   *
   * Continua disponível para o motor, mas a interface
   * apresenta apenas uma barra discreta.
   *
   * Não mostra a sequência das posições.
   */

  function updateProgress(progress) {

    if (!progress) {
      return;
    }


    const current =
      Number(
        progress.current ||
        0
      );


    const total =
      Number(
        progress.total ||
        10
      );


    const safeCurrent =
      Math.max(
        0,
        Math.min(
          total,
          current
        )
      );


    const percent =
      total > 0
        ? (
            safeCurrent /
            total
          ) * 100
        : 0;


    const step =
      $("facialPreflightStep");


    if (step) {

      step.textContent =
        `${safeCurrent} / ${total}`;
    }


    const bar =
      $("facialPreflightProgress");


    if (bar) {

      bar.style.width =
        `${percent}%`;
    }


    const percentElement =
      $("identityProgressPercent");


    if (percentElement) {

      percentElement.textContent =
        `${Math.round(percent)}%`;
    }


    /*
     * Descobrir a posição atual apenas internamente.
     */

    let positionId =
      progress.currentPosition ||
      null;


    if (
      !positionId &&
      progress.position
    ) {

      positionId =
        POSITIONS.find(
          item =>
            item.title ===
              progress.position ||
            item.id ===
              progress.position
        )?.id ||
        null;
    }


    if (positionId) {

      const index =
        POSITIONS.findIndex(
          item =>
            item.id ===
            positionId
        );


      if (index >= 0) {

        activePositionIndex =
          index;
      }
    } else if (
      safeCurrent <
      POSITIONS.length
    ) {

      activePositionIndex =
        Math.max(
          0,
          Math.min(
            POSITIONS.length - 1,
            safeCurrent
          )
        );
    }


    const currentPosition =
      POSITIONS[
        activePositionIndex
      ];


    if (currentPosition) {

      setInstruction(
        currentPosition.title,
        currentPosition.instruction
      );
    }


    updateQuality(
      progress.analysis
    );


    setAnalysis(
      progress.analysis
    );
  }


  /*
   * ==========================================================
   * POSIÇÃO CONCLUÍDA
   * ==========================================================
   *
   * Não há renderização de lista.
   *
   * O estado continua guardado internamente porque é
   * utilizado para confirmar que o fluxo realmente passou
   * pelas posições.
   */

  function markPositionCompleted(
    position
  ) {

    const index =
      POSITIONS.findIndex(
        item =>
          item.id ===
          position
      );


    if (index < 0) {
      return;
    }


    completedPositions.add(
      index
    );


    const next =
      index + 1;


    if (
      next <
      POSITIONS.length
    ) {

      activePositionIndex =
        next;


      const nextPosition =
        POSITIONS[
          activePositionIndex
        ];


      if (nextPosition) {

        setInstruction(
          nextPosition.title,
          nextPosition.instruction
        );
      }
    }


    const count =
      completedPositions.size;


    const step =
      $("facialPreflightStep");


    const percent =
      Math.round(
        (
          count /
          POSITIONS.length
        ) * 100
      );


    if (step) {

      step.textContent =
        `${count} / ${POSITIONS.length}`;
    }


    const bar =
      $("facialPreflightProgress");


    if (bar) {

      bar.style.width =
        `${percent}%`;
    }


    const percentElement =
      $("identityProgressPercent");


    if (percentElement) {

      percentElement.textContent =
        `${percent}%`;
    }
  }


  /*
   * ==========================================================
   * QUALIDADE
   * ==========================================================
   */

  function updateQuality(analysis) {

    if (!analysis) {

      const value =
        $("identityQualityValue");


      const bar =
        $("identityQualityBar");


      const text =
        $("identityQualityText");


      if (value) {

        value.textContent =
          "—";
      }


      if (bar) {

        bar.style.width =
          "0%";
      }


      if (text) {

        text.textContent =
          "Aguardando câmera";
      }


      return;
    }


    const brightness =
      Number(
        analysis.quality
          ?.brightnessScore ||
        0
      );


    const sharpness =
      Number(
        analysis.quality
          ?.sharpnessScore ||
        0
      );


    const face =
      analysis.faceDetected
        ? 1
        : 0;


    const single =
      analysis.singleFace
        ? 1
        : 0;


    const faceArea =
      Number(
        analysis.faceArea ||
        0
      );


    const framing =
      faceArea >= 0.08 &&
      faceArea <= 0.72
        ? 1
        : 0;


    const score =
      Math.round(
        (
          brightness * 0.3 +
          sharpness * 0.15 +
          face * 0.2 +
          single * 0.2 +
          framing * 0.15
        ) * 100
      );


    const safeScore =
      Math.max(
        0,
        Math.min(
          100,
          score
        )
      );


    const value =
      $("identityQualityValue");


    const bar =
      $("identityQualityBar");


    const text =
      $("identityQualityText");


    if (value) {

      value.textContent =
        `${safeScore}%`;
    }


    if (bar) {

      bar.style.width =
        `${safeScore}%`;
    }


    if (text) {

      if (safeScore >= 82) {

        text.textContent =
          "Condições adequadas para captura";

      } else if (
        safeScore >= 70
      ) {

        text.textContent =
          "Condições aceitáveis";

      } else {

        text.textContent =
          "Ajuste a posição, iluminação ou distância";
      }
    }
  }


  /*
   * ==========================================================
   * INICIAR
   * ==========================================================
   */

  async function startPreflight() {

    try {

    if (
      window.TravelFacialPreflight &&
      typeof window
        .TravelFacialPreflight
        .primeAudio === "function"
    ) {

      window
        .TravelFacialPreflight
        .primeAudio();

    } else if (
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !==
        "undefined"
    ) {

      /*
       * Fallback direto do navegador.
       */

      const speech =
        window.speechSynthesis;

      speech.cancel();

      const unlock =
        new SpeechSynthesisUtterance(
          ""
        );

      unlock.lang =
        "pt-PT";

      unlock.volume =
        0;

      unlock.rate =
        1;

      speech.speak(
        unlock
      );

      speech.resume();

    }

  } catch (audioError) {

    console.warn(
      "[IdentityCenter] Não foi possível inicializar o áudio:",
      audioError
    );
  }

    const client =
      selectedClient ||
      normalizeClient(
        getClientFromSelection()
      );


    if (!client) {

      setStatus(
        "Selecione primeiro um cliente."
      );

      return;
    }


    if (
      !window.TravelFacialPreflight
    ) {

      setState(
        "MÓDULO AUSENTE",
        "error"
      );


      setStatus(
        "O motor facial não foi carregado."
      );


      return;
    }


    selectedClient =
      client;


    updateClientIdentity();


    /*
     * Nunca iniciar duas execuções simultâneas.
     */

    if (running) {
      return;
    }


    completedPositions.clear();


    activePositionIndex = 0;


    completed = false;

    running = true;

    saving = false;


    const start =
      $("facialPreflightStart");


    const stop =
      $("facialPreflightStop");


    if (start) {

      start.disabled =
        true;
    }


    if (stop) {

      stop.hidden =
        false;
    }


    setState(
      "INICIALIZANDO",
      "warning"
    );


    setStatus(
      "A preparar a câmera..."
    );


    setCameraState(
      false
    );


    setInstruction(
      "Posicione o rosto",
      "Mantenha o rosto dentro do enquadramento."
    );


    try {

      const engine =
        window.TravelFacialPreflight;


      await engine.initialize({

        videoElement:
          $("facialPreflightVideo"),

        clientId:
          client.id,


        onStatus: ({
          message,
          type,
          analysis
        }) => {

          setStatus(
            message
          );


          setAnalysis(
            analysis
          );


          if (
            type ===
            "error"
          ) {

            setState(
              "ATENÇÃO",
              "error"
            );

          } else if (
            type ===
            "success"
          ) {

            setState(
              "ATIVO",
              "success"
            );

          } else {

            setState(
              "ANALISANDO",
              "warning"
            );
          }
        },


        onProgress:
          updateProgress,


        onPosition: ({
          position,
          completed:
            positionCompleted
        }) => {

          const index =
            POSITIONS.findIndex(
              item =>
                item.id ===
                position
            );


          if (index >= 0) {

            activePositionIndex =
              index;


            const current =
              POSITIONS[index];


            if (current) {

              setInstruction(
                current.title,
                current.instruction
              );
            }
          }


          /*
           * Somente o motor pode confirmar uma posição.
           */

          if (
            positionCompleted === true &&
            index >= 0
          ) {

            markPositionCompleted(
              position
            );


            if (
              index + 1 <
              POSITIONS.length
            ) {

              const next =
                POSITIONS[
                  index + 1
                ];


              setStatus(
                next?.instruction ||
                "Continue a seguir a orientação do sistema."
              );

            } else {

              setStatus(
                "Preparação facial concluída."
              );
            }

          }
        },


        onComplete:
          async result => {

            await handleComplete(
              result
            );
          },


        onError:
          error => {

            console.error(
              "[IdentityCenter]",
              error
            );


            running = false;


            setCameraState(
              false
            );


            setState(
              "ERRO",
              "error"
            );


            setStatus(
              error?.message ||
              "Não foi possível concluir a análise."
            );


            if (start) {

              start.disabled =
                false;
            }


            if (stop) {

              stop.hidden =
                true;
            }
          }
      });


      /*
       * A CÂMERA SÓ É ATIVADA AQUI.
       */

      await engine.start({
        clientId:
          client.id
      });


      setCameraState(
        true
      );


      setState(
        "ATIVO",
        "success"
      );


      setStatus(
        "Câmera ativa. Siga a orientação apresentada."
      );


      const first =
        POSITIONS[0];


      if (first) {

        setInstruction(
          first.title,
          first.instruction
        );
      }

    } catch (error) {

      console.error(
        "[IdentityCenter] start",
        error
      );


      running = false;


      try {

        window
          .TravelFacialPreflight
          ?.stop();

      } catch (stopError) {

        console.warn(
          "[IdentityCenter] cleanup",
          stopError
        );
      }


      setCameraState(
        false
      );


      setState(
        "NÃO INICIADA",
        "error"
      );


      setStatus(
        error?.message ||
        "Não foi possível iniciar a câmera."
      );


      if (start) {

        start.disabled =
          false;
      }


      if (stop) {

        stop.hidden =
          true;
      }
    }
  }


  /*
   * ==========================================================
   * PARAR
   * ==========================================================
   */

  function stopPreflight() {

    try {

      window
        .TravelFacialPreflight
        ?.stop();

    } catch (error) {

      console.error(
        "[IdentityCenter] stop",
        error
      );
    }


    running = false;


    setCameraState(
      false
    );


    setState(
      "PARADA",
      "warning"
    );


    setStatus(
      "O reconhecimento foi interrompido."
    );


    const start =
      $("facialPreflightStart");


    const stop =
      $("facialPreflightStop");


    if (start) {

      start.disabled =
        false;


      start.innerHTML = `
        <span>
          Iniciar novamente
        </span>

        <b>
          →
        </b>
      `;
    }


    if (stop) {

      stop.hidden =
        true;
    }
  }


  /*
   * ==========================================================
   * CONCLUSÃO
   * ==========================================================
   */

  async function handleComplete(result) {

    running = false;


    completed =
      Boolean(
        result?.passed
      );


    setCameraState(
      false
    );


    /*
     * O resultado do motor continua sendo a fonte principal.
     */

    if (
      completedPositions.size ===
      POSITIONS.length
    ) {

      activePositionIndex =
        POSITIONS.length - 1;


      updateProgress({
        current: 10,
        total: 10
      });
    }


    if (completed) {

      setState(
        "CONCLUÍDO",
        "success"
      );


      setStatus(
        "Preparação facial concluída."
      );


      updateProgress({
        current: 10,
        total: 10
      });

    } else {

      setState(
        "AJUSTES NECESSÁRIOS",
        "warning"
      );


      setStatus(
        "A preparação precisa ser repetida."
      );
    }


    await saveResult(
      result
    );
  }


  /*
   * ==========================================================
   * GUARDAR RESULTADO
   * ==========================================================
   */

  async function saveResult(result) {

    const applicationForm =
      document.getElementById(
        "applicationForm"
      );


    if (applicationForm) {

      applicationForm.dataset
        .facialPreflight =
        "pending";
    }


    if (
      saving ||
      !selectedClient
    ) {

      return;
    }


    saving = true;


    showResult(
      result,
      null
    );


    if (!result?.passed) {

      if (applicationForm) {

        applicationForm.dataset
          .facialPreflight =
          "failed";
      }


      saving = false;

      return;
    }


    try {

      if (
        !window.TravelFacialPreflight ||
        typeof window
          .TravelFacialPreflight
          .submitToBackend !==
          "function"
      ) {

        throw new Error(
          "O módulo facial não possui a função de gravação no backend."
        );
      }


      let localFaceMatch =
        null;


      /*
       * Comparação facial local com a fotografia
       * do passaporte.
       */

      if (
        window.TravelLocalFaceMatch &&
        typeof window
          .TravelLocalFaceMatch
          .compare ===
          "function"
      ) {

        const video =
          document.getElementById(
            "facialPreflightVideo"
          );


        setState(
          "COMPARANDO",
          "warning"
        );


        setStatus(
          "A comparar o rosto com a fotografia do passaporte..."
        );


        try {

          localFaceMatch =
            await window
              .TravelLocalFaceMatch
              .compare({
                clientId:
                  selectedClient.id,

                videoElement:
                  video
              });


          console.info(
            "[IdentityCenter] local face match",
            localFaceMatch
          );


          if (
            localFaceMatch?.attempted !==
            true
          ) {

            throw new Error(
              "A comparação facial local não foi executada."
            );
          }


          if (
            localFaceMatch.matched !==
            true
          ) {

            setState(
              "ROSTOS DIFERENTES",
              "error"
            );


            setStatus(
              "O rosto apresentado não atingiu a correspondência mínima com a fotografia do passaporte."
            );


            if (applicationForm) {

              applicationForm.dataset
                .facialPreflight =
                "failed";
            }


            saving = false;


            showResult(
              {
                ...result,

                passed:
                  false,

                localFaceMatch
              },

              null
            );


            return;
          }


          setState(
            "IDENTIDADE COMPATÍVEL",
            "success"
          );


          setStatus(
            `Rosto compatível com o passaporte. Similaridade local: ${localFaceMatch.similarityPercent}%.`
          );

        } catch (faceError) {

          console.error(
            "[IdentityCenter] local face match",
            faceError
          );


          setState(
            "COMPARAÇÃO FALHOU",
            "error"
          );


          setStatus(
            faceError?.message ||
            "Não foi possível comparar o rosto com a fotografia do passaporte."
          );


          if (applicationForm) {

            applicationForm.dataset
              .facialPreflight =
              "failed";
          }


          saving = false;

          return;
        }
      }


      const data =
        await window
          .TravelFacialPreflight
          .submitToBackend({
            clientId:
              selectedClient.id,

            passportMatch: {
              localFaceMatch:
                localFaceMatch
            }
          });


      if (
        data?.success !==
        true
      ) {

        throw new Error(
          data?.error ||
          data?.message ||
          "O backend não confirmou a verificação facial."
        );
      }


      if (applicationForm) {

        applicationForm.dataset
          .facialPreflight =
          "passed";
      }


      showResult(
        result,
        data
      );

    } catch (error) {

      if (applicationForm) {

        applicationForm.dataset
          .facialPreflight =
          "failed";
      }


      console.error(
        "[IdentityCenter] backend",
        error
      );


      setState(
        "NÃO GUARDADA",
        "error"
      );


      setStatus(
        error?.message ||
        "A preparação terminou, mas não foi possível guardar o resultado."
      );

    } finally {

      saving = false;
    }
  }


  /*
   * ==========================================================
   * RESULTADO
   * ==========================================================
   */

  function showResult(
    result,
    backend
  ) {

    const box =
      $("identityResult");


    if (!box) {
      return;
    }


    const passed =
      Boolean(
        result?.passed
      );


    const score =
      Math.round(
        Number(
          result?.score ||
          0
        ) * 100
      );


    const issues =
      Array.isArray(
        result?.issues
      )
        ? result.issues
        : [];


    box.hidden =
      false;


    box.className =
      `identity-result ${
        passed
          ? "passed"
          : "failed"
      }`;


    box.innerHTML = `

      <div class="identity-result-icon">
        ${passed ? "✓" : "!"}
      </div>


      <div class="identity-result-content">


        <span class="identity-result-eyebrow">

          ${
            passed
              ? "RECONHECIMENTO CONCLUÍDO"
              : "RECONHECIMENTO NÃO CONCLUÍDO"
          }

        </span>


        <h2>

          ${
            passed
              ? "Identidade preparada"
              : "É necessário repetir"
          }

        </h2>


        <p>

          ${
            passed
              ? "A preparação facial foi concluída e o resultado foi registado."
              : "A captura não reuniu as condições necessárias para continuar."
          }

        </p>


        ${
          passed
            ? `
              <div class="identity-result-score">

                <strong>
                  ${score}%
                </strong>

                <span>
                  resultado da análise
                </span>

              </div>
            `
            : ""
        }


        ${
          issues.length
            ? `
              <div class="identity-result-issues">

                <strong>
                  Ajustes necessários
                </strong>

                <ul>

                  ${issues
                    .slice(0, 6)
                    .map(
                      issue =>
                        `<li>${escapeHtml(issue)}</li>`
                    )
                    .join("")}

                </ul>

              </div>
            `
            : ""
        }


        ${
          passed
            ? `
              <div class="identity-result-checks">

                <span>
                  ✓ Captura facial concluída
                </span>

                <span>
                  ✓ Comparação com documento concluída
                </span>

                <span>
                  ✓ Resultado registado
                </span>

              </div>
            `
            : `
              <div class="identity-result-checks warning">

                <span>
                  Ajuste o enquadramento
                </span>

                <span>
                  Siga novamente a orientação do sistema
                </span>

              </div>
            `
        }


        <small>
          Esta é uma etapa interna de preparação da viagem.
        </small>


        <div class="identity-result-actions">


          ${
            passed
              ? `
                <button
                  id="identityContinueButton"
                  class="identity-primary-button"
                  type="button"
                >

                  <span>
                    Continuar preparação
                  </span>

                  <b>
                    →
                  </b>

                </button>
              `
              : `
                <button
                  id="identityRetryButton"
                  class="identity-primary-button"
                  type="button"
                >

                  <span>
                    Repetir reconhecimento
                  </span>

                  <b>
                    ↻
                  </b>

                </button>
              `
          }


        </div>


      </div>
    `;


    if (passed) {

      $("identityContinueButton")
        ?.addEventListener(
          "click",
          () => {

            closeIdentityCenter();


            document
              .getElementById(
                "verificationSection"
              )
              ?.scrollIntoView({
                behavior: "smooth",
                block: "start"
              });
          }
        );

    } else {

      $("identityRetryButton")
        ?.addEventListener(
          "click",
          async () => {

            box.hidden =
              true;


            try {

              window
                .TravelFacialPreflight
                ?.stop();

            } catch (error) {

              console.warn(
                "[IdentityCenter] retry cleanup",
                error
              );
            }


            running = false;


            resetInterface();


            await startPreflight();
          }
        );
    }


    if (
      backend?.preflight?.passed
    ) {

      const checks =
        box.querySelector(
          ".identity-result-checks"
        );


      if (checks) {

        checks.innerHTML = `

          <span>
            ✓ Captura facial concluída
          </span>

          <span>
            ✓ Comparação com documento concluída
          </span>

          <span>
            ✓ Resultado registado
          </span>

        `;
      }
    }
  }


  /*
   * ==========================================================
   * BOTÕES EXTERNOS
   * ==========================================================
   */

  function attachLaunchButtons() {

    document.addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            "[data-open-identity-center]"
          );


        if (!button) {
          return;
        }


        event.preventDefault();


        const clientId =
          button.dataset.clientId;


        let client =
          null;


        if (
          clientId &&
          Array.isArray(
            window.travelAutomationClients
          )
        ) {

          const found =
            window.travelAutomationClients.find(
              item =>
                String(
                  item.id ||
                  item._id
                ) ===
                String(clientId)
            );


          if (found) {

            client =
              normalizeClient(
                found
              );
          }
        }


        openIdentityCenter(
          client
        );
      }
    );
  }


  /*
   * ==========================================================
   * BOTÃO DO DASHBOARD
   * ==========================================================
   */

  function createDashboardButton() {

    const section =
      $("verificationSection");


    if (!section) {
      return;
    }


    if (
      $("identityLaunchButton")
    ) {

      return;
    }


    const host =
      section.querySelector(
        ".verification-overview-main"
      );


    if (!host) {
      return;
    }


    const button =
      document.createElement(
        "button"
      );


    button.id =
      "identityLaunchButton";


    button.type =
      "button";


    button.className =
      "identity-dashboard-launch";


    button.innerHTML = `

      <span class="identity-launch-icon">
        TA
      </span>


      <span>

        <strong>
          Reconhecimento Facial
        </strong>

        <small>
          Preparar identidade
        </small>

      </span>


      <b>
        →
      </b>

    `;


    button.addEventListener(
      "click",
      event => {

        event.preventDefault();


        /*
         * Apenas abre a interface.
         *
         * A câmera continua desligada até
         * o botão de iniciar ser pressionado.
         */

        openIdentityCenter();
      }
    );


    host.appendChild(
      button
    );
  }


  /*
   * ==========================================================
   * SELEÇÃO DE CLIENTE
   * ==========================================================
   */

  function attachClientSelection() {

    document.addEventListener(
      "change",
      event => {

        const id =
          event.target?.id;


        if (
          id ===
          "applicationClient"
        ) {

          selectedClient =
            normalizeClient(
              getClientFromSelection()
            );


          const start =
            $("facialPreflightStart");


          if (
            start &&
            selectedClient &&
            overlay
          ) {

            start.disabled =
              false;
          }
        }


        if (
          id ===
          "identityClient"
        ) {

          selectedClient =
            normalizeClient(
              getClientFromSelection()
            );
        }


        if (
          id ===
          "passportClientSelect"
        ) {

          selectedClient =
            normalizeClient(
              getClientFromSelection()
            );
        }
      }
    );
  }


  /*
   * ==========================================================
   * INICIALIZAÇÃO
   * ==========================================================
   */

  function initialize() {

    attachLaunchButtons();

    attachClientSelection();


    /*
     * Não abrir automaticamente.
     *
     * Não ligar câmera automaticamente.
     */

    setTimeout(
      createDashboardButton,
      600
    );
  }


  /*
   * ==========================================================
   * API PÚBLICA
   * ==========================================================
   */

  window.TravelIdentityCenter = {

    open:
      openIdentityCenter,

    close:
      closeIdentityCenter,

    reset:
      resetInterface
  };


  /*
   * ==========================================================
   * BOOT
   * ==========================================================
   */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );

  } else {

    initialize();
  }


})();
