/*
 * ============================================================
 * TRAVEL AUTOMATION
 * RECONHECIMENTO FACIAL — FULL SCREEN
 * ============================================================
 *
 * Interface de captura biométrica.
 *
 * O motor facial continua em:
 * /public/facial-preflight.js
 *
 * Esta interface NÃO:
 * - lista os 10 movimentos;
 * - mostra bolinhas;
 * - repete instruções longas;
 * - controla a lógica biométrica;
 * - simula reconhecimento.
 *
 * A câmera é iniciada automaticamente quando o utilizador
 * entra nesta experiência através do botão de reconhecimento.
 *
 * O áudio do motor continua responsável pelas orientações.
 * ============================================================
 */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const POSITIONS = [
    {
      id: "frontal",
      number: "01",
      title: "OLHE PARA A CÂMERA",
      instruction: "Mantenha o rosto de frente para a câmera."
    },
    {
      id: "left",
      number: "02",
      title: "VIRE PARA A ESQUERDA",
      instruction: "Vire lentamente o rosto para a esquerda."
    },
    {
      id: "right",
      number: "03",
      title: "VIRE PARA A DIREITA",
      instruction: "Vire lentamente o rosto para a direita."
    },
    {
      id: "up",
      number: "04",
      title: "OLHE PARA CIMA",
      instruction: "Levante lentamente o rosto."
    },
    {
      id: "down",
      number: "05",
      title: "OLHE PARA BAIXO",
      instruction: "Baixe lentamente o rosto."
    },
    {
      id: "left_up",
      number: "06",
      title: "ESQUERDA E CIMA",
      instruction: "Vire para a esquerda e olhe para cima."
    },
    {
      id: "right_up",
      number: "07",
      title: "DIREITA E CIMA",
      instruction: "Vire para a direita e olhe para cima."
    },
    {
      id: "left_down",
      number: "08",
      title: "ESQUERDA E BAIXO",
      instruction: "Vire para a esquerda e olhe para baixo."
    },
    {
      id: "right_down",
      number: "09",
      title: "DIREITA E BAIXO",
      instruction: "Vire para a direita e olhe para baixo."
    },
    {
      id: "smile",
      number: "10",
      title: "SORRIA",
      instruction: "Olhe para a câmera e sorria naturalmente."
    }
  ];

  let overlay = null;
  let selectedClient = null;

  let running = false;
  let saving = false;
  let completed = false;

  let activePositionIndex = 0;

  const completedPositions = new Set();

  /*
   * ----------------------------------------------------------
   * CLIENTE
   * ----------------------------------------------------------
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

      if (!select?.value) {
        continue;
      }

      const option =
        select.options?.[select.selectedIndex];

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
   * ----------------------------------------------------------
   * INTERFACE FULL SCREEN
   * ----------------------------------------------------------
   */

  function createOverlay() {
    if ($("identityCenter")) {
      overlay = $("identityCenter");
      return overlay;
    }

    overlay = document.createElement("section");

    overlay.id = "identityCenter";

    overlay.className =
      "identity-center identity-fullscreen hidden";

    overlay.innerHTML = `
      <div class="identity-atmosphere">
        <div class="identity-light identity-light-a"></div>
        <div class="identity-light identity-light-b"></div>
      </div>

      <header class="identity-topbar">

        <div class="identity-brand">

          <div class="identity-brand-mark">
            TA
          </div>

          <div class="identity-brand-copy">
            <strong>
              TRAVEL AUTOMATION
            </strong>

            <span>
              IDENTIFICAÇÃO DO VIAJANTE
            </span>
          </div>

        </div>

        <div class="identity-traveller">

          <span>
            VIAJANTE
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

        <div class="identity-camera-stage">

          <div class="identity-camera">

            <video
              id="facialPreflightVideo"
              autoplay
              playsinline
              muted
            ></video>

            <div class="identity-video-depth"></div>

            <div
              class="identity-face-guide"
              aria-hidden="true"
            >

              <span class="identity-corner tl"></span>
              <span class="identity-corner tr"></span>
              <span class="identity-corner bl"></span>
              <span class="identity-corner br"></span>

              <span class="identity-axis vertical"></span>
              <span class="identity-axis horizontal"></span>

              <span class="identity-scan-line"></span>

            </div>


            <div
              class="identity-camera-state"
              id="identityCameraState"
            >
              PREPARANDO CÂMERA
            </div>


            <div
              class="identity-camera-message"
              id="identityCameraMessage"
            >
              POSICIONE O ROSTO
            </div>


            <div class="identity-capture-footer">

              <div class="identity-condition">
                <i id="identityFaceIndicator"></i>
                <span id="identityFaceText">
                  DETECÇÃO
                </span>
              </div>

              <div class="identity-condition">
                <i id="identityLightIndicator"></i>
                <span id="identityLightText">
                  ILUMINAÇÃO
                </span>
              </div>

              <div class="identity-condition">
                <i id="identityFrameIndicator"></i>
                <span id="identityFrameText">
                  ENQUADRAMENTO
                </span>
              </div>

            </div>

          </div>


          <div class="identity-camera-meta">

            <div>
              <span>CAPTURA BIOMÉTRICA</span>
              <strong id="identityCaptureState">
                AGUARDANDO
              </strong>
            </div>

            <div class="identity-progress">

              <span
                id="identityProgressPercent"
              >
                0%
              </span>

              <div class="identity-progress-track">
                <span
                  id="facialPreflightProgress"
                ></span>
              </div>

            </div>

          </div>

        </div>


        <section class="identity-guidance">

          <div class="identity-guidance-label">
            ORIENTAÇÃO DO SISTEMA
          </div>

          <div
            class="identity-guidance-command"
            id="facialPreflightStepName"
          >
            PREPARE-SE
          </div>

          <div
            class="identity-guidance-status"
            id="facialPreflightStatus"
          >
            A preparar o reconhecimento.
          </div>

          <div class="identity-guidance-state">

            <span
              id="identityQualityValue"
            >
              —
            </span>

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
            class="identity-hidden-instruction"
          >
            Siga a orientação de voz.
          </div>

          <span
            id="identityCurrentNumber"
            class="identity-hidden-number"
          >
            01
          </span>

        </section>

      </main>


      <footer class="identity-footer">

        <span>
          ANGOLA
        </span>

        <div class="identity-footer-line"></div>

        <span>
          PREPARAÇÃO DE VIAGEM
        </span>

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

    document.body.appendChild(overlay);

    bindEvents();

    return overlay;
  }

  /*
   * ----------------------------------------------------------
   * EVENTOS
   * ----------------------------------------------------------
   */

  function bindEvents() {
    $("identityClose")?.addEventListener(
      "click",
      closeIdentityCenter
    );

    /*
     * Mantemos os botões existentes por compatibilidade.
     * O fluxo normal NÃO depende deles.
     */
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
   * ----------------------------------------------------------
   * ABRIR
   * ----------------------------------------------------------
   */

  async function openIdentityCenter(client = null) {
    const target =
      normalizeClient(client) ||
      getClientFromSelection();

    if (!target) {
      if (typeof window.showToast === "function") {
        window.showToast(
          "Selecione primeiro um viajante.",
          "error"
        );
      } else {
        alert("Selecione primeiro um viajante.");
      }

      return;
    }

    selectedClient = target;

    createOverlay();

    overlay.classList.remove("hidden");
    overlay.classList.add("is-open");

    document.body.classList.add("identity-open");

    updateClientIdentity();

    resetInterface();

    /*
     * IMPORTANTE:
     *
     * O reconhecimento começa imediatamente.
     *
     * openIdentityCenter() é chamado pelo clique do
     * utilizador. O startPreflight() continua no mesmo
     * fluxo de interação para permitir que o motor facial
     * ative também o áudio orientador.
     */

    await startPreflight();
  }

  /*
   * ----------------------------------------------------------
   * FECHAR
   * ----------------------------------------------------------
   */

  function closeIdentityCenter() {
    if (!overlay) {
      return;
    }

    try {
      window.TravelFacialPreflight?.stop();
    } catch (error) {
      console.warn(
        "[IdentityCenter] stop",
        error
      );
    }

    running = false;

    setCameraState(false);

    overlay.classList.remove("is-open");
    overlay.classList.add("hidden");

    document.body.classList.remove("identity-open");
  }

  /*
   * ----------------------------------------------------------
   * CLIENTE
   * ----------------------------------------------------------
   */

  function updateClientIdentity() {
    if (!selectedClient) {
      return;
    }

    const name = $("identityClientName");

    if (name) {
      name.textContent =
        selectedClient.name;
    }
  }

  /*
   * ----------------------------------------------------------
   * RESET
   * ----------------------------------------------------------
   */

  function resetInterface() {
    completed = false;
    saving = false;

    completedPositions.clear();

    activePositionIndex = 0;

    setCameraState(false);

    setCaptureState(
      "PREPARANDO"
    );

    setInstruction(
      "POSICIONE O ROSTO",
      "Siga a orientação de voz do sistema."
    );

    setStatus(
      "A preparar o reconhecimento."
    );

    updateProgress({
      current: 0,
      total: 10
    });

    updateQuality(null);

    const result = $("identityResult");

    if (result) {
      result.hidden = true;
      result.innerHTML = "";
    }
  }

  /*
   * ----------------------------------------------------------
   * ESTADO DA CÂMERA
   * ----------------------------------------------------------
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
  }

  function setCaptureState(state) {
    const element =
      $("identityCaptureState");

    if (element) {
      element.textContent =
        state || "AGUARDANDO";
    }
  }

  /*
   * ----------------------------------------------------------
   * ORIENTAÇÃO
   * ----------------------------------------------------------
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

  /*
   * ----------------------------------------------------------
   * STATUS
   * ----------------------------------------------------------
   */

  function setStatus(message) {
    const status =
      $("facialPreflightStatus");

    if (status) {
      status.textContent =
        message || "";
    }

    /*
     * Não substituímos a orientação principal por
     * mensagens técnicas.
     *
     * O motor continua enviando status para o painel
     * inferior.
     */
  }

  /*
   * ----------------------------------------------------------
   * PROGRESSO
   * ----------------------------------------------------------
   */

  function updateProgress(progress) {
    if (!progress) {
      return;
    }

    const current =
      Number(progress.current || 0);

    const total =
      Number(progress.total || 10);

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
        ? (safeCurrent / total) * 100
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
        activePositionIndex = index;
      }
    }
  }

  /*
   * ----------------------------------------------------------
   * QUALIDADE
   * ----------------------------------------------------------
   */

  function updateQuality(value) {
    const numeric =
      Number(value);

    if (!Number.isFinite(numeric)) {
      const valueElement =
        $("identityQualityValue");

      const textElement =
        $("identityQualityText");

      const bar =
        $("identityQualityBar");

      if (valueElement) {
        valueElement.textContent = "—";
      }

      if (textElement) {
        textElement.textContent =
          "Aguardando captura";
      }

      if (bar) {
        bar.style.width = "0%";
      }

      return;
    }

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

    const valueElement =
      $("identityQualityValue");

    const textElement =
      $("identityQualityText");

    const bar =
      $("identityQualityBar");

    if (valueElement) {
      valueElement.textContent =
        `${percent}%`;
    }

    if (textElement) {
      textElement.textContent =
        percent >= 75
          ? "Condições adequadas"
          : percent >= 50
            ? "Ajuste o enquadramento"
            : "A procurar condições adequadas";
    }

    if (bar) {
      bar.style.width =
        `${percent}%`;
    }
  }

  /*
   * ----------------------------------------------------------
   * INDICADORES
   * ----------------------------------------------------------
   */

  function indicator(
    indicatorId,
    textId,
    state,
    okText,
    badText
  ) {
    const indicator =
      $(indicatorId);

    const text =
      $(textId);

    if (!indicator) {
      return;
    }

    indicator.classList.remove(
      "ok",
      "bad",
      "waiting"
    );

    if (state === true) {
      indicator.classList.add("ok");

      if (text) {
        text.textContent =
          okText;
      }

      return;
    }

    if (state === false) {
      indicator.classList.add("bad");

      if (text) {
        text.textContent =
          badText;
      }

      return;
    }

    indicator.classList.add("waiting");
  }

  function setAnalysis(analysis) {
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
        "ILUMINAÇÃO OK",
        "ILUMINAÇÃO"
      );

      indicator(
        "identityFrameIndicator",
        "identityFrameText",
        null,
        "ENQUADRAMENTO OK",
        "ENQUADRAMENTO"
      );

      return;
    }

    indicator(
      "identityFaceIndicator",
      "identityFaceText",
      analysis.faceDetected === true,
      "ROSTO DETECTADO",
      "ROSTO NÃO DETECTADO"
    );

    const brightness =
      Number(
        analysis.quality?.brightnessScore ||
        analysis.brightnessScore ||
        0
      );

    indicator(
      "identityLightIndicator",
      "identityLightText",
      brightness >= 0.55,
      "ILUMINAÇÃO OK",
      "MELHORE A ILUMINAÇÃO"
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

    indicator(
      "identityFrameIndicator",
      "identityFrameText",
      framed,
      "ENQUADRAMENTO OK",
      "AJUSTE O ROSTO"
    );

    if (
      analysis.quality?.score != null
    ) {
      updateQuality(
        Number(
          analysis.quality.score
        )
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * INICIAR
   * ----------------------------------------------------------
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

    setCameraState(false);

    setInstruction(
      "PREPARE-SE",
      "Siga apenas a orientação de voz."
    );

    try {
      const engine =
        window.TravelFacialPreflight;

      if (!engine) {
        throw new Error(
          "O motor de reconhecimento facial não foi carregado."
        );
      }

      /*
       * O motor já contém:
       * - FaceAPI;
       * - modelos locais;
       * - câmera;
       * - áudio;
       * - sequência;
       * - análise;
       * - backend.
       *
       * Não duplicamos nenhuma dessas funções aqui.
       */

      if (
        typeof engine.initialize ===
        "function"
      ) {
        await engine.initialize({
          videoElement: video,
          clientId: selectedClient.id,

          onStatus: payload => {
            handleEngineStatus(
              payload
            );
          },

          onProgress: payload => {
            updateProgress(
              payload
            );
          },

          onPosition: payload => {
            handlePosition(
              payload
            );
          },

          onComplete: async result => {
            await handleComplete(
              result
            );
          },

          onError: error => {
            handleEngineError(
              error
            );
          }
        });
      }

      /*
       * start() é chamado dentro do fluxo do clique
       * que abriu esta tela.
       *
       * Portanto o motor consegue iniciar também o
       * speechSynthesis sem uma segunda ação.
       */

      await engine.start({
        clientId:
          selectedClient.id,

        videoElement: video,

        onStatus: payload => {
          handleEngineStatus(
            payload
          );
        },

        onProgress: payload => {
          updateProgress(
            payload
          );
        },

        onPosition: payload => {
          handlePosition(
            payload
          );
        },

        onComplete: async result => {
          await handleComplete(
            result
          );
        },

        onError: error => {
          handleEngineError(
            error
          );
        }
      });

      setCameraState(true);

      setCaptureState(
        "CAPTURA ATIVA"
      );

      setStatus(
        "Siga a orientação de voz."
      );

    } catch (error) {
      running = false;

      setCameraState(false);

      setCaptureState(
        "CÂMERA NÃO INICIADA"
      );

      handleEngineError(
        error
      );
    }
  }

  /*
   * ----------------------------------------------------------
   * STATUS DO MOTOR
   * ----------------------------------------------------------
   */

  function handleEngineStatus(payload) {
    if (!payload) {
      return;
    }

    const message =
      typeof payload === "string"
        ? payload
        : payload.message;

    if (!message) {
      return;
    }

    const normalized =
      String(message)
        .toLowerCase();

    /*
     * Status técnicos não substituem a orientação
     * principal.
     */

    if (
      normalized.includes(
        "câmera ativa"
      ) ||
      normalized.includes(
        "camera ativa"
      )
    ) {
      setCameraState(true);

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
      setCameraState(true);

      setCaptureState(
        "AGUARDANDO ROSTO"
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
      setStatus(
        "Mantenha apenas o viajante diante da câmera."
      );

      return;
    }

    setStatus(
      message
    );
  }

  /*
   * ----------------------------------------------------------
   * POSIÇÃO
   * ----------------------------------------------------------
   */

  function handlePosition(payload) {
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
            payload.position ||
            position.title ===
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

    /*
     * Apenas uma instrução curta.
     *
     * O texto completo fica escondido e serve apenas
     * como compatibilidade/apoio ao motor.
     */

    setInstruction(
      position.title,
      position.instruction
    );

    setCaptureState(
      "A CAPTURAR"
    );

    setStatus(
      "Siga a orientação de voz."
    );
  }

  /*
   * ----------------------------------------------------------
   * ERRO
   * ----------------------------------------------------------
   */

  function handleEngineError(error) {
    running = false;

    setCameraState(false);

    setCaptureState(
      "ATENÇÃO"
    );

    setStatus(
      error?.message ||
      "Não foi possível iniciar o reconhecimento facial."
    );
  }

  /*
   * ----------------------------------------------------------
   * PARAR
   * ----------------------------------------------------------
   */

  function stopPreflight() {
    try {
      window.TravelFacialPreflight?.stop();
    } catch (error) {
      console.warn(
        "[IdentityCenter] stop",
        error
      );
    }

    running = false;

    setCameraState(false);

    setCaptureState(
      "INTERROMPIDO"
    );

    setStatus(
      "Reconhecimento interrompido."
    );
  }

  /*
   * ----------------------------------------------------------
   * CONCLUSÃO
   * ----------------------------------------------------------
   */

  async function handleComplete(result) {
    running = false;

    completed =
      Boolean(
        result?.passed
      );

    setCameraState(false);

    setCaptureState(
      completed
        ? "CAPTURA CONCLUÍDA"
        : "CAPTURA INCOMPLETA"
    );

    updateProgress({
      current: completed ? 10 : 0,
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
        "Siga novamente a orientação de voz."
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
   * ----------------------------------------------------------
   * GUARDAR RESULTADO
   * ----------------------------------------------------------
   */

  async function saveResult(result) {
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

      let localFaceMatch = null;

      /*
       * Comparação facial com a fotografia do passaporte.
       */

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
          setCaptureState(
            "NÃO COMPATÍVEL"
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

      setCaptureState(
        "IDENTIDADE CONFIRMADA"
      );

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

      setCaptureState(
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
   * ----------------------------------------------------------
   * RESULTADO
   * ----------------------------------------------------------
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
          result?.score || 0
        ) * 100
      );

    const issues =
      Array.isArray(
        result?.issues
      )
        ? result.issues
        : [];

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
                ? "A identidade foi preparada para a próxima etapa da viagem."
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

          ${
            issues.length
              ? `
                <div class="identity-result-issues">
                  ${issues
                    .slice(0, 5)
                    .map(
                      issue =>
                        `<span>${escapeHtml(issue)}</span>`
                    )
                    .join("")}
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
   * ----------------------------------------------------------
   * BOTÃO EXTERNO
   * ----------------------------------------------------------
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

        let client = null;

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
   * ----------------------------------------------------------
   * BOTÃO DO DASHBOARD
   * ----------------------------------------------------------
   */

  function createDashboardButton() {
    const section =
      $("verificationSection");

    if (!section) {
      return;
    }

    if ($("identityLaunchButton")) {
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
        <span></span>
      </span>

      <span class="identity-launch-copy">

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
         * O clique já é a entrada na captura.
         *
         * Não existe um segundo "Iniciar".
         */
        openIdentityCenter();
      }
    );

    host.appendChild(
      button
    );
  }

  /*
   * ----------------------------------------------------------
   * SELEÇÃO
   * ----------------------------------------------------------
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
            getClientFromSelection();
        }

        if (
          id ===
          "identityClient"
        ) {
          selectedClient =
            getClientFromSelection();
        }

        if (
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
   * ----------------------------------------------------------
   * INICIALIZAÇÃO
   * ----------------------------------------------------------
   */

  function initialize() {
    attachLaunchButtons();

    attachClientSelection();

    setTimeout(
      createDashboardButton,
      600
    );
  }

  /*
   * ----------------------------------------------------------
   * API
   * ----------------------------------------------------------
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
