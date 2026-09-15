/*
 * ============================================================
 * TRAVEL AUTOMATION
 * IDENTITY CENTER — FACIAL PREFLIGHT UI
 * ============================================================
 *
 * Interface dedicada para preparação biométrica.
 *
 * IMPORTANTE:
 * - usa a câmera real;
 * - utiliza o motor TravelFacialPreflight existente;
 * - não simula câmera;
 * - não grava vídeo;
 * - não substitui a verificação oficial da VFS;
 * - trabalha com as 10 posições reais do motor;
 * - envia somente os resultados/métricas previstos pelo motor.
 * ============================================================
 */

(() => {
  "use strict";

  const $ = (id) =>
    document.getElementById(id);

  let selectedClient = null;
  let running = false;
  let saving = false;
  let completed = false;

  let overlay = null;

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
      "identity-center";

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
              IDENTITY CENTER
            </span>
          </div>

        </div>

        <div class="identity-operation">

          <span class="identity-live-dot"></span>

          <span>
            OPERAÇÃO BIOMÉTRICA
          </span>

        </div>

        <button
          id="identityClose"
          class="identity-close"
          type="button"
          aria-label="Fechar verificação"
        >
          ×
        </button>

      </header>


      <main class="identity-main">

        <div class="identity-heading">

          <div class="identity-heading-copy">

            <span class="identity-eyebrow">
              PREPARAÇÃO PARA VFS
            </span>

            <h1>
              Verificação de
              <strong>identidade</strong>
            </h1>

            <p>
              Complete os dez movimentos para preparar
              o cliente para a próxima etapa da operação.
            </p>

          </div>


          <div class="identity-client">

            <div class="identity-client-avatar">
              <span id="identityClientInitials">
                OP
              </span>
            </div>

            <div>

              <span>
                PASSAGEIRO
              </span>

              <strong id="identityClientName">
                Nenhum cliente
              </strong>

            </div>

          </div>

        </div>


        <section class="identity-workspace">


          <div class="identity-camera-column">

            <div class="identity-camera-shell">

              <div class="identity-camera-header">

                <div>

                  <span>
                    LIVE CAMERA
                  </span>

                  <strong id="identityCameraState">
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


                <div class="identity-camera-shade"></div>


                <div class="identity-face-guide">

                  <div
                    class="identity-face-oval"
                  ></div>

                  <div
                    class="identity-face-corners"
                  ></div>

                  <div
                    class="identity-face-scan"
                  ></div>

                </div>


                <div class="identity-camera-message">

                  <span
                    id="identityCameraMessage"
                  >
                    Prepare a câmera
                  </span>

                </div>


                <div class="identity-camera-status">

                  <div
                    id="identityFaceStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    Rosto
                  </div>

                  <div
                    id="identitySingleStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    Único
                  </div>

                  <div
                    id="identityLightStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    Luz
                  </div>

                  <div
                    id="identityFrameStatus"
                    class="identity-status-chip"
                  >
                    <i></i>
                    Enquadramento
                  </div>

                </div>

              </div>


              <div class="identity-camera-footer">

                <span>
                  A análise é feita localmente.
                </span>

                <span>
                  Nenhum vídeo é enviado.
                </span>

              </div>

            </div>

          </div>


          <aside class="identity-control-column">


            <div class="identity-progress-card">

              <div class="identity-progress-top">

                <div>

                  <span>
                    PROGRESSO
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


              <div class="identity-progress-track">

                <div
                  id="facialPreflightProgress"
                  class="identity-progress-fill"
                ></div>

              </div>


              <div
                id="identityPositionDots"
                class="identity-position-dots"
              ></div>

            </div>


            <div class="identity-instruction">

              <span>
                MOVIMENTO ATUAL
              </span>

              <div class="identity-instruction-number">
                <strong
                  id="identityCurrentNumber"
                >
                  01
                </strong>
              </div>

              <div>

                <strong
                  id="facialPreflightStepName"
                >
                  Preparação
                </strong>

                <p
                  id="facialPreflightInstruction"
                >
                  Selecione um cliente e inicie
                  a verificação.
                </p>

              </div>

              <div
                id="facialPreflightStatus"
                class="identity-status-message"
              >
                A câmera ainda não foi iniciada.
              </div>

            </div>


            <div class="identity-quality">

              <div class="identity-quality-header">

                <span>
                  QUALIDADE DA CAPTURA
                </span>

                <strong
                  id="identityQualityValue"
                >
                  — %
                </strong>

              </div>

              <div class="identity-quality-track">

                <div
                  id="identityQualityBar"
                  class="identity-quality-fill"
                ></div>

              </div>

              <small
                id="identityQualityText"
              >
                Aguardando análise
              </small>

            </div>


            <div class="identity-position-list">

              <div class="identity-position-list-header">
                <span>
                  SEQUÊNCIA BIOMÉTRICA
                </span>

                <small>
                  10 etapas
                </small>
              </div>

              <div
                id="identityPositionList"
              ></div>

            </div>


            <div class="identity-actions">

              <button
                id="facialPreflightStart"
                class="identity-primary-button"
                type="button"
                disabled
              >
                <span>
                  Iniciar verificação
                </span>

                <b>→</b>
              </button>

              <button
                id="facialPreflightStop"
                class="identity-secondary-button"
                type="button"
                hidden
              >
                Parar verificação
              </button>

            </div>


            <div class="identity-vfs-note">

              <span>VFS</span>

              <p>
                Esta é uma etapa interna de preparação.
                A verificação oficial da VFS permanece
                separada e não é realizada nesta tela.
              </p>

            </div>

          </aside>

        </section>


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

    buildPositionLists();

    bindOverlayEvents();

    return overlay;
  }


  function buildPositionLists() {
    const dots =
      $("identityPositionDots");

    const list =
      $("identityPositionList");

    if (dots) {
      dots.innerHTML =
        POSITIONS
          .map(
            (position, index) => `
              <div
                class="identity-dot"
                data-position-index="${index}"
                title="${escapeHtml(
                  position.short
                )}"
              >
                <span>
                  ${position.number}
                </span>
              </div>
            `
          )
          .join("");
    }

    if (list) {
      list.innerHTML =
        POSITIONS
          .map(
            (position, index) => `
              <div
                class="identity-position-row"
                data-position-row="${index}"
              >

                <div class="identity-position-icon">
                  ${position.number}
                </div>

                <div>
                  <strong>
                    ${escapeHtml(
                      position.short
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      position.title
                    )}
                  </span>
                </div>

                <i>
                  ○
                </i>

              </div>
            `
          )
          .join("");
    }
  }


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

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          overlay &&
          !overlay.classList.contains(
            "hidden"
          )
        ) {
          closeIdentityCenter();
        }
      }
    );
  }


  function openIdentityCenter(
    client = null
  ) {
    const target =
      client ||
      getClientFromSelection();

    if (!target) {
      if (
        typeof window.showToast ===
        "function"
      ) {
        window.showToast(
          "Selecione primeiro um cliente.",
          "error"
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
  }


  function closeIdentityCenter() {
    if (!overlay) {
      return;
    }

    if (running) {
      stopPreflight();
    }

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
      initials.textContent =
        selectedClient.name
          .split(/\s+/)
          .filter(Boolean)
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


  function resetInterface() {
    completed = false;
    saving = false;

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
      start.disabled = false;
      start.innerHTML = `
        <span>Iniciar verificação</span>
        <b>→</b>
      `;
    }

    const stop =
      $("facialPreflightStop");

    if (stop) {
      stop.hidden = true;
    }
  }


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
          ? "LIVE"
          : type === "error"
            ? "ERROR"
            : type === "warning"
              ? "CHECK"
              : "OFFLINE";

      badge.className =
        `identity-live-badge ${type}`;
    }
  }


  function setStatus(
    message
  ) {
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


  function setCameraState(
    active
  ) {
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
          ? "LIVE"
          : "OFFLINE";

      badge.className =
        `identity-live-badge ${
          active
            ? "success"
            : ""
        }`;
    }
  }


  function setAnalysis(
    analysis
  ) {
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
      element.querySelector(
        "i"
      );

    if (
      value === true
    ) {
      element.classList.add(
        "ok"
      );

      if (icon) {
        icon.textContent =
          "✓";
      }

      return;
    }

    if (
      value === false
    ) {
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
        "•";
    }
  }


  function updateProgress(
    progress
  ) {
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
      total
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
        `${Math.round(
          percent
        )}%`;
    }

    const currentPosition =
      progress.currentPosition ||
      progress.position ||
      POSITIONS[
        Math.max(
          0,
          safeCurrent - 1
        )
      ]?.id;

    const positionIndex =
      POSITIONS.findIndex(
        item =>
          item.id ===
          currentPosition
      );

    if (
      positionIndex >= 0
    ) {
      updateActivePosition(
        positionIndex
      );
    }

    const name =
      $("facialPreflightStepName");

    if (name) {
      const position =
        POSITIONS[
          Math.min(
            Math.max(
              0,
              safeCurrent
            ),
            POSITIONS.length - 1
          )
        ];

      name.textContent =
        progress.position ||
        position?.title ||
        "Preparação";
    }

    updateQuality(
      progress.analysis
    );

    setAnalysis(
      progress.analysis
    );
  }


  function updateActivePosition(
    activeIndex
  ) {
    const rows =
      document.querySelectorAll(
        "[data-position-row]"
      );

    rows.forEach(
      (row, index) => {
        row.classList.remove(
          "active",
          "completed"
        );

        const icon =
          row.querySelector(
            ".identity-position-icon"
          );

        const status =
          row.querySelector(
            "i"
          );

        if (
          index <
          activeIndex
        ) {
          row.classList.add(
            "completed"
          );

          if (icon) {
            icon.textContent =
              "✓";
          }

          if (status) {
            status.textContent =
              "✓";
          }

          return;
        }

        if (
          index ===
          activeIndex
        ) {
          row.classList.add(
            "active"
          );

          if (icon) {
            icon.textContent =
              POSITIONS[
                index
              ].number;
          }

          if (status) {
            status.textContent =
              "●";
          }

          return;
        }

        if (icon) {
          icon.textContent =
            POSITIONS[
              index
            ].number;
        }

        if (status) {
          status.textContent =
            "○";
        }
      }
    );

    const dots =
      document.querySelectorAll(
        "[data-position-index]"
      );

    dots.forEach(
      (dot, index) => {
        dot.classList.remove(
          "active",
          "completed"
        );

        if (
          index <
          activeIndex
        ) {
          dot.classList.add(
            "completed"
          );
        } else if (
          index ===
          activeIndex
        ) {
          dot.classList.add(
            "active"
          );
        }
      }
    );

    const current =
      POSITIONS[
        activeIndex
      ];

    if (current) {
      const number =
        $("identityCurrentNumber");

      const name =
        $("facialPreflightStepName");

      const instruction =
        $("facialPreflightInstruction");

      if (number) {
        number.textContent =
          current.number;
      }

      if (name) {
        name.textContent =
          current.title;
      }

      if (instruction) {
        instruction.textContent =
          current.instruction;
      }
    }
  }


  function updateQuality(
    analysis
  ) {
    if (!analysis) {
      const value =
        $("identityQualityValue");

      const bar =
        $("identityQualityBar");

      const text =
        $("identityQualityText");

      if (value) {
        value.textContent =
          "— %";
      }

      if (bar) {
        bar.style.width =
          "0%";
      }

      if (text) {
        text.textContent =
          "Aguardando análise";
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

    const framing =
      Number(
        analysis.faceArea ||
        0
      ) >= 0.08 &&
      Number(
        analysis.faceArea ||
        0
      ) <= 0.72
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
          "Qualidade excelente";
      } else if (
        safeScore >= 70
      ) {
        text.textContent =
          "Qualidade aceitável";
      } else {
        text.textContent =
          "Melhore as condições da câmera";
      }
    }
  }


  async function startPreflight() {
    const client =
      selectedClient ||
      getClientFromSelection();

    if (!client) {
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

    running = true;
    completed = false;

    const start =
      $("facialPreflightStart");

    const stop =
      $("facialPreflightStop");

    if (start) {
      start.disabled = true;
    }

    if (stop) {
      stop.hidden = false;
    }

    setState(
      "INICIALIZANDO",
      "warning"
    );

    setStatus(
      "A preparar a câmera e o motor facial..."
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
            type === "error"
          ) {
            setState(
              "ATENÇÃO",
              "error"
            );
          } else if (
            type === "success"
          ) {
            setState(
              "LIVE",
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
          completed: positionCompleted
        }) => {

          const index =
            POSITIONS.findIndex(
              item =>
                item.id ===
                position
            );

          if (
            index >= 0
          ) {
            updateActivePosition(
              index
            );
          }

          if (
            positionCompleted
          ) {
            updateActivePosition(
              Math.min(
                index + 1,
                POSITIONS.length - 1
              )
            );
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

            setState(
              "ERRO",
              "error"
            );

            setStatus(
              error?.message ||
              "Não foi possível concluir a análise."
            );
          }
      });

      await engine.start({
        clientId:
          client.id
      });

      setCameraState(
        true
      );

      setState(
        "LIVE",
        "success"
      );

      setStatus(
        "Câmera ativa. Posicione o rosto na área indicada."
      );

    } catch (error) {
      console.error(
        "[IdentityCenter] start",
        error
      );

      running = false;

      if (start) {
        start.disabled = false;
      }

      if (stop) {
        stop.hidden = true;
      }

      setState(
        "NÃO INICIADA",
        "error"
      );

      setStatus(
        error?.message ||
        "Não foi possível iniciar a câmera."
      );
    }
  }


  function stopPreflight() {
    try {
      window
        .TravelFacialPreflight
        ?.stop();
    } catch (error) {
      console.error(
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
      "A verificação foi interrompida."
    );

    const start =
      $("facialPreflightStart");

    const stop =
      $("facialPreflightStop");

    if (start) {
      start.disabled = false;
      start.innerHTML = `
        <span>Iniciar novamente</span>
        <b>→</b>
      `;
    }

    if (stop) {
      stop.hidden = true;
    }
  }


  async function handleComplete(
    result
  ) {
    running = false;

    completed =
      Boolean(
        result?.passed
      );

    setCameraState(
      false
    );

    if (completed) {
      setState(
        "APROVADA",
        "success"
      );

      setStatus(
        "As 10 posições foram concluídas."
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


  async function saveResult(
  result
) {

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

  if (
    !result?.passed
  ) {

    if (applicationForm) {
      applicationForm.dataset
        .facialPreflight =
        "failed";
    }

    saving = false;
    return;
  }

  try {

    const data =
      await window
        .TravelFacialPreflight
        .submitToBackend({
          clientId:
            selectedClient.id,

          passportMatch:
            null
        });

    if (
      data?.success !== true
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

    box.hidden = false;

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
              ? "IDENTITY READY"
              : "REPEAT REQUIRED"
          }
        </span>

        <h2>
          ${
            passed
              ? "Preparação concluída"
              : "Precisamos repetir a preparação"
          }
        </h2>

        <p>
          ${
            passed
              ? "O cliente completou as dez posições exigidas pelo pré-check facial."
              : "Foram encontradas condições que precisam de ser corrigidas antes de continuar."
          }
        </p>

        <div class="identity-result-score">

          <strong>
            ${score}%
          </strong>

          <span>
            qualidade geral
          </span>

        </div>

        ${
          issues.length
            ? `
              <div class="identity-result-issues">

                <strong>
                  Pontos a corrigir
                </strong>

                <ul>
                  ${issues
                    .slice(0, 6)
                    .map(
                      issue =>
                        `<li>${escapeHtml(
                          issue
                        )}</li>`
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

                <span>✓ 10/10 posições</span>
                <span>✓ Pré-check aprovado</span>
                <span>✓ Resultado guardado</span>

              </div>
            `
            : `
              <div class="identity-result-checks warning">

                <span>⚠ Corrija as orientações</span>
                <span>⚠ Execute novamente</span>

              </div>
            `
        }

        <small>
          A preparação facial é uma etapa interna.
          Isto não representa aprovação ou verificação oficial da VFS.
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
                  <span>Continuar operação</span>
                  <b>→</b>
                </button>
              `
              : `
                <button
                  id="identityRetryButton"
                  class="identity-primary-button"
                  type="button"
                >
                  <span>Repetir verificação</span>
                  <b>↻</b>
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
          () => {
            box.hidden = true;

            resetInterface();

            startPreflight();
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
          <span>✓ 10/10 posições</span>
          <span>✓ Pré-check aprovado</span>
          <span>✓ Resultado guardado</span>
        `;
      }
    }
  }


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
            client = {
              id:
                found.id ||
                found._id,

              name:
                found.fullName ||
                found.name ||
                "Cliente"
            };
          }
        }

        openIdentityCenter(
          client
        );
      }
    );
  }


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
        ◉
      </span>

      <span>
        <strong>
          Abrir Identity Center
        </strong>

        <small>
          Verificação facial em tela dedicada
        </small>
      </span>

      <b>
        →
      </b>
    `;

    button.addEventListener(
      "click",
      () => {
        openIdentityCenter();
      }
    );

    section
      .querySelector(
        ".verification-overview-main"
      )
      ?.appendChild(
        button
      );
  }


  function initialize() {
    attachLaunchButtons();

    document.addEventListener(
      "change",
      event => {
        if (
          event.target?.id ===
          "applicationClient"
        ) {
          selectedClient =
            getClientFromSelection();
        }
      }
    );

    setTimeout(
      createDashboardButton,
      600
    );
  }


  window.TravelIdentityCenter = {
    open: openIdentityCenter,
    close: closeIdentityCenter,
    reset: resetInterface
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
