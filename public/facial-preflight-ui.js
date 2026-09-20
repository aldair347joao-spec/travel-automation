/*
 * ============================================================
 * TRAVEL AUTOMATION
 * RECONHECIMENTO FACIAL — CAPTURE STATION
 * ============================================================
 *
 * Interface visual da captura facial.
 *
 * O motor biométrico continua em:
 * /public/facial-preflight.js
 *
 * Esta camada NÃO executa reconhecimento facial.
 * Apenas apresenta visualmente o estado fornecido pelo motor.
 *
 * Conceito:
 * - câmera como elemento principal;
 * - enquadramento interrompido;
 * - vermelho = rosto fora das condições;
 * - âmbar = ajuste necessário;
 * - verde = posição adequada;
 * - uma única orientação por vez;
 * - nenhuma lista das 10 posições;
 * - nenhuma sequência de bolinhas;
 * - nenhuma explicação repetitiva.
 * ============================================================
 */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const POSITIONS = [
    {
      id: "frontal",
      title: "OLHE PARA A CÂMERA",
      instruction:
        "Mantenha o rosto de frente para a câmera."
    },
    {
      id: "left",
      title: "VIRE PARA A ESQUERDA",
      instruction:
        "Vire lentamente o rosto para a esquerda."
    },
    {
      id: "right",
      title: "VIRE PARA A DIREITA",
      instruction:
        "Vire lentamente o rosto para a direita."
    },
    {
      id: "up",
      title: "OLHE PARA CIMA",
      instruction:
        "Levante lentamente o rosto."
    },
    {
      id: "down",
      title: "OLHE PARA BAIXO",
      instruction:
        "Baixe lentamente o rosto."
    },
    {
      id: "left_up",
      title: "ESQUERDA E CIMA",
      instruction:
        "Vire para a esquerda e olhe para cima."
    },
    {
      id: "right_up",
      title: "DIREITA E CIMA",
      instruction:
        "Vire para a direita e olhe para cima."
    },
    {
      id: "left_down",
      title: "ESQUERDA E BAIXO",
      instruction:
        "Vire para a esquerda e olhe para baixo."
    },
    {
      id: "right_down",
      title: "DIREITA E BAIXO",
      instruction:
        "Vire para a direita e olhe para baixo."
    },
    {
      id: "smile",
      title: "SORRIA",
      instruction:
        "Olhe para a câmera e sorria naturalmente."
    }
  ];

  let overlay = null;
  let selectedClient = null;

  let running = false;
  let saving = false;
  let completed = false;

  let activePositionIndex = 0;
  let lastFrameState = "waiting";

  /*
   * ==========================================================
   * CLIENTE
   * ==========================================================
   */

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
        "Viajante"
    };
  }

  function getClientFromSelection() {
    const ids = [
      "applicationClient",
      "identityClient",
      "passportClientSelect"
    ];

    for (const id of ids) {
      const select = $(id);

      if (!select || !select.value) {
        continue;
      }

      const option =
        select.options?.[
          select.selectedIndex
        ];

      return normalizeClient({
        id: select.value,

        name:
          option?.textContent?.trim() ||
          "Viajante"
      });
    }

    return null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /*
   * ==========================================================
   * INTERFACE
   * ==========================================================
   */

  function createOverlay() {
    if ($("identityCenter")) {
      overlay = $("identityCenter");
      return overlay;
    }

    overlay =
      document.createElement("section");

    overlay.id =
      "identityCenter";

    overlay.className =
      "identity-center identity-fullscreen hidden";

    overlay.innerHTML = `
      <div class="identity-world">

        <div class="identity-world-grid"></div>

        <div class="identity-world-glow identity-world-glow-a"></div>
        <div class="identity-world-glow identity-world-glow-b"></div>

        <div class="identity-route-mark">
          <span>ANGOLA</span>
          <i></i>
          <span>PORTUGAL</span>
        </div>

      </div>


      <header class="identity-topbar">

        <div class="identity-brand">

          <div class="identity-brand-mark">
            <span>T</span>
            <span>A</span>
          </div>

          <div class="identity-brand-copy">
            <strong>
              TRAVEL AUTOMATION
            </strong>

            <span>
              PREPARAÇÃO DE VIAGEM
            </span>
          </div>

        </div>


        <div class="identity-session">

          <span>
            IDENTIFICAÇÃO
          </span>

          <strong id="identityClientName">
            —
          </strong>

        </div>


        <button
          id="identityClose"
          class="identity-close"
          type="button"
          aria-label="Fechar reconhecimento facial"
        >
          <span></span>
          <span></span>
        </button>

      </header>


      <main class="identity-capture">

        <section class="identity-camera-stage">

          <div class="identity-camera">

            <video
              id="facialPreflightVideo"
              autoplay
              playsinline
              muted
            ></video>


            <div class="identity-camera-vignette"></div>


            <div
              class="identity-face-frame"
              id="identityFaceFrame"
              aria-hidden="true"
            >

              <span class="identity-frame-corner tl"></span>
              <span class="identity-frame-corner tr"></span>
              <span class="identity-frame-corner bl"></span>
              <span class="identity-frame-corner br"></span>

              <span class="identity-frame-tick tick-top"></span>
              <span class="identity-frame-tick tick-bottom"></span>
              <span class="identity-frame-tick tick-left"></span>
              <span class="identity-frame-tick tick-right"></span>

              <span class="identity-frame-center"></span>

              <span class="identity-frame-scan"></span>

            </div>


            <div
              id="identityCameraState"
              class="identity-camera-state"
            >
              PREPARANDO CÂMERA
            </div>


            <div
              id="identityCameraMessage"
              class="identity-camera-message"
            >
              POSICIONE O ROSTO
            </div>


            <div class="identity-camera-footer">

              <div
                class="identity-condition"
                id="identityConditionFace"
              >
                <i id="identityFaceIndicator"></i>

                <span id="identityFaceText">
                  ROSTO
                </span>
              </div>


              <div
                class="identity-condition"
                id="identityConditionLight"
              >
                <i id="identityLightIndicator"></i>

                <span id="identityLightText">
                  LUZ
                </span>
              </div>


              <div
                class="identity-condition"
                id="identityConditionFrame"
              >
                <i id="identityFrameIndicator"></i>

                <span id="identityFrameText">
                  ENQUADRAMENTO
                </span>
              </div>

            </div>

          </div>


          <div class="identity-camera-bottom">

            <div class="identity-capture-label">

              <span>
                CAPTURA
              </span>

              <strong id="identityCaptureState">
                AGUARDANDO
              </strong>

            </div>


            <div class="identity-progress-area">

              <div class="identity-progress-number">

                <strong id="identityProgressPercent">
                  0%
                </strong>

                <span>
                  PREPARAÇÃO
                </span>

              </div>


              <div class="identity-progress-track">
                <span
                  id="facialPreflightProgress"
                ></span>
              </div>

            </div>

          </div>

        </section>


        <section class="identity-guidance">

          <div class="identity-guidance-line"></div>


          <div class="identity-guidance-content">

            <span class="identity-guidance-kicker">
              ORIENTAÇÃO DO SISTEMA
            </span>


            <h1
              id="facialPreflightStepName"
            >
              PREPARE-SE
            </h1>


            <p
              id="facialPreflightStatus"
            >
              A preparar o reconhecimento.
            </p>


            <div class="identity-quality">

              <div class="identity-quality-top">

                <span>
                  QUALIDADE DA CAPTURA
                </span>

                <strong
                  id="identityQualityValue"
                >
                  —
                </strong>

              </div>


              <div class="identity-quality-track">

                <span
                  id="identityQualityBar"
                ></span>

              </div>


              <small
                id="identityQualityText"
              >
                Aguardando captura
              </small>

            </div>


            <div
              id="facialPreflightInstruction"
              class="identity-hidden"
            >
              Siga a orientação do sistema.
            </div>


            <span
              id="identityCurrentNumber"
              class="identity-hidden"
            >
              01
            </span>

          </div>

        </section>

      </main>


      <footer class="identity-footer">

        <div class="identity-footer-left">

          <span>
            TA
          </span>

          <strong>
            IDENTIFICAÇÃO DO VIAJANTE
          </strong>

        </div>


        <div class="identity-footer-center">
          DOCUMENTO → IDENTIDADE → VIAGEM
        </div>


        <div class="identity-footer-right">
          <span id="identityFooterStatus">
            SISTEMA PRONTO
          </span>
        </div>

      </footer>


      <button
        id="facialPreflightStart"
        type="button"
        hidden
        disabled
      >
        Iniciar
      </button>


      <button
        id="facialPreflightStop"
        type="button"
        hidden
      >
        Parar
      </button>


      <section
        id="identityResult"
        class="identity-result"
        hidden
      ></section>

    `;

    document.body.appendChild(
      overlay
    );

    bindEvents();

    return overlay;
  }

  /*
   * ==========================================================
   * EVENTOS
   * ==========================================================
   */

  function bindEvents() {
    $("identityClose")?.addEventListener(
      "click",
      closeIdentityCenter
    );

    $("facialPreflightStart")?.addEventListener(
      "click",
      startPreflight
    );

    $("facialPreflightStop")?.addEventListener(
      "click",
      stopPreflight
    );
  }

  /*
   * ==========================================================
   * ABRIR
   * ==========================================================
   */

  async function openIdentityCenter(
    client = null
  ) {
    const target =
      normalizeClient(client) ||
      getClientFromSelection();

    if (!target) {
      if (
        typeof window.showToast ===
        "function"
      ) {
        window.showToast(
          "Selecione primeiro um viajante.",
          "error"
        );
      } else {
        alert(
          "Selecione primeiro um viajante."
        );
      }

      return;
    }

    selectedClient =
      target;

    createOverlay();

    overlay.classList.remove(
      "hidden"
    );

    requestAnimationFrame(() => {
      overlay.classList.add(
        "is-open"
      );
    });

    document.body.classList.add(
      "identity-open"
    );

    updateClientIdentity();

    resetInterface();

    await startPreflight();
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

    try {
      window
        .TravelFacialPreflight
        ?.stop();
    } catch (error) {
      console.warn(
        "[IdentityCenter] stop",
        error
      );
    }

    running = false;

    overlay.classList.remove(
      "is-open"
    );

    window.setTimeout(() => {
      overlay.classList.add(
        "hidden"
      );
    }, 240);

    document.body.classList.remove(
      "identity-open"
    );

    setCameraState(false);
  }

  /*
   * ==========================================================
   * CLIENTE
   * ==========================================================
   */

  function updateClientIdentity() {
    const name =
      $("identityClientName");

    if (!name) {
      return;
    }

    name.textContent =
      selectedClient?.name ||
      "Viajante";
  }

  /*
   * ==========================================================
   * RESET
   * ==========================================================
   */

  function resetInterface() {
    completed = false;
    saving = false;

    activePositionIndex = 0;
    lastFrameState = "waiting";

    setFrameState(
      "waiting"
    );

    setCameraState(false);

    setCaptureState(
      "PREPARANDO"
    );

    setInstruction(
      "PREPARE-SE",
      "Siga a orientação do sistema."
    );

    setStatus(
      "A preparar o reconhecimento."
    );

    updateProgress({
      completed: 0,
      total: 10
    });

    updateQuality(null);

    setFooterStatus(
      "SISTEMA PRONTO"
    );

    const result =
      $("identityResult");

    if (result) {
      result.hidden = true;
      result.innerHTML = "";
    }
  }

  /*
   * ==========================================================
   * CÂMERA
   * ==========================================================
   */

  function setCameraState(active) {
    if (!overlay) {
      return;
    }

    overlay.classList.toggle(
      "camera-active",
      Boolean(active)
    );

    const state =
      $("identityCameraState");

    if (state) {
      state.textContent =
        active
          ? "CÂMERA ATIVA"
          : "PREPARANDO CÂMERA";
    }

    if (active) {
      setFooterStatus(
        "CAPTURA ATIVA"
      );
    }
  }

  function setCaptureState(state) {
    const element =
      $("identityCaptureState");

    if (element) {
      element.textContent =
        state || "AGUARDANDO";
    }
  }

  function setFooterStatus(
    text
  ) {
    const element =
      $("identityFooterStatus");

    if (element) {
      element.textContent =
        text || "";
    }
  }

  /*
   * ==========================================================
   * ENQUADRAMENTO
   * ==========================================================
   */

  function setFrameState(
    state
  ) {
    const frame =
      $("identityFaceFrame");

    if (!frame) {
      return;
    }

    const normalized =
      state || "waiting";

    frame.classList.remove(
      "state-waiting",
      "state-danger",
      "state-warning",
      "state-ready",
      "state-captured"
    );

    frame.classList.add(
      `state-${normalized}`
    );

    lastFrameState =
      normalized;

    if (
      normalized ===
      "danger"
    ) {
      setCameraMessage(
        "AJUSTE O ROSTO"
      );
    }

    if (
      normalized ===
      "warning"
    ) {
      setCameraMessage(
        "CENTRALIZE O ROSTO"
      );
    }

    if (
      normalized ===
      "ready"
    ) {
      setCameraMessage(
        "MANTENHA A POSIÇÃO"
      );
    }

    if (
      normalized ===
      "captured"
    ) {
      setCameraMessage(
        "CAPTURADO"
      );
    }

    if (
      normalized ===
      "waiting"
    ) {
      setCameraMessage(
        "POSICIONE O ROSTO"
      );
    }
  }

  function setCameraMessage(
    message
  ) {
    const element =
      $("identityCameraMessage");

    if (element) {
      element.textContent =
        message || "";
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
    const titleElement =
      $("facialPreflightStepName");

    if (titleElement) {
      titleElement.textContent =
        title ||
        "SIGA A ORIENTAÇÃO";
    }

    const instructionElement =
      $("facialPreflightInstruction");

    if (instructionElement) {
      instructionElement.textContent =
        instruction || "";
    }
  }

  function setStatus(
    message
  ) {
    const element =
      $("facialPreflightStatus");

    if (element) {
      element.textContent =
        message || "";
    }
  }

  /*
   * ==========================================================
   * PROGRESSO
   * ==========================================================
   */

  function updateProgress(
    progress
  ) {
    if (!progress) {
      return;
    }

    const current =
      Number(
        progress.completed ??
        progress.current ??
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

    if (
      progress.currentPosition
    ) {
      const index =
        POSITIONS.findIndex(
          position =>
            position.id ===
            progress.currentPosition
        );

      if (index >= 0) {
        activePositionIndex =
          index;
      }
    }

    if (
      Number.isFinite(
        Number(
          progress.currentPositionIndex
        )
      )
    ) {
      activePositionIndex =
        Number(
          progress.currentPositionIndex
        );
    }
  }

  /*
   * ==========================================================
   * QUALIDADE
   * ==========================================================
   */

  function updateQuality(
    value
  ) {
    const valueElement =
      $("identityQualityValue");

    const textElement =
      $("identityQualityText");

    const bar =
      $("identityQualityBar");

    if (
      value == null ||
      !Number.isFinite(
        Number(value)
      )
    ) {
      if (valueElement) {
        valueElement.textContent =
          "—";
      }

      if (textElement) {
        textElement.textContent =
          "Aguardando captura";
      }

      if (bar) {
        bar.style.width =
          "0%";
      }

      return;
    }

    const numeric =
      Number(value);

    const percent =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            numeric <= 1
              ? numeric * 100
              : numeric
          )
        )
      );

    if (valueElement) {
      valueElement.textContent =
        `${percent}%`;
    }

    if (textElement) {
      textElement.textContent =
        percent >= 80
          ? "Condições excelentes"
          : percent >= 65
            ? "Condições adequadas"
            : percent >= 45
              ? "Ajuste o enquadramento"
              : "A procurar condições adequadas";
    }

    if (bar) {
      bar.style.width =
        `${percent}%`;
    }
  }

  /*
   * ==========================================================
   * INDICADORES
   * ==========================================================
   */

  function indicator(
    indicatorId,
    textId,
    state,
    okText,
    badText
  ) {
    const indicatorElement =
      $(indicatorId);

    const text =
      $(textId);

    if (!indicatorElement) {
      return;
    }

    indicatorElement.classList.remove(
      "ok",
      "bad",
      "waiting"
    );

    if (state === true) {
      indicatorElement.classList.add(
        "ok"
      );

      if (text) {
        text.textContent =
          okText;
      }

      return;
    }

    if (state === false) {
      indicatorElement.classList.add(
        "bad"
      );

      if (text) {
        text.textContent =
          badText;
      }

      return;
    }

    indicatorElement.classList.add(
      "waiting"
    );
  }

  function setAnalysis(
    analysis
  ) {
    if (!analysis) {
      indicator(
        "identityFaceIndicator",
        "identityFaceText",
        null,
        "ROSTO DETECTADO",
        "ROSTO"
      );

      indicator(
        "identityLightIndicator",
        "identityLightText",
        null,
        "LUZ OK",
        "LUZ"
      );

      indicator(
        "identityFrameIndicator",
        "identityFrameText",
        null,
        "ENQUADRAMENTO OK",
        "ENQUADRAMENTO"
      );

      setFrameState(
        "waiting"
      );

      return;
    }

    const faceDetected =
      analysis.faceDetected ===
      true ||
      Boolean(
        analysis.detectionScore ||
        analysis.detection
      );

    indicator(
      "identityFaceIndicator",
      "identityFaceText",
      faceDetected,
      "ROSTO DETECTADO",
      "ROSTO NÃO DETECTADO"
    );

    const brightness =
      Number(
        analysis.brightnessScore ??
        analysis.quality?.brightnessScore ??
        0
      );

    const lightOkay =
      brightness >=
      0.55;

    indicator(
      "identityLightIndicator",
      "identityLightText",
      lightOkay,
      "LUZ OK",
      "MELHORE A LUZ"
    );

    const sizeScore =
      Number(
        analysis.faceSizeScore ??
        analysis.quality?.faceSizeScore ??
        0
      );

    const positionScore =
      Number(
        analysis.score ??
        0
      );

    const scoreOkay =
      positionScore >=
      0.66;

    let frameState =
      "danger";

    if (!faceDetected) {
      frameState =
        "danger";
    } else if (
      !lightOkay ||
      sizeScore < 0.55
    ) {
      frameState =
        "warning";
    } else if (
      scoreOkay
    ) {
      frameState =
        "ready";
    } else {
      frameState =
        "warning";
    }

    setFrameState(
      frameState
    );

    indicator(
      "identityFrameIndicator",
      "identityFrameText",
      frameState ===
        "ready",
      "ENQUADRAMENTO OK",
      frameState ===
        "danger"
        ? "AJUSTE O ROSTO"
        : "CENTRALIZE"
    );

    const qualityScore =
      Number(
        analysis.score ??
        analysis.quality?.score ??
        0
      );

    if (
      Number.isFinite(
        qualityScore
      )
    ) {
      updateQuality(
        qualityScore
      );
    }
  }

  /*
   * ==========================================================
   * INICIAR MOTOR
   * ==========================================================
   */

  async function startPreflight() {
    if (
      running ||
      !selectedClient
    ) {
      return;
    }

    const video =
      $("facialPreflightVideo");

    if (!video) {
      setStatus(
        "A câmera facial não está disponível."
      );

      return;
    }

    running = true;

    setCaptureState(
      "INICIALIZANDO"
    );

    setCameraState(
      false
    );

    setFrameState(
      "waiting"
    );

    setInstruction(
      "PREPARE-SE",
      "Siga a orientação do sistema."
    );

    try {
      const engine =
        window.TravelFacialPreflight;

      if (!engine) {
        throw new Error(
          "O motor de reconhecimento facial não foi carregado."
        );
      }

      const callbacks = {
        onStatus:
          payload => {
            handleEngineStatus(
              payload
            );
          },

        onProgress:
          payload => {
            updateProgress(
              payload
            );

            if (
              payload?.evaluation
            ) {
              setAnalysis(
                payload.evaluation
              );
            }
          },

        onPosition:
          payload => {
            handlePosition(
              payload
            );
          },

        onComplete:
          async result => {
            await handleComplete(
              result
            );
          },

        onError:
          error => {
            handleEngineError(
              error
            );
          }
      };

      if (
        typeof engine.initialize ===
        "function"
      ) {
        await engine.initialize({
          videoElement:
            video,

          clientId:
            selectedClient.id,

          ...callbacks
        });
      }

      await engine.start({
        clientId:
          selectedClient.id,

        videoElement:
          video,

        ...callbacks
      });

      setCameraState(
        true
      );

      setCaptureState(
        "CAPTURA ATIVA"
      );

      setFrameState(
        "waiting"
      );

      setFooterStatus(
        "CAPTURA ATIVA"
      );

      setStatus(
        "Aguardando o seu posicionamento."
      );

    } catch (error) {
      running = false;

      setCameraState(
        false
      );

      setCaptureState(
        "CÂMERA NÃO INICIADA"
      );

      setFooterStatus(
        "ATENÇÃO"
      );

      handleEngineError(
        error
      );
    }
  }

  /*
   * ==========================================================
   * STATUS DO MOTOR
   * ==========================================================
   */

  function handleEngineStatus(
    payload
  ) {
    if (!payload) {
      return;
    }

    const message =
      typeof payload ===
      "string"
        ? payload
        : payload.message;

    if (!message) {
      return;
    }

    const normalized =
      String(message)
        .toLowerCase();

    if (
      normalized.includes(
        "câmera ativa"
      ) ||
      normalized.includes(
        "camera ativa"
      )
    ) {
      setCameraState(
        true
      );

      setCaptureState(
        "CAPTURA ATIVA"
      );

      return;
    }

    if (
      normalized.includes(
        "posicione o rosto"
      )
    ) {
      setCameraState(
        true
      );

      setCaptureState(
        "AGUARDANDO ROSTO"
      );

      setFrameState(
        "danger"
      );

      setStatus(
        "Ajuste o rosto no enquadramento."
      );

      return;
    }

    if (
      normalized.includes(
        "uma pessoa"
      )
    ) {
      setFrameState(
        "danger"
      );

      setStatus(
        "Mantenha apenas o viajante diante da câmera."
      );

      return;
    }

    if (
      normalized.includes(
        "perfeito"
      )
    ) {
      setFrameState(
        "ready"
      );

      setStatus(
        "Mantenha a posição."
      );

      return;
    }

    if (
      normalized.includes(
        "iluminação"
      ) ||
      normalized.includes(
        "iluminacao"
      )
    ) {
      setFrameState(
        "warning"
      );
    }

    setStatus(
      message
    );
  }

  /*
   * ==========================================================
   * POSIÇÃO
   * ==========================================================
   */

  function handlePosition(
    payload
  ) {
    if (!payload) {
      return;
    }

    let index =
      Number.isFinite(
        Number(payload.index)
      )
        ? Number(payload.index)
        : -1;

    if (
      index < 0 &&
      payload.position
    ) {
      index =
        POSITIONS.findIndex(
          position =>
            position.id ===
              payload.position?.id ||
            position.id ===
              payload.position
        );
    }

    if (
      index >= 0 &&
      index < POSITIONS.length
    ) {
      activePositionIndex =
        index;
    }

    const position =
      POSITIONS[
        activePositionIndex
      ];

    if (!position) {
      return;
    }

    if (
      payload.completed ===
      true
    ) {
      setFrameState(
        "captured"
      );

      setCaptureState(
        "CAPTURADO"
      );

      setFooterStatus(
        "POSIÇÃO CAPTURADA"
      );

      window.setTimeout(
        () => {
          if (
            running
          ) {
            setFrameState(
              "waiting"
            );

            setCaptureState(
              "A CAPTURAR"
            );

            setFooterStatus(
              "CAPTURA ATIVA"
            );
          }
        },
        420
      );

      return;
    }

    setInstruction(
      position.title,
      position.instruction
    );

    setCaptureState(
      "A CAPTURAR"
    );

    setFrameState(
      "waiting"
    );

    setStatus(
      "Aguardando o posicionamento."
    );
  }

  /*
   * ==========================================================
   * ERRO
   * ==========================================================
   */

  function handleEngineError(
    error
  ) {
    running = false;

    setCameraState(
      false
    );

    setFrameState(
      "danger"
    );

    setCaptureState(
      "ATENÇÃO"
    );

    setFooterStatus(
      "ATENÇÃO"
    );

    setStatus(
      error?.message ||
      "Não foi possível iniciar o reconhecimento facial."
    );
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
      console.warn(
        "[IdentityCenter] stop",
        error
      );
    }

    running = false;

    setCameraState(
      false
    );

    setFrameState(
      "waiting"
    );

    setCaptureState(
      "INTERROMPIDO"
    );

    setFooterStatus(
      "INTERROMPIDO"
    );

    setStatus(
      "Reconhecimento interrompido."
    );
  }

  /*
   * ==========================================================
   * CONCLUSÃO
   * ==========================================================
   */

  async function handleComplete(
    result
  ) {
    running = false;

    completed =
      Boolean(
        result?.passed ??
        result?.success
      );

    setCameraState(
      false
    );

    setFrameState(
      completed
        ? "captured"
        : "danger"
    );

    setCaptureState(
      completed
        ? "CAPTURA CONCLUÍDA"
        : "CAPTURA INCOMPLETA"
    );

    setFooterStatus(
      completed
        ? "IDENTIDADE CAPTURADA"
        : "REPETIR CAPTURA"
    );

    updateProgress({
      completed:
        completed
          ? 10
          : 0,

      total: 10
    });

    if (completed) {
      setInstruction(
        "IDENTIDADE CAPTURADA",
        "A preparação facial foi concluída."
      );

      setStatus(
        "A validar a identidade."
      );
    } else {
      setInstruction(
        "REPITA A CAPTURA",
        "Siga novamente a orientação do sistema."
      );

      setStatus(
        "A captura precisa ser repetida."
      );
    }

    await saveResult(
      result
    );
  }

  /*
   * ==========================================================
   * GUARDAR
   * ==========================================================
   */

  async function saveResult(
    result
  ) {
    const applicationForm =
      $("applicationForm");

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

    const passed =
      Boolean(
        result?.passed ??
        result?.success
      );

    if (!passed) {
      if (applicationForm) {
        applicationForm.dataset
          .facialPreflight =
          "failed";
      }

      saving = false;
      return;
    }

    try {
      const engine =
        window.TravelFacialPreflight;

      if (
        !engine ||
        typeof engine.submitToBackend !==
          "function"
      ) {
        throw new Error(
          "O módulo facial não possui a função de gravação no backend."
        );
      }

      let localFaceMatch =
        null;

      if (
        window.TravelLocalFaceMatch &&
        typeof window
          .TravelLocalFaceMatch
          .compare ===
          "function"
      ) {
        const video =
          $("facialPreflightVideo");

        setCaptureState(
          "COMPARANDO"
        );

        setFooterStatus(
          "A COMPARAR"
        );

        setStatus(
          "A comparar a identidade com o documento."
        );

        localFaceMatch =
          await window
            .TravelLocalFaceMatch
            .compare({
              clientId:
                selectedClient.id,

              videoElement:
                video
            });

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
          setFrameState(
            "danger"
          );

          setCaptureState(
            "NÃO COMPATÍVEL"
          );

          setFooterStatus(
            "NÃO CONFIRMADA"
          );

          setInstruction(
            "IDENTIDADE NÃO CONFIRMADA",
            "Será necessário repetir o reconhecimento."
          );

          if (applicationForm) {
            applicationForm.dataset
              .facialPreflight =
              "failed";
          }

          showResult(
            {
              ...result,
              passed: false,
              success: false,
              localFaceMatch
            },
            null
          );

          saving = false;
          return;
        }
      }

      const data =
        await engine.submitToBackend({
          clientId:
            selectedClient.id,

          passportMatch: {
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

      setFrameState(
        "captured"
      );

      setCaptureState(
        "IDENTIDADE CONFIRMADA"
      );

      setFooterStatus(
        "IDENTIDADE CONFIRMADA"
      );

      showResult(
        {
          ...result,
          passed: true,
          success: true
        },
        data
      );

    } catch (error) {
      if (applicationForm) {
        applicationForm.dataset
          .facialPreflight =
          "failed";
      }

      setFrameState(
        "danger"
      );

      setCaptureState(
        "NÃO REGISTADA"
      );

      setFooterStatus(
        "NÃO REGISTADA"
      );

      setStatus(
        error?.message ||
        "Não foi possível guardar o resultado."
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
        result?.passed ??
        result?.success
      );

    const score =
      Math.round(
        Number(
          result?.score ||
          0
        ) * 100
      );

    box.hidden = false;

    box.className =
      `identity-result ${
        passed
          ? "passed"
          : "failed"
      }`;

    box.innerHTML = `
      <div class="identity-result-panel">

        <div class="identity-result-mark">
          ${passed ? "✓" : "!"}
        </div>

        <div class="identity-result-copy">

          <span>
            ${
              passed
                ? "IDENTIDADE CONFIRMADA"
                : "CAPTURA NÃO CONCLUÍDA"
            }
          </span>

          <h2>
            ${
              passed
                ? "Reconhecimento concluído"
                : "É necessário repetir"
            }
          </h2>

          <p>
            ${
              passed
                ? "A identidade foi preparada para a próxima etapa."
                : "A captura não reuniu as condições necessárias."
            }
          </p>

          ${
            passed
              ? `
                <div class="identity-result-score">
                  <strong>${score}%</strong>
                  <span>resultado da análise</span>
                </div>
              `
              : ""
          }

          <div class="identity-result-actions">

            ${
              passed
                ? `
                  <button
                    id="identityContinueButton"
                    type="button"
                  >
                    CONTINUAR
                  </button>
                `
                : `
                  <button
                    id="identityRetryButton"
                    type="button"
                  >
                    REPETIR RECONHECIMENTO
                  </button>
                `
            }

          </div>

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
            box.hidden = true;

            try {
              window
                .TravelFacialPreflight
                ?.stop();
            } catch (_) {}

            running = false;

            resetInterface();

            await startPreflight();
          }
        );
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
      <span class="identity-launch-mark">

        <span class="identity-launch-corner tl"></span>
        <span class="identity-launch-corner tr"></span>
        <span class="identity-launch-corner bl"></span>
        <span class="identity-launch-corner br"></span>

        <span class="identity-launch-face"></span>

      </span>

      <span class="identity-launch-copy">

        <strong>
          Preparar identidade
        </strong>

        <small>
          Captura facial do viajante
        </small>

      </span>

      <span class="identity-launch-arrow">
        →
      </span>
    `;

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        openIdentityCenter();
      }
    );

    host.appendChild(
      button
    );
  }

  /*
   * ==========================================================
   * SELEÇÃO
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
          "applicationClient" ||
          id ===
          "identityClient" ||
          id ===
          "passportClientSelect"
        ) {
          selectedClient =
            getClientFromSelection();
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

    window.setTimeout(
      createDashboardButton,
      600
    );
  }

  /*
   * ==========================================================
   * API
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
