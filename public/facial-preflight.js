/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT — MOTOR LOCAL
 * ============================================================
 *
 * Responsabilidades:
 *
 * - carregar FaceAPI local;
 * - carregar todos os modelos locais;
 * - ativar áudio orientado;
 * - abrir câmera frontal;
 * - detectar exatamente um rosto;
 * - verificar enquadramento;
 * - verificar iluminação;
 * - reconhecer 10 posições faciais;
 * - tolerar pequenas oscilações naturais;
 * - confirmar a posição depois de mantê-la;
 * - capturar cada posição;
 * - devolver resultado compatível com a UI atual;
 * - guardar resultado no backend.
 *
 * NÃO usa CDN.
 * NÃO envia vídeo para API externa.
 *
 * Arquivos esperados:
 *
 * /face-api/face-api.min.js
 * /models/
 *
 * ============================================================
 */

(() => {
  "use strict";

  const FACE_API_SCRIPT_URL =
    window.TRAVEL_FACE_API_SCRIPT_URL ||
    "/face-api/face-api.min.js";

  const FACE_API_MODEL_URL =
    window.TRAVEL_FACE_API_MODEL_URL ||
    "/models";

  const AUDIO_LANGUAGE = "pt-PT";

  /*
   * ==========================================================
   * POSIÇÕES
   * ==========================================================
   */

  const POSITIONS = [
    {
      id: "frontal",
      label: "Olhe diretamente para a câmera",
      instruction:
        "Olhe diretamente para a câmera e mantenha o rosto parado."
    },

    {
      id: "left",
      label: "Vire o rosto para a esquerda",
      instruction:
        "Vire lentamente o rosto para a esquerda."
    },

    {
      id: "right",
      label: "Vire o rosto para a direita",
      instruction:
        "Vire lentamente o rosto para a direita."
    },

    {
      id: "up",
      label: "Olhe para cima",
      instruction:
        "Levante lentamente o rosto e olhe para cima."
    },

    {
      id: "down",
      label: "Olhe para baixo",
      instruction:
        "Baixe lentamente o rosto e olhe para baixo."
    },

    {
      id: "left_up",
      label: "Esquerda e para cima",
      instruction:
        "Vire o rosto para a esquerda e olhe para cima."
    },

    {
      id: "right_up",
      label: "Direita e para cima",
      instruction:
        "Vire o rosto para a direita e olhe para cima."
    },

    {
      id: "left_down",
      label: "Esquerda e para baixo",
      instruction:
        "Vire o rosto para a esquerda e olhe para baixo."
    },

    {
      id: "right_down",
      label: "Direita e para baixo",
      instruction:
        "Vire o rosto para a direita e olhe para baixo."
    },

    {
      id: "smile",
      label: "Sorria",
      instruction:
        "Agora sorria e mantenha o sorriso por alguns segundos."
    }
  ];

  /*
   * ==========================================================
   * CONFIGURAÇÃO
   * ==========================================================
   *
   * A diferença principal desta versão está aqui:
   *
   * 1. A posição possui uma zona de entrada.
   * 2. Depois de entrar, existe uma zona de tolerância.
   * 3. Pequenas oscilações não cancelam imediatamente a posição.
   * 4. A posição precisa ser mantida por tempo suficiente.
   */

  const CONFIG = {
    detectorInputSize: 320,

    detectorScoreThreshold: 0.45,

    minFaceArea: 0.045,

    maxFaceArea: 0.78,

    idealFaceAreaMin: 0.10,

    idealFaceAreaMax: 0.58,

    minBrightness: 35,

    maxBrightness: 235,

    /*
     * Quantidade mínima de detecções boas.
     * Não é mais o único critério de estabilidade.
     */
    stableFramesRequired: 4,

    /*
     * Tempo real que a pessoa precisa manter a posição
     * depois que o movimento é reconhecido.
     */
    stableHoldMs: 850,

    /*
     * Tempo máximo permitido para encontrar a posição.
     */
    positionTimeoutMs: 15000,

    detectionIntervalMs: 120,

    /*
     * Mantemos o score geral atual relativamente acessível.
     */
    positionScoreThreshold: 0.60,

    overallScoreThreshold: 0.62,

    smileThreshold: 0.42,

    /*
     * Suavização do movimento.
     *
     * Valores menores = mais tolerância a pequenas oscilações.
     * Valores maiores = reação mais rápida.
     */
    poseSmoothingAlpha: 0.28,

    /*
     * Tolerância extra durante a manutenção.
     *
     * É propositalmente diferente da zona de entrada.
     */
    poseHoldTolerance: 0.095,

    /*
     * Margem para evitar que uma posição vizinha seja aceita.
     */
    directionalSeparation: 0.055,

    /*
     * Para diagonais, os dois eixos precisam estar corretos.
     */
    diagonalAxisWeight: 0.50,

    maxFaces: 1,

    cameraWidth: 1280,

    cameraHeight: 720,

    cameraFrameRate: 24
  };

  /*
   * ==========================================================
   * ESTADO
   * ==========================================================
   */

  let faceApi = null;

  let faceApiPromise = null;

  let modelsPromise = null;

  let stream = null;

  let videoElement = null;

  let canvasElement = null;

  let canvasContext = null;

  let clientId = null;

  let running = false;

  let processing = false;

  let animationFrame = null;

  let lastDetectionAt = 0;

  let currentPositionIndex = 0;

  let stableFrames = 0;

  let positionStartedAt = 0;

  let holdStartedAt = 0;

  let lastValidAt = 0;

  let completedPositions = [];

  let capturedPositions = [];

  let result = null;

  let callbacks = {};

  let initialized = false;

  let preferredPortugueseVoice = null;

  let audioReady = false;

  let speaking = false;

  /*
   * Pose suavizada.
   *
   * Não usamos a posição instantânea do detector diretamente
   * para decidir se a pessoa está estável.
   */
  let smoothedPose = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    initialized: false
  };

  /*
   * ==========================================================
   * CALLBACKS
   * ==========================================================
   */

  function safeCall(name, payload) {
    try {
      if (
        callbacks &&
        typeof callbacks[name] === "function"
      ) {
        callbacks[name](payload);
      }
    } catch (error) {
      console.error(
        "[FacialPreflight] callback error:",
        name,
        error
      );
    }
  }

  function setStatus(
    message,
    type = "info",
    analysis = null
  ) {
    safeCall("onStatus", {
      message: String(message || ""),
      type,
      analysis
    });
  }

  function emitError(message, error = null) {
    console.error(
      "[FacialPreflight]",
      message,
      error || ""
    );

    safeCall("onError", {
      message: String(message || ""),
      error
    });
  }

  /*
   * ==========================================================
   * UTILITÁRIOS
   * ==========================================================
   */

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(
        max,
        Number(value) || 0
      )
    );
  }

  function average(values) {
    if (
      !Array.isArray(values) ||
      !values.length
    ) {
      return 0;
    }

    return (
      values.reduce(
        (total, value) =>
          total + Number(value || 0),
        0
      ) / values.length
    );
  }

  /*
   * Interpolação suave.
   */
  function smoothValue(
    previous,
    current,
    alpha
  ) {
    return (
      previous +
      (current - previous) * alpha
    );
  }

  /*
   * ==========================================================
   * ÁUDIO ORIENTADO
   * ==========================================================
   */

  function selectPortugueseVoice() {
    if (
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return null;
    }

    try {
      const voices =
        window.speechSynthesis.getVoices();

      if (
        !voices ||
        !voices.length
      ) {
        return null;
      }

      return (
        voices.find(
          voice =>
            /^pt-PT$/i.test(
              voice.lang || ""
            )
        ) ||
        voices.find(
          voice =>
            /^pt-PT/i.test(
              voice.lang || ""
            )
        ) ||
        voices.find(
          voice =>
            /^pt/i.test(
              voice.lang || ""
            )
        ) ||
        null
      );
    } catch (_) {
      return null;
    }
  }

  function preparePortugueseVoice() {
    preferredPortugueseVoice =
      selectPortugueseVoice();

    if (
      preferredPortugueseVoice
    ) {
      audioReady = true;
    }

    try {
      if (
        "speechSynthesis" in
        window
      ) {
        window.speechSynthesis.addEventListener(
          "voiceschanged",
          () => {
            preferredPortugueseVoice =
              selectPortugueseVoice();

            if (
              preferredPortugueseVoice
            ) {
              audioReady = true;
            }
          },
          {
            once: false
          }
        );
      }
    } catch (_) {}
  }

  function speak(
    text,
    options = {}
  ) {
    if (
      !text ||
      !(
        "speechSynthesis" in
        window
      ) ||
      typeof SpeechSynthesisUtterance ===
        "undefined"
    ) {
      return false;
    }

    try {
      const synthesis =
        window.speechSynthesis;

      const utterance =
        new SpeechSynthesisUtterance(
          String(text)
        );

      utterance.lang =
        AUDIO_LANGUAGE;

      utterance.rate =
        Number(
          options.rate || 0.94
        );

      utterance.pitch = 1;

      utterance.volume = 1;

      const voice =
        preferredPortugueseVoice ||
        selectPortugueseVoice();

      if (voice) {
        utterance.voice = voice;
      }

      utterance.onstart = () => {
        speaking = true;
      };

      utterance.onend = () => {
        speaking = false;
      };

      utterance.onerror = event => {
        speaking = false;

        console.warn(
          "[FacialPreflight] TTS error:",
          event
        );
      };

      synthesis.cancel();

      try {
        synthesis.resume();
      } catch (_) {}

      synthesis.speak(
        utterance
      );

      audioReady = true;

      return true;
    } catch (error) {
      console.warn(
        "[FacialPreflight] Não foi possível reproduzir orientação:",
        error
      );

      return false;
    }
  }

  function primeAudio() {
    if (
      !(
        "speechSynthesis" in
        window
      ) ||
      typeof SpeechSynthesisUtterance ===
        "undefined"
    ) {
      console.warn(
        "[FacialPreflight] Speech Synthesis não disponível neste navegador."
      );

      return false;
    }

    try {
      preparePortugueseVoice();

      const synthesis =
        window.speechSynthesis;

      synthesis.cancel();

      try {
        synthesis.resume();
      } catch (_) {}

      const unlock =
        new SpeechSynthesisUtterance(
          " "
        );

      unlock.lang =
        "pt-PT";

      unlock.volume = 0;

      unlock.rate = 1;

      unlock.pitch = 1;

      synthesis.speak(
        unlock
      );

      const first =
        POSITIONS[0];

      if (first) {
        const utterance =
          new SpeechSynthesisUtterance(
            first.instruction
          );

        utterance.lang =
          "pt-PT";

        utterance.rate =
          0.90;

        utterance.pitch = 1;

        utterance.volume = 1;

        const voice =
          preferredPortugueseVoice ||
          selectPortugueseVoice();

        if (voice) {
          utterance.voice = voice;
        }

        utterance.onstart = () => {
          speaking = true;

          console.log(
            "[FacialPreflight] Áudio iniciado."
          );
        };

        utterance.onend = () => {
          speaking = false;
        };

        utterance.onerror = event => {
          speaking = false;

          console.error(
            "[FacialPreflight] Erro TTS:",
            event
          );
        };

        synthesis.speak(
          utterance
        );
      }

      audioReady = true;

      return true;
    } catch (error) {
      console.error(
        "[FacialPreflight] Falha ao iniciar áudio:",
        error
      );

      return false;
    }
  }

  function speakInstruction(text) {
    if (!text) {
      return;
    }

    speak(
      text,
      {
        rate: 0.94
      }
    );
  }

  function stopSpeech() {
    try {
      if (
        window.speechSynthesis
      ) {
        window.speechSynthesis.cancel();

        try {
          window.speechSynthesis.resume();
        } catch (_) {}
      }
    } catch (_) {}

    speaking = false;
  }

  /*
   * ==========================================================
   * FACE API
   * ==========================================================
   */

  async function loadFaceApi() {
    if (window.faceapi) {
      faceApi =
        window.faceapi;

      return faceApi;
    }

    if (faceApiPromise) {
      return faceApiPromise;
    }

    faceApiPromise =
      new Promise(
        (
          resolve,
          reject
        ) => {
          const existing =
            document.querySelector(
              "script[data-travel-face-api]"
            );

          if (existing) {
            if (window.faceapi) {
              faceApi =
                window.faceapi;

              resolve(
                faceApi
              );

              return;
            }

            existing.addEventListener(
              "load",
              () => {
                if (
                  window.faceapi
                ) {
                  faceApi =
                    window.faceapi;

                  resolve(
                    faceApi
                  );
                } else {
                  reject(
                    new Error(
                      "A biblioteca FaceAPI foi carregada, mas não ficou disponível."
                    )
                  );
                }
              },
              {
                once: true
              }
            );

            existing.addEventListener(
              "error",
              () => {
                reject(
                  new Error(
                    "Não foi possível carregar a biblioteca FaceAPI local."
                  )
                );
              },
              {
                once: true
              }
            );

            return;
          }

          const script =
            document.createElement(
              "script"
            );

          script.src =
            FACE_API_SCRIPT_URL;

          script.async = true;

          script.defer = true;

          script.dataset.travelFaceApi =
            "true";

          script.onload = () => {
            if (
              window.faceapi
            ) {
              faceApi =
                window.faceapi;

              resolve(
                faceApi
              );
            } else {
              reject(
                new Error(
                  "A biblioteca FaceAPI carregou, mas não ficou disponível."
                )
              );
            }
          };

          script.onerror = () => {
            reject(
              new Error(
                "Não foi possível carregar /face-api/face-api.min.js."
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      );

    try {
      return await faceApiPromise;
    } catch (error) {
      faceApiPromise = null;
      throw error;
    }
  }

  /*
   * ==========================================================
   * MODELOS
   * ==========================================================
   */

  async function verifyModel(filename) {
    const response =
      await fetch(
        `${FACE_API_MODEL_URL}/${filename}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `Modelo facial ausente: ${filename} — HTTP ${response.status}`
      );
    }

    return true;
  }

  async function loadModels() {
    if (modelsPromise) {
      return modelsPromise;
    }

    modelsPromise =
      (async () => {
        const api =
          await loadFaceApi();

        setStatus(
          "A verificar o motor facial local...",
          "info"
        );

        await verifyModel(
          "tiny_face_detector_model-weights_manifest.json"
        );

        await verifyModel(
          "face_landmark_68_model-weights_manifest.json"
        );

        await verifyModel(
          "face_expression_model-weights_manifest.json"
        );

        await verifyModel(
          "face_recognition_model-weights_manifest.json"
        );

        setStatus(
          "A carregar o detector facial...",
          "info"
        );

        await api.nets
          .tinyFaceDetector
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        setStatus(
          "A carregar os pontos faciais...",
          "info"
        );

        await api.nets
          .faceLandmark68Net
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        setStatus(
          "A carregar a análise de expressão...",
          "info"
        );

        await api.nets
          .faceExpressionNet
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        setStatus(
          "A preparar o reconhecimento facial...",
          "info"
        );

        await api.nets
          .faceRecognitionNet
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        console.info(
          "[FacialPreflight] Motor facial local carregado."
        );

        return true;
      })();

    try {
      return await modelsPromise;
    } catch (error) {
      modelsPromise = null;

      emitError(
        error?.message ||
          "Não foi possível carregar os modelos faciais.",
        error
      );

      throw error;
    }
  }

  /*
   * ==========================================================
   * CANVAS / VÍDEO
   * ==========================================================
   */

  function ensureCanvas() {
    if (!videoElement) {
      return;
    }

    if (!canvasElement) {
      canvasElement =
        document.createElement(
          "canvas"
        );

      canvasContext =
        canvasElement.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );
    }
  }

  function getVideoSize() {
    return {
      width:
        Number(
          videoElement?.videoWidth
        ) ||
        CONFIG.cameraWidth,

      height:
        Number(
          videoElement?.videoHeight
        ) ||
        CONFIG.cameraHeight
    };
  }

  function calculateBrightness() {
    if (
      !videoElement ||
      !videoElement.videoWidth
    ) {
      return 128;
    }

    ensureCanvas();

    const size =
      getVideoSize();

    const width = 160;

    const height =
      Math.max(
        90,
        Math.round(
          width *
            (
              size.height /
              size.width
            )
        )
      );

    canvasElement.width =
      width;

    canvasElement.height =
      height;

    canvasContext.drawImage(
      videoElement,
      0,
      0,
      width,
      height
    );

    const data =
      canvasContext
        .getImageData(
          0,
          0,
          width,
          height
        )
        .data;

    let total = 0;

    let count = 0;

    for (
      let i = 0;
      i < data.length;
      i += 16
    ) {
      total +=
        0.299 * data[i] +
        0.587 * data[i + 1] +
        0.114 * data[i + 2];

      count++;
    }

    return count
      ? total / count
      : 128;
  }

  function brightnessScore(
    brightness
  ) {
    if (
      brightness <
      CONFIG.minBrightness
    ) {
      return clamp(
        brightness /
          CONFIG.minBrightness,
        0,
        1
      );
    }

    if (
      brightness >
      CONFIG.maxBrightness
    ) {
      return clamp(
        (
          255 -
          brightness
        ) /
        (
          255 -
          CONFIG.maxBrightness
        ),
        0,
        1
      );
    }

    return 1;
  }

  /*
   * ==========================================================
   * GEOMETRIA
   * ==========================================================
   */

  function distance(a, b) {
    if (!a || !b) {
      return 0;
    }

    return Math.hypot(
      b.x - a.x,
      b.y - a.y
    );
  }

  function landmark(
    landmarks,
    index
  ) {
    return (
      landmarks?.positions?.[index] ||
      null
    );
  }

  /*
   * Calcula a pose bruta.
   *
   * O resultado é posteriormente suavizado.
   */
  function calculatePose(
    landmarks
  ) {
    const nose =
      landmark(
        landmarks,
        30
      );

    const leftEye =
      landmark(
        landmarks,
        36
      );

    const rightEye =
      landmark(
        landmarks,
        45
      );

    const forehead =
      landmark(
        landmarks,
        27
      );

    const chin =
      landmark(
        landmarks,
        8
      );

    if (
      !nose ||
      !leftEye ||
      !rightEye ||
      !forehead ||
      !chin
    ) {
      return {
        yaw: 0,
        pitch: 0,
        roll: 0
      };
    }

    const eyeCenterX =
      (
        leftEye.x +
        rightEye.x
      ) / 2;

    const eyeCenterY =
      (
        leftEye.y +
        rightEye.y
      ) / 2;

    const eyeDistance =
      distance(
        leftEye,
        rightEye
      ) || 1;

    const faceHeight =
      distance(
        forehead,
        chin
      ) || 1;

    return {
      yaw:
        (
          nose.x -
          eyeCenterX
        ) /
        eyeDistance,

      pitch:
        (
          nose.y -
          eyeCenterY
        ) /
        faceHeight,

      roll:
        (
          rightEye.y -
          leftEye.y
        ) /
        eyeDistance
    };
  }

  /*
   * ==========================================================
   * SUAVIZAÇÃO DA POSE
   * ==========================================================
   *
   * Este é um dos pontos mais importantes da correção.
   *
   * O detector pode produzir pequenas diferenças entre frames:
   *
   * frame 1: yaw = 0.29
   * frame 2: yaw = 0.34
   * frame 3: yaw = 0.30
   * frame 4: yaw = 0.33
   *
   * Isso não significa que a pessoa abandonou a posição.
   *
   * A pose suavizada evita que essas pequenas variações
   * reiniciem imediatamente a confirmação.
   */

  function updateSmoothedPose(
    rawPose
  ) {
    if (
      !rawPose
    ) {
      return {
        ...smoothedPose
      };
    }

    const alpha =
      CONFIG.poseSmoothingAlpha;

    if (
      !smoothedPose.initialized
    ) {
      smoothedPose = {
        yaw:
          Number(
            rawPose.yaw || 0
          ),

        pitch:
          Number(
            rawPose.pitch || 0
          ),

        roll:
          Number(
            rawPose.roll || 0
          ),

        initialized: true
      };

      return {
        ...smoothedPose
      };
    }

    smoothedPose.yaw =
      smoothValue(
        smoothedPose.yaw,
        Number(
          rawPose.yaw || 0
        ),
        alpha
      );

    smoothedPose.pitch =
      smoothValue(
        smoothedPose.pitch,
        Number(
          rawPose.pitch || 0
        ),
        alpha
      );

    smoothedPose.roll =
      smoothValue(
        smoothedPose.roll,
        Number(
          rawPose.roll || 0
        ),
        alpha
      );

    return {
      ...smoothedPose
    };
  }

  function resetSmoothedPose() {
    smoothedPose = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      initialized: false
    };
  }

  function smileScore(
    expressions
  ) {
    return clamp(
      Number(
        expressions?.happy ||
        0
      ),
      0,
      1
    );
  }

  function faceArea(
    detection
  ) {
    if (
      !detection?.box
    ) {
      return 0;
    }

    const size =
      getVideoSize();

    const total =
      size.width *
      size.height;

    if (!total) {
      return 0;
    }

    return clamp(
      (
        detection.box.width *
        detection.box.height
      ) /
      total,
      0,
      1
    );
  }

  function faceSizeScore(
    area
  ) {
    if (
      area <
      CONFIG.minFaceArea
    ) {
      return clamp(
        area /
          CONFIG.minFaceArea,
        0,
        1
      );
    }

    if (
      area >
      CONFIG.maxFaceArea
    ) {
      return clamp(
        CONFIG.maxFaceArea /
          area,
        0,
        1
      );
    }

    if (
      area >=
        CONFIG.idealFaceAreaMin &&
      area <=
        CONFIG.idealFaceAreaMax
    ) {
      return 1;
    }

    return 0.78;
  }

  /*
   * ==========================================================
   * ZONAS DE MOVIMENTO
   * ==========================================================
   *
   * Não basta ter um score alto.
   *
   * A direção precisa estar correta.
   *
   * Isso evita, por exemplo:
   *
   * esquerda -> ser confundida com frontal
   * esquerda -> ser confundida com esquerda/cima
   * cima -> ser confundida com diagonal
   *
   * Ao mesmo tempo, a zona possui tolerância suficiente para
   * permitir movimentos humanos naturais.
   */

  function axisDirectionScore(
    value,
    direction,
    enterMagnitude,
    tolerance
  ) {
    const numeric =
      Number(value || 0);

    const absolute =
      Math.abs(numeric);

    const expected =
      direction === "negative"
        ? -1
        : direction === "positive"
          ? 1
          : 0;

    /*
     * Movimento frontal.
     */
    if (
      direction === "center"
    ) {
      const limit =
        enterMagnitude +
        tolerance;

      return clamp(
        1 -
          absolute /
            Math.max(
              limit,
              0.001
            ),
        0,
        1
      );
    }

    /*
     * Verifica se a pessoa está efetivamente no lado correto.
     */
    if (
      numeric * expected <=
      0
    ) {
      return 0;
    }

    /*
     * Zona onde o movimento já é suficientemente claro.
     */
    const target =
      enterMagnitude;

    const distanceFromTarget =
      Math.abs(
        absolute -
        target
      );

    /*
     * Se já passou bastante do alvo, não penalizamos demais.
     *
     * Isto é importante porque uma pessoa pode virar um pouco
     * mais do que o necessário.
     */
    if (
      absolute >= target
    ) {
      return clamp(
        1 -
          Math.max(
            0,
            distanceFromTarget -
              tolerance
          ) /
          Math.max(
            target * 1.5,
            0.001
          ),
        0,
        1
      );
    }

    /*
     * Ainda está a caminho da posição.
     */
    return clamp(
      absolute /
        Math.max(
          target,
          0.001
        ),
      0,
      1
    );
  }

  function movementZone(
    positionId,
    yaw,
    pitch,
    smile
  ) {
    /*
     * Valores de entrada.
     *
     * São mais baixos do que os limites anteriores porque
     * queremos reconhecer o movimento antes de exigir a
     * manutenção.
     */

  const YAW =
  0.22;

 const PITCH =
  0.16;

    const tolerance =
      CONFIG.poseHoldTolerance;

    let yawDirection =
      "center";

    let pitchDirection =
      "center";

    switch (positionId) {
      case "frontal":
        yawDirection =
          "center";

        pitchDirection =
          "center";

        break;

      case "left":
        yawDirection =
          "negative";

        pitchDirection =
          "center";

        break;

      case "right":
        yawDirection =
          "positive";

        pitchDirection =
          "center";

        break;

      case "up":
        yawDirection =
          "center";

        pitchDirection =
          "negative";

        break;

      case "down":
        yawDirection =
          "center";

        pitchDirection =
          "positive";

        break;

      case "left_up":
        yawDirection =
          "negative";

        pitchDirection =
          "negative";

        break;

      case "right_up":
        yawDirection =
          "positive";

        pitchDirection =
          "negative";

        break;

      case "left_down":
        yawDirection =
          "negative";

        pitchDirection =
          "positive";

        break;

      case "right_down":
        yawDirection =
          "positive";

        pitchDirection =
          "positive";

        break;

      case "smile":
        yawDirection =
          "center";

        pitchDirection =
          "center";

        break;

      default:
        break;
    }

    const yawScore =
      axisDirectionScore(
        yaw,
        yawDirection,
        YAW,
        tolerance
      );

    const pitchScore =
      axisDirectionScore(
        pitch,
        pitchDirection,
        PITCH,
        tolerance
      );
     /*
 * ========================================================
 * DIAGONAIS SUPERIORES — ZONA MAIS NATURAL
 * ========================================================
 *
 * Para esquerda/cima e direita/cima, não exigimos que
 * a pessoa levante a cabeça tanto quanto numa posição
 * exclusivamente "para cima".
 *
 * O movimento horizontal continua sendo obrigatório.
 * O movimento vertical também continua obrigatório,
 * mas possui uma zona de entrada mais larga.
 *
 * Assim:
 *
 * esquerda + pequeno movimento para cima  -> reconhece
 * direita  + pequeno movimento para cima  -> reconhece
 *
 * sem permitir:
 *
 * esquerda pura -> esquerda/cima
 * direita pura  -> direita/cima
 */
let diagonalPitchScore =
  pitchScore;

const isUpperDiagonal =
  positionId === "left_up" ||
  positionId === "right_up";

if (isUpperDiagonal) {
  const upperDiagonalPitch =
    axisDirectionScore(
      pitch,
      "negative",
      0.135,
      0.105
    );

  /*
   * O eixo vertical fica ligeiramente mais tolerante,
   * mas nunca pode desaparecer completamente.
   */
  diagonalPitchScore =
    Math.max(
      pitchScore,
      upperDiagonalPitch * 0.92
    );

  /*
   * Não permitimos que um simples movimento lateral
   * seja confundido com uma diagonal superior.
   */
  if (
    Math.abs(Number(pitch || 0)) <
    0.085
  ) {
    diagonalPitchScore *=
      0.72;
  }
}
    let poseScore;

    const isDiagonal =
      positionId === "left_up" ||
      positionId === "right_up" ||
      positionId === "left_down" ||
      positionId === "right_down";

    if (isDiagonal) {
  /*
   * Nas diagonais superiores, a direção lateral continua
   * sendo a principal referência, enquanto o movimento
   * vertical precisa apenas estar claramente presente.
   *
   * Isso deixa esquerda+cima e direita+cima naturais,
   * sem transformar uma simples esquerda/direita numa
   * diagonal.
   */
  if (isUpperDiagonal) {
    poseScore =
      yawScore * 0.56 +
      diagonalPitchScore * 0.44;
  } else {
    poseScore =
      yawScore *
        CONFIG.diagonalAxisWeight +
      pitchScore *
        CONFIG.diagonalAxisWeight;
  }
} else {
      poseScore =
        yawScore * 0.50 +
        pitchScore * 0.50;
    }

    /*
     * Para frontal/simples, não queremos aceitar um eixo
     * claramente errado.
     */
    const yawAbs =
      Math.abs(
        Number(yaw || 0)
      );

    const pitchAbs =
      Math.abs(
        Number(pitch || 0)
      );

    if (
      positionId === "frontal"
    ) {
      if (
        yawAbs >
          0.24 ||
        pitchAbs >
          0.23
      ) {
        poseScore *= 0.35;
      }
    }

    /*
     * Para movimentos horizontais, uma inclinação vertical
     * muito grande significa que provavelmente estamos numa
     * diagonal.
     */
    if (
      positionId === "left" ||
      positionId === "right"
    ) {
      if (
        pitchAbs >
        0.25
      ) {
        poseScore *= 0.55;
      }
    }

    /*
     * Para cima/baixo, uma rotação horizontal grande indica
     * diagonal.
     */
    if (
      positionId === "up" ||
      positionId === "down"
    ) {
      if (
        yawAbs >
        0.30
      ) {
        poseScore *= 0.55;
      }
    }

    /*
     * Sorriso é tratado separadamente.
     */
    let smilePositionScore = 1;

    if (
      positionId === "smile"
    ) {
      smilePositionScore =
        clamp(
          Number(smile || 0) /
            CONFIG.smileThreshold,
          0,
          1
        );

      poseScore *=
        (
          yawScore *
          0.50 +
          pitchScore *
          0.50
        );
    }

    return {
      yawScore,
      pitchScore,
      poseScore,
      smilePositionScore
    };
  }

  /*
   * ==========================================================
   * AVALIAÇÃO
   * ==========================================================
   */

  function evaluate(
    position,
    pose,
    smile,
    area,
    brightness,
    detectorScore
  ) {
    const yaw =
      Number(
        pose?.yaw || 0
      );

    const pitch =
      Number(
        pose?.pitch || 0
      );

    const roll =
      Math.abs(
        Number(
          pose?.roll || 0
        )
      );

    const zone =
      movementZone(
        position.id,
        yaw,
        pitch,
        smile
      );

    const rollScore =
      1 -
      clamp(
        roll /
          0.30,
        0,
        1
      );

    const detector =
      clamp(
        detectorScore,
        0,
        1
      );

    const size =
      faceSizeScore(
        area
      );

    const light =
      brightnessScore(
        brightness
      );

    let score;

    if (
      position.id === "smile"
    ) {
      score =
        detector * 0.20 +
        zone.yawScore * 0.10 +
        zone.pitchScore * 0.10 +
        rollScore * 0.08 +
        zone.smilePositionScore * 0.38 +
        size * 0.07 +
        light * 0.07;
    } else {
      score =
        detector * 0.20 +
        zone.yawScore * 0.24 +
        zone.pitchScore * 0.21 +
        zone.poseScore * 0.08 +
        rollScore * 0.10 +
        size * 0.09 +
        light * 0.08;
    }

    /*
     * A posição não pode ser considerada correta apenas porque
     * o score global é bom.
     *
     * A zona direcional precisa também estar suficientemente
     * correta.
     */
    const movementRecognized =
      zone.poseScore >=
      0.66;

    const smileRecognized =
      position.id !== "smile" ||
      zone.smilePositionScore >=
        0.72;

    const qualityOkay =
      detector >= 0.45 &&
      size >= 0.55 &&
      light >= 0.55;

    const validPosition =
      movementRecognized &&
      smileRecognized &&
      qualityOkay &&
      score >=
        CONFIG.positionScoreThreshold;

    return {
      score:
        clamp(
          score,
          0,
          1
        ),

      yawScore:
        zone.yawScore,

      pitchScore:
        zone.pitchScore,

      poseScore:
        zone.poseScore,

      rollScore,

      smileScore:
        zone.smilePositionScore,

      faceSizeScore:
        size,

      brightnessScore:
        light,

      detectionScore:
        detector,

      movementRecognized,

      smileRecognized,

      qualityOkay,

      validPosition
    };
  }

  /*
   * ==========================================================
   * ANÁLISE PARA A UI
   * ==========================================================
   */

  function buildAnalysis(
    detection,
    evaluation,
    brightness,
    faceCount
  ) {
    const area =
      detection
        ? faceArea(
            detection.detection
          )
        : 0;

    return {
      faceDetected:
        Boolean(
          detection
        ),

      singleFace:
        faceCount === 1,

      faceCount,

      faceArea:
        area,

      detectionScore:
        Number(
          detection?.detection?.score ||
          0
        ),

      pose:
        detection
          ? updateSmoothedPose(
              calculatePose(
                detection.landmarks
              )
            )
          : {
              yaw: 0,
              pitch: 0,
              roll: 0
            },

      quality: {
        brightness,

        brightnessScore:
          brightnessScore(
            brightness
          ),

        sharpnessScore:
          0.85,

        faceSizeScore:
          evaluation
            ?.faceSizeScore ||
          0,

        detectionScore:
          evaluation
            ?.detectionScore ||
          0
      },

      positionScore:
        evaluation
          ?.score ||
        0,

      movementRecognized:
        Boolean(
          evaluation
            ?.movementRecognized
        ),

      holding:
        Boolean(
          holdStartedAt
        ),

      stableFrames
    };
  }

  /*
   * ==========================================================
   * CAPTURA
   * ==========================================================
   */

  function captureFrame() {
    if (
      !videoElement ||
      !videoElement.videoWidth
    ) {
      return null;
    }

    try {
      const canvas =
        document.createElement(
          "canvas"
        );

      const width =
        Math.min(
          720,
          videoElement.videoWidth
        );

      const ratio =
        videoElement.videoHeight /
        videoElement.videoWidth;

      canvas.width =
        width;

      canvas.height =
        Math.round(
          width * ratio
        );

      const ctx =
        canvas.getContext(
          "2d"
        );

      ctx.drawImage(
        videoElement,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return canvas.toDataURL(
        "image/jpeg",
        0.82
      );
    } catch (error) {
      console.warn(
        "[FacialPreflight] captura:",
        error
      );

      return null;
    }
  }

  /*
   * ==========================================================
   * CÂMERA
   * ==========================================================
   */

  async function startCamera() {
    if (!videoElement) {
      throw new Error(
        "Elemento de vídeo facial não encontrado."
      );
    }

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      throw new Error(
        "Este navegador não disponibiliza acesso à câmera. Abra o sistema em HTTPS."
      );
    }

    if (stream) {
      return stream;
    }

    setStatus(
      "A solicitar acesso à câmera...",
      "info"
    );

    try {
      stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: {
                ideal: "user"
              },

              width: {
                ideal:
                  CONFIG.cameraWidth
              },

              height: {
                ideal:
                  CONFIG.cameraHeight
              },

              frameRate: {
                ideal:
                  CONFIG.cameraFrameRate,

                max: 30
              }
            },

            audio: false
          }
        );
    } catch (error) {
      let message =
        "Não foi possível abrir a câmera.";

      if (
        error?.name ===
        "NotAllowedError"
      ) {
        message =
          "O acesso à câmera foi bloqueado. Autorize a câmera no navegador e tente novamente.";
      } else if (
        error?.name ===
        "NotFoundError"
      ) {
        message =
          "Nenhuma câmera compatível foi encontrada.";
      } else if (
        error?.name ===
        "NotReadableError"
      ) {
        message =
          "A câmera está sendo utilizada por outra aplicação.";
      } else if (
        error?.name ===
        "OverconstrainedError"
      ) {
        message =
          "A câmera não aceitou a resolução solicitada. Tentando uma configuração compatível...";

        try {
          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                video: true,
                audio: false
              }
            );
        } catch (fallbackError) {
          throw new Error(
            fallbackError?.message ||
              message
          );
        }

        return stream;
      }

      throw new Error(
        message
      );
    }

    videoElement.srcObject =
      stream;

    videoElement.autoplay = true;

    videoElement.muted = true;

    videoElement.playsInline = true;

    try {
      await videoElement.play();
    } catch (_) {}

    await waitForVideo();

    ensureCanvas();

    return stream;
  }

  function waitForVideo() {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        if (
          videoElement &&
          videoElement.readyState >= 2 &&
          videoElement.videoWidth
        ) {
          resolve();

          return;
        }

        const timeout =
          setTimeout(
            () => {
              cleanup();

              reject(
                new Error(
                  "A câmera não ficou pronta a tempo."
                )
              );
            },
            12000
          );

        const check = () => {
          if (
            videoElement &&
            videoElement.videoWidth
          ) {
            cleanup();

            resolve();
          }
        };

        const cleanup = () => {
          clearTimeout(
            timeout
          );

          videoElement?.removeEventListener(
            "loadedmetadata",
            check
          );

          videoElement?.removeEventListener(
            "canplay",
            check
          );

          videoElement?.removeEventListener(
            "playing",
            check
          );
        };

        videoElement?.addEventListener(
          "loadedmetadata",
          check
        );

        videoElement?.addEventListener(
          "canplay",
          check
        );

        videoElement?.addEventListener(
          "playing",
          check
        );
      }
    );
  }

  function stopCamera() {
    if (stream) {
      stream
        .getTracks()
        .forEach(
          track => {
            try {
              track.stop();
            } catch (_) {}
          }
        );
    }

    stream = null;

    if (videoElement) {
      try {
        videoElement.pause();
      } catch (_) {}

      videoElement.srcObject =
        null;
    }
  }

  /*
   * ==========================================================
   * INITIALIZE
   * ==========================================================
   */

  async function initialize(
    options = {}
  ) {
    /*
     * IMPORTANTE:
     *
     * Executado antes do primeiro await.
     */

    primeAudio();

    callbacks = {
      onStatus:
        options.onStatus ||
        callbacks.onStatus,

      onProgress:
        options.onProgress ||
        callbacks.onProgress,

      onPosition:
        options.onPosition ||
        callbacks.onPosition,

      onComplete:
        options.onComplete ||
        callbacks.onComplete,

      onError:
        options.onError ||
        callbacks.onError
    };

    if (
      options.videoElement
    ) {
      videoElement =
        options.videoElement;
    }

    if (
      options.clientId
    ) {
      clientId =
        options.clientId;
    }

    if (!videoElement) {
      throw new Error(
        "Elemento de vídeo facial não foi fornecido."
      );
    }

    try {
      setStatus(
        "A preparar o motor facial local...",
        "info"
      );

      await loadModels();

      initialized = true;

      setStatus(
        "Motor facial pronto. A preparar a câmera...",
        "success"
      );

      return true;
    } catch (error) {
      initialized = false;

      emitError(
        error?.message ||
          "Não foi possível preparar o motor facial.",
        error
      );

      throw error;
    }
  }

  /*
   * ==========================================================
   * RESET
   * ==========================================================
   */

  function reset() {
    running = false;

    processing = false;

    currentPositionIndex = 0;

    stableFrames = 0;

    positionStartedAt = 0;

    holdStartedAt = 0;

    lastValidAt = 0;

    lastDetectionAt = 0;

    completedPositions = [];

    capturedPositions = [];

    result = null;

    resetSmoothedPose();

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    stopSpeech();
  }

  /*
   * ==========================================================
   * START
   * ==========================================================
   */

  async function start(
    options = {}
  ) {
    if (
      options.clientId
    ) {
      clientId =
        options.clientId;
    }

    callbacks = {
      onStatus:
        options.onStatus ||
        callbacks.onStatus,

      onProgress:
        options.onProgress ||
        callbacks.onProgress,

      onPosition:
        options.onPosition ||
        callbacks.onPosition,

      onComplete:
        options.onComplete ||
        callbacks.onComplete,

      onError:
        options.onError ||
        callbacks.onError
    };

    reset();

    primeAudio();

    if (!initialized) {
      await initialize({
        videoElement:
          options.videoElement ||
          videoElement,

        clientId
      });
    } else if (
      options.videoElement
    ) {
      videoElement =
        options.videoElement;
    }

    await startCamera();

    running = true;

    currentPositionIndex = 0;

    positionStartedAt =
      Date.now();

    stableFrames = 0;

    holdStartedAt = 0;

    lastValidAt = 0;

    resetSmoothedPose();

    const first =
      POSITIONS[0];

    if (first) {
      setStatus(
        first.instruction,
        "instruction"
      );
    }

    emitProgress();

    animationFrame =
      requestAnimationFrame(
        processFrame
      );

    return true;
  }

  /*
   * ==========================================================
   * PROCESSAMENTO
   * ==========================================================
   */

  function processFrame(
    timestamp
  ) {
    if (!running) {
      return;
    }

    animationFrame =
      requestAnimationFrame(
        processFrame
      );

    if (processing) {
      return;
    }

    if (
      timestamp -
        lastDetectionAt <
      CONFIG.detectionIntervalMs
    ) {
      return;
    }

    lastDetectionAt =
      timestamp;

    processing = true;

    analyzeFrame()
      .catch(
        error => {
          console.warn(
            "[FacialPreflight] análise:",
            error
          );
        }
      )
      .finally(
        () => {
          processing = false;
        }
      );
  }

  /*
   * ==========================================================
   * RESET DA MANUTENÇÃO
   * ==========================================================
   *
   * Esta função é propositalmente diferente de reset().
   *
   * Se a pessoa perder ligeiramente a posição, não reiniciamos
   * toda a posição imediatamente.
   */

  function pauseHold() {
    /*
     * Guardamos a última vez em que a posição esteve correta.
     *
     * Isso permite pequenas falhas de um ou dois frames.
     */
    if (!lastValidAt) {
      lastValidAt =
        Date.now();
    }
  }

  function resetHoldCompletely() {
    stableFrames = 0;

    holdStartedAt = 0;

    lastValidAt = 0;
  }

  /*
   * Determina se uma pequena perda deve ser tolerada.
   */
  function shouldTolerateTemporaryLoss() {
    if (!holdStartedAt) {
      return false;
    }

    if (!lastValidAt) {
      return false;
    }

    return (
      Date.now() -
        lastValidAt <=
      650
    );
  }

  /*
   * ==========================================================
   * ANÁLISE DE FRAME
   * ==========================================================
   */

  async function analyzeFrame() {
    if (
      !running ||
      !faceApi ||
      !videoElement ||
      !videoElement.videoWidth
    ) {
      return;
    }

    const position =
      POSITIONS[
        currentPositionIndex
      ];

    if (!position) {
      await finish();

      return;
    }

    const brightness =
      calculateBrightness();

    const detections =
      await faceApi
        .detectAllFaces(
          videoElement,
          new faceApi.TinyFaceDetectorOptions(
            {
              inputSize:
                CONFIG.detectorInputSize,

              scoreThreshold:
                CONFIG.detectorScoreThreshold
            }
          )
        )
        .withFaceLandmarks()
        .withFaceExpressions();

    const faceCount =
      detections?.length || 0;

    /*
     * ======================================================
     * SEM ROSTO
     * ======================================================
     */

    if (!faceCount) {
      if (
        shouldTolerateTemporaryLoss()
      ) {
        pauseHold();

        setStatus(
          "Continue na mesma posição...",
          "instruction"
        );
      } else {
        resetHoldCompletely();

        const analysis = {
          faceDetected: false,

          singleFace: false,

          faceCount: 0,

          faceArea: 0,

          quality: {
            brightness,

            brightnessScore:
              brightnessScore(
                brightness
              ),

            sharpnessScore: 0
          }
        };

        setStatus(
          "Posicione o rosto dentro do enquadramento.",
          "warning",
          analysis
        );

        emitProgress(
          null,
          analysis
        );
      }

      return;
    }

    /*
     * ======================================================
     * MAIS DE UM ROSTO
     * ======================================================
     */

    if (
      faceCount >
      CONFIG.maxFaces
    ) {
      resetHoldCompletely();

      const analysis = {
        faceDetected: true,

        singleFace: false,

        faceCount,

        faceArea: 0,

        quality: {
          brightness,

          brightnessScore:
            brightnessScore(
              brightness
            ),

          sharpnessScore: 0.6
        }
      };

      setStatus(
        "Deixe apenas uma pessoa diante da câmera.",
        "warning",
        analysis
      );

      emitProgress(
        null,
        analysis
      );

      return;
    }

    /*
     * ======================================================
     * ROSTO ÚNICO
     * ======================================================
     */

    const detection =
      detections[0];

    /*
     * Pose bruta.
     */
    const rawPose =
      calculatePose(
        detection.landmarks
      );

    /*
     * Pose suavizada.
     *
     * É esta que usamos para a decisão.
     */
    const pose =
      updateSmoothedPose(
        rawPose
      );

    const smile =
      smileScore(
        detection.expressions
      );

    const area =
      faceArea(
        detection.detection
      );

    const evaluation =
      evaluate(
        position,
        pose,
        smile,
        area,
        brightness,
        detection.detection.score
      );

    const analysis =
      buildAnalysis(
        detection,
        evaluation,
        brightness,
        faceCount
      );

    /*
     * ======================================================
     * QUALIDADE BÁSICA
     * ======================================================
     */

    if (
      evaluation.brightnessScore <
      0.55
    ) {
      /*
       * Não destruímos imediatamente o hold.
       *
       * Uma pequena mudança de luz não significa que a
       * pessoa abandonou a posição.
       */
      if (
        holdStartedAt &&
        shouldTolerateTemporaryLoss()
      ) {
        pauseHold();
      } else {
        resetHoldCompletely();
      }

      setStatus(
        "Melhore a iluminação do rosto.",
        "warning",
        analysis
      );

      emitProgress(
        evaluation,
        analysis
      );

      return;
    }

    if (
      evaluation.faceSizeScore <
      0.55
    ) {
      if (
        holdStartedAt &&
        shouldTolerateTemporaryLoss()
      ) {
        pauseHold();
      } else {
        resetHoldCompletely();
      }

      setStatus(
        area <
          CONFIG.idealFaceAreaMin
          ? "Aproxime um pouco o rosto da câmera."
          : "Afaste ligeiramente o rosto da câmera.",
        "warning",
        analysis
      );

      emitProgress(
        evaluation,
        analysis
      );

      return;
    }

    /*
     * ======================================================
     * SORRISO
     * ======================================================
     */

    if (
      position.id === "smile" &&
      evaluation.smileScore <
        0.45
    ) {
      if (
        holdStartedAt &&
        shouldTolerateTemporaryLoss()
      ) {
        pauseHold();
      } else {
        resetHoldCompletely();
      }

      setStatus(
        "Sorria para completar esta posição.",
        "instruction",
        analysis
      );

      emitProgress(
        evaluation,
        analysis
      );

      return;
    }

    /*
     * ======================================================
     * MOVIMENTO CORRETO
     * ======================================================
     *
     * Aqui acontece a separação entre:
     *
     * "reconheci o movimento"
     *
     * e
     *
     * "confirmei que a pessoa manteve o movimento".
     */

    if (
      evaluation.validPosition
    ) {
      const now =
        Date.now();

      /*
       * Primeira vez que entramos na zona correta.
       */
      if (!holdStartedAt) {
        holdStartedAt = now;
      }

      /*
       * Atualizamos o último instante válido.
       */
      lastValidAt = now;

      stableFrames += 1;

      const holdElapsed =
        now -
        holdStartedAt;

      /*
       * ====================================================
       * MOVIMENTO RECONHECIDO
       * ====================================================
       */

      if (
        holdElapsed <
        CONFIG.stableHoldMs
      ) {
        const remaining =
          Math.max(
            0,
            CONFIG.stableHoldMs -
              holdElapsed
          );

        setStatus(
          `Movimento reconhecido. Mantenha esta posição por mais ${Math.ceil(
            remaining / 100
          ) / 10}s.`,
          "success",
          analysis
        );

        emitProgress(
          evaluation,
          analysis
        );

        return;
      }

      /*
       * ====================================================
       * CONFIRMAÇÃO
       * ====================================================
       *
       * Agora temos:
       *
       * - movimento correto;
       * - qualidade aceitável;
       * - vários frames bons;
       * - tempo suficiente de manutenção.
       */

      if (
        stableFrames >=
        CONFIG.stableFramesRequired
      ) {
        setStatus(
          "Posição confirmada.",
          "success",
          analysis
        );

        emitProgress(
          evaluation,
          analysis
        );

        await completePosition(
          evaluation,
          analysis
        );

        return;
      }

      setStatus(
        "Muito bem. Continue na mesma posição.",
        "success",
        analysis
      );

      emitProgress(
        evaluation,
        analysis
      );

      return;
    }

    /*
     * ======================================================
     * PEQUENA OSCILAÇÃO
     * ======================================================
     *
     * Este é o comportamento novo mais importante.
     *
     * Se a pessoa já estava corretamente posicionada e o
     * detector variar um pouco, não destruímos imediatamente
     * a confirmação.
     */

    if (
      holdStartedAt &&
      shouldTolerateTemporaryLoss()
    ) {
      pauseHold();

      setStatus(
        "Continue na mesma posição...",
        "instruction",
        analysis
      );

      emitProgress(
        evaluation,
        analysis
      );

      return;
    }

    /*
     * ======================================================
     * MOVIMENTO AINDA NÃO CORRETO
     * ======================================================
     */

    resetHoldCompletely();

    let message =
      position.instruction;

    let statusType =
      "instruction";

    if (
      position.id ===
        "left" &&
      pose.yaw >
        -0.10
    ) {
      message =
        "Vire um pouco mais o rosto para a esquerda.";
    }

    if (
      position.id ===
        "right" &&
      pose.yaw <
        0.10
    ) {
      message =
        "Vire um pouco mais o rosto para a direita.";
    }

    if (
      position.id ===
        "up" &&
      pose.pitch >
        -0.08
    ) {
      message =
        "Levante um pouco mais o rosto.";
    }

    if (
      position.id ===
        "down" &&
      pose.pitch <
        0.08
    ) {
      message =
        "Baixe um pouco mais o rosto.";
    }

    if (
      position.id ===
        "left_up"
    ) {
      if (
        pose.yaw >
        -0.10
      ) {
        message =
          "Vire um pouco mais para a esquerda e depois olhe para cima.";
      } else if (
        pose.pitch >
        -0.08
      ) {
        message =
          "Agora olhe um pouco mais para cima.";
      }
    }

    if (
      position.id ===
        "right_up"
    ) {
      if (
        pose.yaw <
        0.10
      ) {
        message =
          "Vire um pouco mais para a direita e depois olhe para cima.";
      } else if (
        pose.pitch >
        -0.08
      ) {
        message =
          "Agora olhe um pouco mais para cima.";
      }
    }

    if (
      position.id ===
        "left_down"
    ) {
      if (
        pose.yaw >
        -0.10
      ) {
        message =
          "Vire um pouco mais para a esquerda e depois olhe para baixo.";
      } else if (
        pose.pitch <
        0.08
      ) {
        message =
          "Agora olhe um pouco mais para baixo.";
      }
    }

    if (
      position.id ===
        "right_down"
    ) {
      if (
        pose.yaw <
        0.10
      ) {
        message =
          "Vire um pouco mais para a direita e depois olhe para baixo.";
      } else if (
        pose.pitch <
        0.08
      ) {
        message =
          "Agora olhe um pouco mais para baixo.";
      }
    }

    /*
     * Frontal.
     */
    if (
      position.id ===
        "frontal"
    ) {
      if (
        Math.abs(
          pose.yaw
        ) >
        0.12
      ) {
        message =
          "Volte lentamente o rosto para o centro.";
      } else if (
        Math.abs(
          pose.pitch
        ) >
        0.12
      ) {
        message =
          "Volte lentamente o rosto para a posição frontal.";
      }
    }

    setStatus(
      message,
      statusType,
      analysis
    );

    emitProgress(
      evaluation,
      analysis
    );

    /*
     * ======================================================
     * TIMEOUT
     * ======================================================
     */

    if (
      Date.now() -
        positionStartedAt >
      CONFIG.positionTimeoutMs
    ) {
      resetHoldCompletely();

      positionStartedAt =
        Date.now();

      resetSmoothedPose();

      speakInstruction(
        position.instruction
      );
    }
  }

  /*
   * ==========================================================
   * COMPLETAR POSIÇÃO
   * ==========================================================
   */

  async function completePosition(
    evaluation,
    analysis
  ) {
    const position =
      POSITIONS[
        currentPositionIndex
      ];

    if (
      !position ||
      !running
    ) {
      return;
    }

    /*
     * Impede dupla confirmação.
     */
    stableFrames = 0;

    holdStartedAt = 0;

    lastValidAt = 0;

    completedPositions.push(
      position.id
    );

    capturedPositions.push({
      position:
        position.id,

      label:
        position.label,

      score:
        Number(
          evaluation.score.toFixed(
            4
          )
        ),

      capturedAt:
        new Date().toISOString(),

      image:
        captureFrame()
    });

    safeCall(
      "onPosition",
      {
        completed: true,

        completedCount:
          completedPositions.length,

        total:
          POSITIONS.length,

        position:
          position.id,

        positionData: {
          id:
            position.id,

          label:
            position.label
        },

        score:
          evaluation.score,

        analysis
      }
    );

    const nextIndex =
      currentPositionIndex +
      1;

    if (
      nextIndex >=
      POSITIONS.length
    ) {
      await finish();

      return;
    }

    currentPositionIndex =
      nextIndex;

    positionStartedAt =
      Date.now();

    resetSmoothedPose();

    const next =
      POSITIONS[
        currentPositionIndex
      ];

    if (next) {
      setStatus(
        next.instruction,
        "instruction"
      );

      speakInstruction(
        next.instruction
      );
    }

    emitProgress();
  }

  /*
   * ==========================================================
   * PROGRESSO
   * ==========================================================
   */

  function emitProgress(
    evaluation = null,
    analysis = null
  ) {
    const completed =
      completedPositions.length;

    const total =
      POSITIONS.length;

    safeCall(
      "onProgress",
      {
        completed,

        total,

        progress:
          Math.round(
            (
              completed /
              total
            ) * 100
          ),

        currentPosition:
          POSITIONS[
            currentPositionIndex
          ]?.id ||
          null,

        currentPositionIndex,

        evaluation,

        analysis
      }
    );
  }

  /*
   * ==========================================================
   * FINALIZAÇÃO
   * ==========================================================
   */

  async function finish() {
    running = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    const scores =
      capturedPositions.map(
        item =>
          Number(
            item.score || 0
          )
      );

    const score =
      average(
        scores
      );

    const completed =
      completedPositions.length ===
      POSITIONS.length;

    const success =
      completed &&
      score >=
        CONFIG.overallScoreThreshold;

    result = {
      completed,

      success,

      passed:
        success,

      clientId,

      completedCount:
        completedPositions.length,

      total:
        POSITIONS.length,

      score:
        Number(
          score.toFixed(
            4
          )
        ),

      positions:
        capturedPositions,

      completedPositions:
        completedPositions.slice(),

      audioReady,

      completedAt:
        new Date().toISOString()
    };

    if (success) {
      setStatus(
        "As dez posições foram concluídas.",
        "success"
      );
    } else {
      setStatus(
        "A preparação facial não atingiu todos os critérios.",
        "warning"
      );
    }

    safeCall(
      "onComplete",
      result
    );

    return result;
  }

  /*
   * ==========================================================
   * STOP
   * ==========================================================
   */

  function stop() {
    running = false;

    processing = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    stopSpeech();

    stopCamera();

    resetSmoothedPose();
  }

  /*
   * ==========================================================
   * BACKEND
   * ==========================================================
   */

  async function submitToBackend(
    payload = {}
  ) {
    const targetClientId =
      payload.clientId ||
      clientId;

    if (!targetClientId) {
      throw new Error(
        "ID do cliente não encontrado."
      );
    }

    if (!result) {
      throw new Error(
        "Não existe resultado facial para guardar."
      );
    }

    const body = {
      clientId:
        targetClientId,

      completed:
        Boolean(
          result.completed
        ),

      success:
        Boolean(
          result.success
        ),

      passed:
        Boolean(
          result.passed
        ),

      score:
        result.score,

      completedCount:
        result.completedCount,

      total:
        result.total,

      positions:
        result.positions,

      passportMatch:
        payload.passportMatch ||
        null,

      facialResult:
        result
    };

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          targetClientId
        )}/facial-preflight`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          credentials:
            "include",

          body:
            JSON.stringify(
              body
            )
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => null
        );

    if (
      !response.ok
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        `O servidor recusou o resultado facial. HTTP ${response.status}`
      );
    }

    return data;
  }

  /*
   * ==========================================================
   * ESTADO
   * ==========================================================
   */

  function getResult() {
    return result;
  }

  function getPositions() {
    return POSITIONS.map(
      position => ({
        ...position
      })
    );
  }

  function isReady() {
    return Boolean(
      initialized &&
      faceApi
    );
  }

  function getState() {
    return {
      initialized,

      running,

      audioReady,

      speaking,

      clientId,

      currentPosition:
        POSITIONS[
          currentPositionIndex
        ]?.id ||
        null,

      currentPositionIndex,

      completedCount:
        completedPositions.length,

      total:
        POSITIONS.length,

      result,

      stability: {
        stableFrames,

        stableFramesRequired:
          CONFIG.stableFramesRequired,

        holdStartedAt,

        stableHoldMs:
          CONFIG.stableHoldMs,

        poseSmoothingAlpha:
          CONFIG.poseSmoothingAlpha,

        poseHoldTolerance:
          CONFIG.poseHoldTolerance
      }
    };
  }

  /*
   * ==========================================================
   * API GLOBAL
   * ==========================================================
   */

  window.TravelFacialPreflight = {
    initialize,

    start,

    stop,

    reset,

    finish,

    submitToBackend,

    getResult,

    getPositions,

    getState,

    isReady,

    speak,

    primeAudio,

    constants: {
      AUDIO_LANGUAGE,

      POSITIONS,

      CONFIG,

      FACE_API_SCRIPT_URL,

      FACE_API_MODEL_URL
    }
  };

  console.info(
    "[FacialPreflight] Motor facial local disponível."
  );
})();
