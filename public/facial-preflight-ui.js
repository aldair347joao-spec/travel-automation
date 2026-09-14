/*
 * TRAVEL AUTOMATION — FACIAL PREFLIGHT UI
 *
 * Interface para o pré-check facial local.
 *
 * IMPORTANTE:
 * - usa a câmera real;
 * - não simula webcam;
 * - não reproduz vídeo como câmera;
 * - não tenta contornar liveness;
 * - não substitui a verificação oficial da VFS;
 * - envia apenas métricas/resultados.
 */

(() => {
  "use strict";

  const $ = (id) =>
    document.getElementById(id);

  let selectedClient = null;
  let running = false;
  let completed = false;
  let saving = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getClientFromSelection() {
    const select =
      $("applicationClient");

    if (!select?.value) {
      return null;
    }

    return {
      id: select.value,

      name:
        select.options[
          select.selectedIndex
        ]?.textContent?.trim() ||
        "Cliente"
    };
  }

  function ensurePanel() {
    if ($("facialPreflightPanel")) {
      return $("facialPreflightPanel");
    }

    const applicationPanel =
      $("applicationSection");

    const form =
      $("applicationForm");

    if (!applicationPanel || !form) {
      return null;
    }

    const panel =
      document.createElement("section");

    panel.id =
      "facialPreflightPanel";

    panel.className =
      "facial-preflight-panel";

    panel.innerHTML = `
      <div class="facial-preflight-header">

        <div>
          <span class="facial-preflight-eyebrow">
            IDENTITY PRE-FLIGHT
          </span>

          <h3>
            Verificação facial de preparação
          </h3>

          <p>
            Vamos verificar localmente o enquadramento,
            iluminação, estabilidade e movimentos do rosto
            antes de avançar para a etapa oficial.
          </p>
        </div>

        <span
          id="facialPreflightState"
          class="facial-preflight-state"
        >
          AGUARDANDO
        </span>

      </div>


      <div class="facial-preflight-grid">

        <div class="facial-camera-card">

          <div class="facial-camera-stage">

            <video
              id="facialPreflightVideo"
              autoplay
              playsinline
              muted
            ></video>

            <div class="facial-camera-overlay">

              <div class="facial-guide-oval"></div>

              <div class="facial-guide-corners"></div>

            </div>

            <div
              id="facialPreflightLiveBadge"
              class="facial-live-badge"
            >
              CÂMERA DESATIVADA
            </div>

          </div>

          <div class="facial-camera-note">
            A câmera é analisada localmente.
            O servidor recebe apenas métricas e
            resultados da preparação.
          </div>

        </div>


        <div class="facial-preflight-controls">

          <div class="facial-client-chip">

            <span>CLIENTE</span>

            <strong id="facialPreflightClient">
              Nenhum cliente selecionado
            </strong>

          </div>


          <div class="facial-progress-head">

            <span id="facialPreflightStep">
              0 / 10
            </span>

            <span id="facialPreflightStepName">
              Preparação
            </span>

          </div>


          <div class="facial-progress-track">

            <div
              id="facialPreflightProgress"
              class="facial-progress-bar"
            ></div>

          </div>


          <div class="facial-instruction-card">

            <span>
              INSTRUÇÃO ATUAL
            </span>

            <strong
              id="facialPreflightInstruction"
            >
              Selecione um cliente para começar.
            </strong>

            <p
              id="facialPreflightStatus"
            >
              O sistema ainda não iniciou a câmera.
            </p>

          </div>


          <div class="facial-check-grid">

            <div
              id="facialCheckFace"
              class="facial-check"
            >
              <i></i>
              <span>Rosto detectado</span>
            </div>

            <div
              id="facialCheckSingle"
              class="facial-check"
            >
              <i></i>
              <span>Um único rosto</span>
            </div>

            <div
              id="facialCheckLight"
              class="facial-check"
            >
              <i></i>
              <span>Iluminação</span>
            </div>

            <div
              id="facialCheckFrame"
              class="facial-check"
            >
              <i></i>
              <span>Enquadramento</span>
            </div>

          </div>


          <div class="facial-preflight-actions">

            <button
              id="facialPreflightStart"
              class="primary-button"
              type="button"
              disabled
            >
              Iniciar verificação
              <span>→</span>
            </button>

            <button
              id="facialPreflightStop"
              class="secondary-button"
              type="button"
              hidden
            >
              Parar
            </button>

          </div>


          <div
            id="facialPreflightResult"
            class="facial-result"
            hidden
          ></div>

        </div>

      </div>
    `;

    /*
     * Colocamos o pré-check ANTES
     * do formulário de aplicação.
     */
    applicationPanel.insertBefore(
      panel,
      form
    );

    return panel;
  }


  function setCheck(
    id,
    state
  ) {
    const element =
      $(id);

    if (!element) {
      return;
    }

    element.classList.remove(
      "ok",
      "bad",
      "active"
    );

    if (state === true) {
      element.classList.add("ok");
    } else if (state === false) {
      element.classList.add("bad");
    } else {
      element.classList.add("active");
    }
  }


  function setState(
    text,
    type = "idle"
  ) {
    const element =
      $("facialPreflightState");

    if (!element) {
      return;
    }

    element.textContent =
      text;

    element.className =
      `facial-preflight-state ${type}`;
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


  function updateAnalysis(
    analysis
  ) {
    if (!analysis) {
      return;
    }

    setCheck(
      "facialCheckFace",
      analysis.faceDetected === true
    );

    setCheck(
      "facialCheckSingle",
      analysis.singleFace === true
    );

    setCheck(
      "facialCheckLight",
      Number(
        analysis.quality
          ?.brightnessScore || 0
      ) >= 0.55
    );

    const area =
      Number(
        analysis.faceArea ||
        analysis.boundingBox?.area ||
        0
      );

    const framing =
      area === 0 ||
      (
        area >= 0.08 &&
        area <= 0.72
      );

    setCheck(
      "facialCheckFrame",
      framing
    );
  }


  function updateProgress(
    progress
  ) {
    if (!progress) {
      return;
    }

    const current =
      Number(
        progress.current || 0
      );

    const total =
      Number(
        progress.total || 10
      );

    const percent =
      Math.max(
        0,
        Math.min(
          100,
          (current / total) * 100
        )
      );

    const step =
      $("facialPreflightStep");

    if (step) {
      step.textContent =
        `${Math.min(
          current,
          total
        )} / ${total}`;
    }

    const progressBar =
      $("facialPreflightProgress");

    if (progressBar) {
      progressBar.style.width =
        `${percent}%`;
    }

    const name =
      $("facialPreflightStepName");

    if (name) {
      name.textContent =
        progress.position ||
        "Preparação";
    }

    updateAnalysis(
      progress.analysis
    );
  }


  function showResult(
    result,
    backend = null
  ) {
    completed =
      Boolean(
        result?.passed
      );

    running = false;

    const box =
      $("facialPreflightResult");

    const applicationForm =
      $("applicationForm");

    if (!box) {
      return;
    }

    box.hidden = false;

    box.className =
      `facial-result ${
        completed
          ? "passed"
          : "needs-adjustment"
      }`;

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

    box.innerHTML = `
      <div class="facial-result-icon">
        ${completed ? "✓" : "!"}
      </div>

      <div>

        <strong>
          ${
            completed
              ? "Pré-verificação aprovada"
              : "Ainda precisa de ajustes"
          }
        </strong>

        <span>
          Qualidade geral: ${score}%
        </span>

        ${
          issues.length
            ? `
              <ul>
                ${issues
                  .slice(0, 5)
                  .map(
                    item =>
                      `<li>${escapeHtml(item)}</li>`
                  )
                  .join("")}
              </ul>
            `
            : `
              <p>
                As condições mínimas
                recomendadas foram atingidas.
              </p>
            `
        }

        <small>
          Isto não representa aprovação facial
          da VFS. É apenas uma etapa interna
          de preparação.
        </small>

      </div>
    `;

    if (applicationForm) {
      applicationForm.dataset.facialPreflight =
        completed
          ? "passed"
          : "requires_user";
    }

    const startButton =
      $("facialPreflightStart");

    if (startButton) {
      startButton.disabled =
        completed;

      startButton.innerHTML =
        completed
          ? "Pré-verificação concluída ✓"
          : "Tentar novamente →";
    }

    if (completed) {
      setState(
        "APROVADA",
        "success"
      );

      setStatus(
        "Preparação facial concluída. " +
        "A etapa oficial continuará separadamente."
      );
    } else {
      setState(
        "AJUSTES NECESSÁRIOS",
        "warning"
      );

      setStatus(
        "Corrija as orientações apresentadas " +
        "e execute novamente."
      );
    }

    if (
      backend?.preflight
        ?.passed
    ) {
      setStatus(
        "Resultado guardado no perfil do cliente."
      );
    }
  }


  async function saveResult() {
    if (
      saving ||
      !selectedClient ||
      !window.TravelFacialPreflight
    ) {
      return;
    }

    saving = true;

    const engine =
      window.TravelFacialPreflight;

    const result =
      engine.getResult();

    showResult(
      result
    );

    if (!result.passed) {
      saving = false;
      return;
    }

    try {
      const data =
        await engine.submitToBackend({
          clientId:
            selectedClient.id,

          passportMatch:
            null
        });

      /*
       * submitToBackend também dispara
       * onComplete. O callback abaixo
       * ignora o segundo evento através
       * da flag backend.
       */
      showResult(
        result,
        data
      );

    } catch (error) {
      console.error(
        "[FacialPreflightUI] backend",
        error
      );

      setState(
        "NÃO GUARDADA",
        "error"
      );

      setStatus(
        error.message ||
        "A captura foi concluída, " +
        "mas não foi possível guardar " +
        "o resultado."
      );

      if (
        $("facialPreflightStart")
      ) {
        $("facialPreflightStart")
          .disabled = false;
      }

    } finally {
      saving = false;
    }
  }


  async function startPreflight() {
    const client =
      getClientFromSelection();

    if (!client) {
      setStatus(
        "Selecione primeiro um cliente na aplicação."
      );

      setState(
        "AGUARDANDO",
        "idle"
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
        "O módulo facial ainda não foi carregado."
      );

      return;
    }

    selectedClient =
      client;

    running = true;
    completed = false;

    const startButton =
      $("facialPreflightStart");

    const stopButton =
      $("facialPreflightStop");

    if (startButton) {
      startButton.disabled = true;
    }

    if (stopButton) {
      stopButton.hidden = false;
    }

    if (
      $("facialPreflightClient")
    ) {
      $("facialPreflightClient")
        .textContent =
        client.name;
    }

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

          updateAnalysis(
            analysis
          );

          if (type === "error") {
            setState(
              "ERRO",
              "error"
            );
          } else if (
            type === "success"
          ) {
            setState(
              "ANALISANDO",
              "success"
            );
          } else {
            setState(
              "ANALISANDO",
              "active"
            );
          }
        },

        onProgress:
          updateProgress,

        onPosition: ({
          position,
          completed:
            count,
          total
        }) => {

          if (
            position?.instruction
          ) {
            const instruction =
              $("facialPreflightInstruction");

            if (instruction) {
              instruction.textContent =
                position.instruction;
            }
          }

          if (
            count !== undefined &&
            total
          ) {
            const step =
              $("facialPreflightStep");

            const progress =
              $("facialPreflightProgress");

            if (step) {
              step.textContent =
                `${count} / ${total}`;
            }

            if (progress) {
              progress.style.width =
                `${(
                  count / total
                ) * 100}%`;
            }
          }
        },

        /*
         * O primeiro onComplete é o
         * resultado local.
         *
         * Depois de guardar no backend,
         * submitToBackend dispara outro
         * onComplete com backend.
         *
         * Por isso ignoramos o segundo.
         */
        onComplete:
          async (result) => {

            if (
              result?.backend
            ) {
              return;
            }

            showResult(
              result
            );

            if (
              result?.passed
            ) {
              await saveResult();
            }
          },

        onError: () => {

          running = false;

          if (stopButton) {
            stopButton.hidden =
              true;
          }

          if (startButton) {
            startButton.disabled =
              false;
          }

          setState(
            "ERRO",
            "error"
          );
        }
      });

      await engine.start({
        clientId:
          client.id
      });

      const badge =
        $("facialPreflightLiveBadge");

      if (badge) {
        badge.textContent =
          "CÂMERA ATIVA";

        badge.classList.add(
          "active"
        );
      }

    } catch (error) {

      console.error(
        "[FacialPreflightUI]",
        error
      );

      running = false;

      if (startButton) {
        startButton.disabled =
          false;
      }

      if (stopButton) {
        stopButton.hidden =
          true;
      }

      setState(
        "NÃO DISPONÍVEL",
        "error"
      );

      setStatus(
        error.message ||
        "Não foi possível iniciar a câmera."
      );
    }
  }


  function stopPreflight() {
    if (
      window.TravelFacialPreflight
    ) {
      window.TravelFacialPreflight
        .stop();
    }

    running = false;

    const stopButton =
      $("facialPreflightStop");

    const startButton =
      $("facialPreflightStart");

    if (stopButton) {
      stopButton.hidden =
        true;
    }

    if (startButton) {
      startButton.disabled =
        !getClientFromSelection();
    }

    const badge =
      $("facialPreflightLiveBadge");

    if (badge) {
      badge.textContent =
        "CÂMERA DESATIVADA";

      badge.classList.remove(
        "active"
      );
    }

    setState(
      "INTERROMPIDA",
      "idle"
    );

    setStatus(
      "A verificação foi interrompida."
    );
  }


  function resetForClient() {
    selectedClient =
      getClientFromSelection();

    running = false;
    completed = false;
    saving = false;

    const form =
      $("applicationForm");

    if (form) {
      form.dataset.facialPreflight =
        "";
    }

    const result =
      $("facialPreflightResult");

    if (result) {
      result.hidden =
        true;
    }

    const progress =
      $("facialPreflightProgress");

    if (progress) {
      progress.style.width =
        "0%";
    }

    const step =
      $("facialPreflightStep");

    if (step) {
      step.textContent =
        "0 / 10";
    }

    const instruction =
      $("facialPreflightInstruction");

    if (instruction) {
      instruction.textContent =
        "Selecione um cliente para começar.";
    }

    const startButton =
      $("facialPreflightStart");

    if (startButton) {
      startButton.disabled =
        !selectedClient;
      startButton.innerHTML =
        "Iniciar verificação <span>→</span>";
    }

    if (
      $("facialPreflightClient")
    ) {
      $("facialPreflightClient")
        .textContent =
        selectedClient?.name ||
        "Nenhum cliente selecionado";
    }

    setState(
      "AGUARDANDO",
      "idle"
    );

    setStatus(
      selectedClient
        ? "Cliente selecionado. Inicie a pré-verificação."
        : "Selecione um cliente na aplicação."
    );
  }


  function setup() {
    const panel =
      ensurePanel();

    if (!panel) {
      return;
    }

    const select =
      $("applicationClient");

    const startButton =
      $("facialPreflightStart");

    const stopButton =
      $("facialPreflightStop");

    const applicationForm =
      $("applicationForm");

    select?.addEventListener(
      "change",
      resetForClient
    );

    startButton?.addEventListener(
      "click",
      startPreflight
    );

    stopButton?.addEventListener(
      "click",
      stopPreflight
    );

    /*
     * Bloqueia a criação da aplicação
     * enquanto a pré-verificação deste
     * cliente não estiver aprovada.
     *
     * Usa capture=true para executar
     * antes do handler existente
     * no app.js.
     */
    applicationForm?.addEventListener(
      "submit",
      (event) => {

        const client =
          getClientFromSelection();

        if (!client) {
          return;
        }

        if (
          applicationForm.dataset
            .facialPreflight !==
          "passed"
        ) {

          event.preventDefault();

          event.stopImmediatePropagation();

          setState(
            "BLOQUEADA",
            "warning"
          );

          setStatus(
            "Conclua a pré-verificação facial " +
            "deste cliente antes de iniciar a aplicação."
          );

          panel.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      },
      true
    );

    window.addEventListener(
      "beforeunload",
      () => {
        try {
          window
            .TravelFacialPreflight
            ?.stop();
        } catch (_) {}
      }
    );

    resetForClient();
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      setup,
      {
        once: true
      }
    );
  } else {
    setup();
  }

})();
