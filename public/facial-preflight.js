/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT — MOTOR LOCAL
 * ============================================================
 *
 * - FaceAPI local
 * - 10 posições de liveness
 * - áudio em português
 * - câmera frontal
 * - detecção de rosto único
 * - validação de enquadramento
 * - validação de iluminação
 * - validação de pose
 * - gravação SOMENTE das posições corretas
 * - nenhum vídeo externo
 * - nenhum reconhecimento facial contra o passaporte
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
   * MAPA CANÓNICO DAS POSIÇÕES
   * ==========================================================
   *
   * O motor facial continua a trabalhar com IDs textuais.
   * O backend trabalha exclusivamente com posições 1..10.
   *
   * Nunca enviar "frontal", "left", "right", etc. para a API.
   */

  const LIVENESS_POSITION_NUMBER = {
    frontal: 1,
    left: 2,
    right: 3,
    up: 4,
    down: 5,
    left_up: 6,
    right_up: 7,
    left_down: 8,
    right_down: 9,
    smile: 10
  };

  function getCanonicalPositionNumber(
    positionId
  ) {
    const number =
      LIVENESS_POSITION_NUMBER[
        String(positionId || "")
      ];

    return Number.isInteger(number)
      ? number
      : null;
  }
  const CONFIG = {
    detectorInputSize: 320,
    detectorScoreThreshold: 0.45,

    minFaceArea: 0.045,
    maxFaceArea: 0.78,

    idealFaceAreaMin: 0.10,
    idealFaceAreaMax: 0.58,

    minBrightness: 35,
    maxBrightness: 235,

    stableFramesRequired: 5,
    detectionIntervalMs: 120,

    positionScoreThreshold: 0.64,
    overallScoreThreshold: 0.62,
    smileThreshold: 0.42,

    positionTimeoutMs: 15000,

    maxFaces: 1,

    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFrameRate: 24,

    /*
     * A gravação de uma posição só começa quando
     * a posição já está tecnicamente correta.
     *
     * Assim, movimentos errados nunca entram
     * no vídeo final.
     */
    recordingTimesliceMs: 250,

    /*
     * Pequena margem para garantir que o segmento
     * correto tenha dados suficientes.
     */
    minimumVideoSegmentBytes: 500
  };

  let faceApi = null;
  let faceApiPromise = null;
  let modelsPromise = null;

  let stream = null;
  let videoElement = null;

  let canvasElement = null;
  let canvasContext = null;

  let clientId = null;
  let sessionId = null;

  let running = false;
  let processing = false;
  let animationFrame = null;

  let lastDetectionAt = 0;

  let currentPositionIndex = 0;
  let stableFrames = 0;
  let positionStartedAt = 0;

  let completedPositions = [];
  let capturedPositions = [];

  let result = null;

  let callbacks = {};

  let initialized = false;

  let preferredPortugueseVoice = null;
  let audioReady = false;
  let speaking = false;

  /*
   * ==========================================================
   * GRAVAÇÃO SELETIVA DE LIVENESS
   * ==========================================================
   *
   * NÃO gravamos a sessão inteira.
   *
   * Para cada posição:
   *
   * 1. score ainda errado
   *    -> nenhum vídeo é guardado
   *
   * 2. score entra no nível correto
   *    -> começa a gravação
   *
   * 3. posição continua correta
   *    -> grava
   *
   * 4. posição perde a condição correta antes
   *    de completar os frames necessários
   *    -> segmento é DESCARTADO
   *
   * 5. posição completa
   *    -> segmento é guardado
   *
   * Resultado:
   * apenas os 10 movimentos aprovados chegam
   * à Administração.
   */

  let activePositionRecorder = null;
  let activePositionChunks = [];
  let activePositionRecordingStartedAt = null;
  let activePositionRecordingMimeType = null;
  let activePositionRecordingId = null;

  let videoSegments = [];

  let videoRecordingAvailable = false;
  let videoRecordingSupported = false;

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

  function createSessionId() {
    try {
      if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
      ) {
        return crypto.randomUUID();
      }
    } catch (_) {}

    return (
      "liveness-" +
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 12)
    );
  }

  /*
   * ==========================================================
   * ÁUDIO
   * ==========================================================
   */

  function selectPortugueseVoice() {
    if (
      !("speechSynthesis" in window)
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
        "speechSynthesis" in window
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
      !("speechSynthesis" in window) ||
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
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance ===
        "undefined"
    ) {
      return false;
    }

    try {
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

      unlock.lang = "pt-PT";
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

        utterance.rate = 0.90;
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

        utterance.onerror = () => {
          speaking = false;
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

    speak(text, {
      rate: 0.94
    });
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
      faceApi = window.faceapi;
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

              resolve(faceApi);
              return;
            }

            existing.addEventListener(
              "load",
              () => {
                if (window.faceapi) {
                  faceApi =
                    window.faceapi;

                  resolve(faceApi);
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
            if (window.faceapi) {
              faceApi =
                window.faceapi;

              resolve(faceApi);
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

        await api.nets.tinyFaceDetector.loadFromUri(
          FACE_API_MODEL_URL
        );

        setStatus(
          "A carregar os pontos faciais...",
          "info"
        );

        await api.nets.faceLandmark68Net.loadFromUri(
          FACE_API_MODEL_URL
        );

        setStatus(
          "A carregar a análise de expressão...",
          "info"
        );

        await api.nets.faceExpressionNet.loadFromUri(
          FACE_API_MODEL_URL
        );

        setStatus(
          "A preparar o reconhecimento facial...",
          "info"
        );

        await api.nets.faceRecognitionNet.loadFromUri(
          FACE_API_MODEL_URL
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
   * CANVAS
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
            willReadFrequently: true
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

    canvasElement.width = width;
    canvasElement.height = height;

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

  function smileScore(
    expressions
  ) {
    return clamp(
      Number(
        expressions?.happy || 0
      ),
      0,
      1
    );
  }

  function faceArea(
    detection
  ) {
    if (!detection?.box) {
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

  function faceSizeScore(area) {
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

    let yawScore = 0;
    let pitchScore = 0;
    let smilePositionScore = 0;

    switch (position.id) {
      case "frontal":
        yawScore =
          1 -
          clamp(
            Math.abs(yaw) /
              0.30,
            0,
            1
          );

        pitchScore =
          1 -
          clamp(
            Math.abs(pitch) /
              0.28,
            0,
            1
          );
        break;

      case "left":
        yawScore =
          clamp(
            -yaw /
              0.35,
            0,
            1
          );

        pitchScore =
          1 -
          clamp(
            Math.abs(pitch) /
              0.35,
            0,
            1
          );
        break;

      case "right":
        yawScore =
          clamp(
            yaw /
              0.35,
            0,
            1
          );

        pitchScore =
          1 -
          clamp(
            Math.abs(pitch) /
              0.35,
            0,
            1
          );
        break;

      case "up":
        pitchScore =
          clamp(
            -pitch /
              0.28,
            0,
            1
          );

        yawScore =
          1 -
          clamp(
            Math.abs(yaw) /
              0.35,
            0,
            1
          );
        break;

      case "down":
        pitchScore =
          clamp(
            pitch /
              0.28,
            0,
            1
          );

        yawScore =
          1 -
          clamp(
            Math.abs(yaw) /
              0.35,
            0,
            1
          );
        break;

      case "left_up":
        yawScore =
          clamp(
            -yaw /
              0.32,
            0,
            1
          );

        pitchScore =
          clamp(
            -pitch /
              0.25,
            0,
            1
          );
        break;

      case "right_up":
        yawScore =
          clamp(
            yaw /
              0.32,
            0,
            1
          );

        pitchScore =
          clamp(
            -pitch /
              0.25,
            0,
            1
          );
        break;

      case "left_down":
        yawScore =
          clamp(
            -yaw /
              0.32,
            0,
            1
          );

        pitchScore =
          clamp(
            pitch /
              0.25,
            0,
            1
          );
        break;

      case "right_down":
        yawScore =
          clamp(
            yaw /
              0.32,
            0,
            1
          );

        pitchScore =
          clamp(
            pitch /
              0.25,
            0,
            1
          );
        break;

      case "smile":
        yawScore =
          1 -
          clamp(
            Math.abs(yaw) /
              0.35,
            0,
            1
          );

        pitchScore =
          1 -
          clamp(
            Math.abs(pitch) /
              0.35,
            0,
            1
          );

        smilePositionScore =
          clamp(
            smile /
              CONFIG.smileThreshold,
            0,
            1
          );
        break;

      default:
        yawScore = 1;
        pitchScore = 1;
    }

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
        yawScore * 0.12 +
        pitchScore * 0.12 +
        rollScore * 0.08 +
        smilePositionScore *
          0.32 +
        size * 0.08 +
        light * 0.08;
    } else {
      score =
        detector * 0.20 +
        yawScore * 0.27 +
        pitchScore * 0.22 +
        rollScore * 0.10 +
        size * 0.10 +
        light * 0.11;
    }

    return {
      score:
        clamp(
          score,
          0,
          1
        ),

      yawScore,
      pitchScore,
      rollScore,

      smileScore:
        smilePositionScore,

      faceSizeScore:
        size,

      brightnessScore:
        light,

      detectionScore:
        detector
    };
  }

  /*
   * ==========================================================
   * ANÁLISE
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
          ? calculatePose(
              detection.landmarks
            )
          : {
              yaw: 0,
              pitch: 0,
              roll: 0
            },

      quality: {
        brightness:
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
        0
    };
  }

  /*
   * ==========================================================
   * GRAVAÇÃO SELETIVA
   * ==========================================================
   */
  /*
   * ==========================================================
   * GRAVAÇÃO SELETIVA
   * ==========================================================
   *
   * Cada posição aprovada gera exatamente um segmento.
   *
   * Regras:
   * - somente grava quando a posição está correta;
   * - nunca guarda Blob vazio;
   * - espera o último dataavailable antes de finalizar;
   * - mantém posição numérica 1..10;
   * - nunca substitui silenciosamente um segmento válido;
   * - o backend continua responsável pela confirmação final.
   */

  function getSupportedVideoMimeType() {
    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      return null;
    }

    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4"
    ];

    for (
      const mimeType of candidates
    ) {
      try {
        if (
          MediaRecorder.isTypeSupported(
            mimeType
          )
        ) {
          return mimeType;
        }
      } catch (_) {}
    }

    return null;
  }

  function resetActiveRecorder() {
    activePositionRecorder =
      null;

    activePositionChunks =
      [];

    activePositionRecordingStartedAt =
      null;

    activePositionRecordingMimeType =
      null;

    activePositionRecordingId =
      null;
  }

  function startCorrectPositionRecording(
    position
  ) {
    if (
      !position ||
      !stream ||
      activePositionRecorder
    ) {
      return false;
    }

    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      videoRecordingSupported =
        false;

      return false;
    }

    const mimeType =
      getSupportedVideoMimeType();

    try {
      let recorder;

      if (mimeType) {
        recorder =
          new MediaRecorder(
            stream,
            {
              mimeType,
              videoBitsPerSecond:
                900000
            }
          );
      } else {
        recorder =
          new MediaRecorder(
            stream
          );
      }

      activePositionRecorder =
        recorder;

      activePositionChunks =
        [];

      activePositionRecordingStartedAt =
        Date.now();

      activePositionRecordingMimeType =
        recorder.mimeType ||
        mimeType ||
        "video/webm";

      activePositionRecordingId =
        position.id;

      videoRecordingSupported =
        true;

      recorder.ondataavailable =
        event => {
          try {
            if (
              event &&
              event.data &&
              event.data.size > 0
            ) {
              activePositionChunks.push(
                event.data
              );
            }
          } catch (error) {
            console.warn(
              "[FacialPreflight] Falha ao receber bloco de vídeo:",
              error
            );
          }
        };

      recorder.onerror =
        event => {
          console.warn(
            "[FacialPreflight] Erro na gravação da posição:",
            event
          );
        };

      recorder.onstart =
        () => {
          console.info(
            "[FacialPreflight] Gravação iniciada:",
            position.id
          );
        };

      recorder.start(
        CONFIG.recordingTimesliceMs
      );

      return true;
    } catch (error) {
      console.warn(
        "[FacialPreflight] MediaRecorder indisponível:",
        error
      );

      resetActiveRecorder();

      videoRecordingSupported =
        false;

      return false;
    }
  }

  function stopCorrectPositionRecording(
    saveSegment
  ) {
    return new Promise(
      resolve => {
        const recorder =
          activePositionRecorder;

        if (
          !recorder
        ) {
          resetActiveRecorder();
          resolve(null);
          return;
        }

        /*
         * Guardamos todas as informações da sessão
         * ANTES de limpar o estado global.
         */

        const positionId =
          activePositionRecordingId;

        const canonicalPosition =
          getCanonicalPositionNumber(
            positionId
          );

        const startedAt =
          activePositionRecordingStartedAt;

        const mimeType =
          activePositionRecordingMimeType ||
          recorder.mimeType ||
          "video/webm";

        let finished =
          false;

        const finalize =
          () => {
            if (finished) {
              return;
            }

            finished = true;

            try {
              const chunks =
                Array.isArray(
                  activePositionChunks
                )
                  ? activePositionChunks.slice()
                  : [];

              /*
               * O onstop só é executado depois do último
               * dataavailable. Portanto este Blob representa
               * todo o material entregue pelo MediaRecorder.
               */

              const blob =
                new Blob(
                  chunks,
                  {
                    type:
                      mimeType
                  }
                );

              const durationMs =
                startedAt
                  ? Math.max(
                      0,
                      Date.now() -
                        startedAt
                    )
                  : 0;

              /*
               * Capturar os dados antes de resetar.
               */

              const blobSize =
                Number(
                  blob?.size ||
                  0
                );

              const validPosition =
                Number.isInteger(
                  canonicalPosition
                ) &&
                canonicalPosition >= 1 &&
                canonicalPosition <= 10;

              const validBlob =
                blobSize >=
                CONFIG.minimumVideoSegmentBytes;

              /*
               * Agora podemos limpar o recorder.
               */

              resetActiveRecorder();

              /*
               * Nunca guardar gravação inválida.
               */

              if (
                !saveSegment ||
                !validPosition ||
                !validBlob
              ) {
                console.warn(
                  "[FacialPreflight] Segmento descartado:",
                  {
                    position:
                      canonicalPosition,

                    positionId,

                    saveSegment,

                    blobSize,

                    minimumRequired:
                      CONFIG.minimumVideoSegmentBytes
                  }
                );

                resolve(null);
                return;
              }

              const completedAt =
                new Date().toISOString();

              const segment = {
                position:
                  canonicalPosition,

                positionId:
                  positionId,

                sequence:
                  canonicalPosition,

                mimeType:
                  blob.type ||
                  mimeType,

                size:
                  blobSize,

                durationMs,

                startedAt:
                  startedAt
                    ? new Date(
                        startedAt
                      ).toISOString()
                    : null,

                completedAt,

                blob
              };

              /*
               * Segurança adicional:
               * se por algum erro interno já existir um
               * segmento desta posição, não criamos duplicado.
               */

              const existingIndex =
                videoSegments.findIndex(
                  item =>
                    Number(
                      item?.position
                    ) ===
                    canonicalPosition
                );

              if (
                existingIndex >= 0
              ) {
                console.warn(
                  "[FacialPreflight] Segmento existente substituído:",
                  canonicalPosition
                );

                videoSegments[
                  existingIndex
                ] =
                  segment;
              } else {
                videoSegments.push(
                  segment
                );
              }

              videoRecordingAvailable =
                videoSegments.length >
                0;

              console.info(
                "[FacialPreflight] Segmento válido guardado:",
                {
                  position:
                    canonicalPosition,

                  positionId,

                  size:
                    blobSize,

                  durationMs,

                  totalSegments:
                    videoSegments.length
                }
              );

              resolve(
                segment
              );
            } catch (error) {
              console.error(
                "[FacialPreflight] Erro ao finalizar segmento:",
                error
              );

              resetActiveRecorder();

              resolve(null);
            }
          };

        /*
         * O evento final de stop ocorre depois do último
         * dataavailable.
         */

        recorder.onstop =
          finalize;

        /*
         * Se o recorder ainda estiver gravando,
         * solicitamos explicitamente o último bloco
         * antes de parar.
         *
         * requestData() gera um dataavailable com os
         * dados acumulados até aquele momento.
         */

        try {
          if (
            recorder.state ===
            "recording"
          ) {
            try {
              recorder.requestData();
            } catch (
              requestError
            ) {
              console.warn(
                "[FacialPreflight] requestData não disponível:",
                requestError
              );
            }

            recorder.stop();

            return;
          }

          /*
           * Se o browser já tornou o recorder inactive,
           * não devemos chamar stop() novamente.
           *
           * O conteúdo disponível ainda pode ser aproveitado
           * através do mesmo processo de finalização.
           */

          finalize();
        } catch (error) {
          console.error(
            "[FacialPreflight] Falha ao parar gravação:",
            error
          );

          resetActiveRecorder();

          resolve(null);
        }
      }
    );
  }

  async function discardActivePositionRecording() {
    if (
      !activePositionRecorder
    ) {
      return;
    }

    await stopCorrectPositionRecording(
      false
    );
  }

  function getVideoMetadata() {
    return {
      available:
        videoRecordingAvailable,

      supported:
        videoRecordingSupported,

      segmentCount:
        videoSegments.length,

      positions:
        videoSegments.map(
          segment => ({
            position:
              segment.position,

            sequence:
              segment.sequence,

            mimeType:
              segment.mimeType,

            size:
              segment.size,

            durationMs:
              segment.durationMs,

            startedAt:
              segment.startedAt,

            completedAt:
              segment.completedAt
          })
        )
    };
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
        try {
          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                video: true,
                audio: false
              }
            );

          return stream;
        } catch (fallbackError) {
          throw new Error(
            fallbackError?.message ||
            message
          );
        }
      }

      throw new Error(
        message
      );
    }

    videoElement.srcObject =
      stream;

    videoElement.autoplay =
      true;

    videoElement.muted =
      true;

    videoElement.playsInline =
      true;

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

        const check =
          () => {
            if (
              videoElement &&
              videoElement.videoWidth
            ) {
              cleanup();
              resolve();
            }
          };

        const cleanup =
          () => {
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

  async function stopCamera() {
    await discardActivePositionRecording();

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
     * Mantemos o primeiro comando de voz
     * associado ao clique do utilizador.
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

    if (
      options.sessionId
    ) {
      sessionId =
        options.sessionId;
    }

    if (!sessionId) {
      sessionId =
        createSessionId();
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

  async function reset() {
    running = false;
    processing = false;

    currentPositionIndex = 0;
    stableFrames = 0;
    positionStartedAt = 0;
    lastDetectionAt = 0;

    completedPositions = [];
    capturedPositions = [];

    result = null;

    /*
     * Os segmentos pertencem exclusivamente
     * à nova sessão.
     */

    videoSegments = [];

    videoRecordingAvailable =
      false;

    videoRecordingSupported =
      false;

    await discardActivePositionRecording();

    sessionId =
      createSessionId();

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

    if (
      options.sessionId
    ) {
      sessionId =
        options.sessionId;
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

    await reset();

    primeAudio();

    if (!initialized) {
      await initialize({
        videoElement:
          options.videoElement ||
          videoElement,

        clientId:
          clientId,

        sessionId:
          sessionId
      });
    } else if (
      options.videoElement
    ) {
      videoElement =
        options.videoElement;
    }

    await startCamera();

    /*
     * Apenas depois de a câmera estar pronta
     * começamos a sessão.
     */

    running = true;

    currentPositionIndex = 0;

    positionStartedAt =
      Date.now();

    stableFrames = 0;

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
     * Sem rosto:
     * se havia gravação preliminar desta posição,
     * ela é descartada.
     */

    if (!faceCount) {
      stableFrames = 0;

      await discardActivePositionRecording();

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

      return;
    }

    /*
     * Mais de um rosto:
     * nunca gravamos como posição correta.
     */

    if (
      faceCount >
      CONFIG.maxFaces
    ) {
      stableFrames = 0;

      await discardActivePositionRecording();

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

    const detection =
      detections[0];

    const pose =
      calculatePose(
        detection.landmarks
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

    const correct =
      evaluation.score >=
      CONFIG.positionScoreThreshold;

    /*
     * ========================================================
     * GRAVAÇÃO:
     * só começa quando a posição já está correta.
     * ========================================================
     */

    if (correct) {
      if (
        !activePositionRecorder
      ) {
        startCorrectPositionRecording(
          position
        );
      }

      stableFrames += 1;
    } else {
      /*
       * A pessoa perdeu a posição.
       *
       * Se ainda não completou os 5 frames,
       * eliminamos o segmento inteiro.
       *
       * Assim, uma tentativa errada jamais
       * aparece na Administração.
       */

      stableFrames = 0;

      if (
        activePositionRecorder
      ) {
        await discardActivePositionRecording();
      }
    }

    let message =
      position.instruction;

    let statusType =
      "instruction";

    if (
      evaluation.brightnessScore <
      0.60
    ) {
      message =
        "Melhore a iluminação do rosto.";

      statusType =
        "warning";
    }

    if (
      evaluation.faceSizeScore <
      0.55
    ) {
      message =
        area <
        CONFIG.idealFaceAreaMin
          ? "Aproxime um pouco o rosto da câmera."
          : "Afaste ligeiramente o rosto da câmera.";

      statusType =
        "warning";
    }

    if (
      position.id === "smile" &&
      evaluation.smileScore <
        0.45
    ) {
      message =
        "Sorria para completar esta posição.";

      statusType =
        "instruction";
    }

    if (correct) {
      message =
        "Perfeito. Mantenha esta posição.";

      statusType =
        "success";
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

    if (
      Date.now() -
        positionStartedAt >
      CONFIG.positionTimeoutMs
    ) {
      stableFrames = 0;

      positionStartedAt =
        Date.now();

      await discardActivePositionRecording();

      speakInstruction(
        position.instruction
      );
    }

    /*
     * Cinco frames corretos consecutivos:
     * posição aprovada.
     */

    if (
      stableFrames >=
      CONFIG.stableFramesRequired
    ) {
      await completePosition(
        evaluation,
        analysis
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

  stableFrames = 0;

  /*
   * A posição facial já foi validada.
   *
   * O vídeo é importante, mas uma falha de gravação
   * NÃO invalida o movimento que o cliente acabou
   * de executar.
   *
   * Se o vídeo falhar:
   * - a posição continua aprovada;
   * - avançamos normalmente;
   * - no final pedimos SOMENTE os vídeos em falta.
   */

  const videoSegment =
    await stopCorrectPositionRecording(
      true
    );

  const canonicalPosition =
    currentPositionIndex + 1;

  const hasValidVideo =
    Boolean(
      videoSegment &&
      videoSegment.blob &&
      videoSegment.blob.size >=
        CONFIG.minimumVideoSegmentBytes &&
      Number.isInteger(
        Number(
          videoSegment.position
        )
      ) &&
      Number(
        videoSegment.position
      ) === canonicalPosition &&
      Number(
        videoSegment.durationMs
      ) > 0
    );

  const completedAt =
    new Date().toISOString();

  /*
   * Verifica se esta posição já tinha sido
   * aprovada anteriormente.
   *
   * Isto acontece quando estamos a recuperar
   * somente um vídeo que faltou.
   */

  const existingCapturedIndex =
    capturedPositions.findIndex(
      item =>
        Number(
          item?.position
        ) === canonicalPosition
    );

  const existingCaptured =
    existingCapturedIndex >= 0
      ? capturedPositions[
          existingCapturedIndex
        ]
      : null;

  const sequence =
    existingCaptured
      ? Number(
          existingCaptured.sequence ||
            canonicalPosition
        )
      : completedPositions.length + 1;

  const livenessPosition = {
    position:
      canonicalPosition,

    label:
      position.label,

    instruction:
      position.instruction,

    sequence,

    score:
      Number(
        Number(
          evaluation?.score || 0
        ).toFixed(4)
      ),

    positionScore:
      Number(
        Number(
          evaluation?.score || 0
        ).toFixed(4)
      ),

    faceDetected:
      Boolean(
        analysis?.faceDetected
      ),

    singleFace:
      Boolean(
        analysis?.singleFace
      ),

    faceCount:
      Number(
        analysis?.faceCount || 0
      ),

    faceArea:
      Number(
        analysis?.faceArea || 0
      ),

    detectionScore:
      Number(
        analysis?.detectionScore || 0
      ),

    pose: {
      yaw:
        Number(
          analysis?.pose?.yaw || 0
        ),

      pitch:
        Number(
          analysis?.pose?.pitch || 0
        ),

      roll:
        Number(
          analysis?.pose?.roll || 0
        )
    },

    quality: {
      brightness:
        Number(
          analysis?.quality?.brightness || 0
        ),

      brightnessScore:
        Number(
          analysis?.quality?.brightnessScore || 0
        ),

      sharpnessScore:
        Number(
          analysis?.quality?.sharpnessScore || 0
        ),

      faceSizeScore:
        Number(
          analysis?.quality?.faceSizeScore || 0
        ),

      detectionScore:
        Number(
          analysis?.quality?.detectionScore || 0
        )
    },

    smileDetected:
      position.id === "smile"
        ? Number(
            evaluation?.smileScore || 0
          ) >=
          CONFIG.smileThreshold
        : false,

    smileScore:
      Number(
        evaluation?.smileScore || 0
      ),

    /*
     * A posição facial é válida mesmo quando
     * o vídeo ainda precisa de recuperação.
     */
    verified: true,

    completedAt,

    video:
      hasValidVideo
        ? {
            available: true,

            position:
              Number(
                videoSegment.position
              ),

            positionId:
              position.id,

            sequence:
              Number(
                videoSegment.sequence
              ),

            mimeType:
              videoSegment.mimeType,

            size:
              Number(
                videoSegment.size
              ),

            durationMs:
              Number(
                videoSegment.durationMs
              ),

            startedAt:
              videoSegment.startedAt,

            completedAt:
              videoSegment.completedAt
          }
        : {
            available: false,

            position:
              canonicalPosition,

            positionId:
              position.id,

            sequence,

            retryRequired: true
          }
  };

  /*
   * Primeira aprovação da posição.
   */
  if (
    !existingCaptured
  ) {
    completedPositions.push(
      position.id
    );

    capturedPositions.push(
      livenessPosition
    );
  } else {
    /*
     * Recuperação:
     * substituímos somente os dados desta posição.
     *
     * As outras posições permanecem intactas.
     */
    capturedPositions[
      existingCapturedIndex
    ] = livenessPosition;
  }

  if (
    hasValidVideo
  ) {
    setStatus(
      existingCaptured
        ? "Vídeo recuperado. Continuando."
        : "Posição concluída. Continuando.",
      "success"
    );
  } else {
    setStatus(
      "Posição concluída. O vídeo será recuperado no final, sem repetir esta sessão.",
      "warning"
    );
  }

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
          position.label,

        sequence,

        score:
          livenessPosition.score,

        verified: true,

        video:
          livenessPosition.video
      },

      score:
        evaluation.score,

      analysis,

      liveness:
        livenessPosition,

      videoStored:
        hasValidVideo,

      videoRetryRequired:
        !hasValidVideo
    }
  );

  /*
   * Se as 10 posições já foram reconhecidas,
   * não começamos uma nova posição.
   *
   * Primeiro recuperamos apenas os vídeos
   * que estiverem em falta.
   */
  if (
    completedPositions.length >=
    POSITIONS.length
  ) {
    await beginVideoRecoveryOrFinish();
    return;
  }

  const nextIndex =
    currentPositionIndex +
    1;

  currentPositionIndex =
    nextIndex;

  positionStartedAt =
    Date.now();

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
 * RECUPERAÇÃO SELETIVA DOS VÍDEOS
 * ==========================================================
 *
 * As posições faciais aprovadas são preservadas.
 *
 * Se algum vídeo não existir, somente essa posição
 * volta a ser gravada.
 */

function getMissingVideoPositions() {
  const validPositions =
    new Set(
      videoSegments
        .filter(
          segment =>
            segment &&
            segment.blob &&
            segment.blob.size >=
              CONFIG.minimumVideoSegmentBytes &&
            Number.isInteger(
              Number(
                segment.position
              )
            ) &&
            Number(
              segment.position
            ) >= 1 &&
            Number(
              segment.position
            ) <= 10 &&
            Number(
              segment.durationMs
            ) > 0
        )
        .map(
          segment =>
            Number(
              segment.position
            )
        )
    );

  return POSITIONS
    .map(
      (position, index) => ({
        position,
        index
      })
    )
    .filter(
      item =>
        completedPositions.includes(
          item.position.id
        ) &&
        !validPositions.has(
          item.index + 1
        )
    );
}

async function beginVideoRecoveryOrFinish() {
  const missing =
    getMissingVideoPositions();

  /*
   * Não falta nenhum vídeo.
   * Agora podemos finalizar.
   */
  if (!missing.length) {
    await finish();
    return;
  }

  /*
   * Mantemos a sessão viva.
   *
   * Não fazemos reset().
   * Não apagamos completedPositions.
   * Não apagamos capturedPositions.
   * Não voltamos para a posição 1.
   */

  running = true;

  const firstMissing =
    missing[0];

  currentPositionIndex =
    firstMissing.index;

  stableFrames = 0;

  positionStartedAt =
    Date.now();

  const remaining =
    missing.length;

  const position =
    firstMissing.position;

  setStatus(
    remaining === 1
      ? `Só falta guardar o vídeo da posição ${firstMissing.index + 1}. Repita apenas esta posição.`
      : `Faltam ${remaining} vídeos. Vamos recuperar apenas esta posição: ${firstMissing.index + 1} de 10.`,
    "warning"
  );

  speakInstruction(
    position.instruction
  );

  emitProgress();

  if (
    !animationFrame
  ) {
    animationFrame =
      requestAnimationFrame(
        processFrame
      );
  }
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

  if (
    activePositionRecorder
  ) {
    await discardActivePositionRecording();
  }

  const scores =
    capturedPositions.map(
      item =>
        Number(
          item?.score || 0
        )
    );

  const score =
    average(scores);

  const completed =
    completedPositions.length ===
    POSITIONS.length;

  const validVideoSegments =
    videoSegments.filter(
      segment =>
        segment &&
        segment.blob &&
        segment.blob.size >=
          CONFIG.minimumVideoSegmentBytes &&
        Number.isInteger(
          Number(
            segment.position
          )
        ) &&
        Number(
          segment.position
        ) >= 1 &&
        Number(
          segment.position
        ) <= 10 &&
        Number(
          segment.durationMs
        ) > 0
    );

  const videoPositions =
    new Set(
      validVideoSegments.map(
        segment =>
          Number(
            segment.position
          )
      )
    );

  const allTenVideosValid =
    validVideoSegments.length ===
      POSITIONS.length &&
    videoPositions.size ===
      POSITIONS.length &&
    [...Array(10)].every(
      (_, index) =>
        videoPositions.has(
          index + 1
        )
    );

  /*
   * Se os movimentos terminaram mas existem vídeos
   * em falta, NÃO encerramos a liveness.
   *
   * O sistema recupera somente os vídeos ausentes.
   */
    /*
   * Se as 10 posições foram reconhecidas, mas ainda existem
   * vídeos em falta, NÃO entregamos um resultado final à UI.
   *
   * A sessão continua viva e recupera somente os vídeos
   * que faltam.
   *
   * IMPORTANTE:
   * - não resetamos a sessão;
   * - não apagamos posições já reconhecidas;
   * - não apagamos vídeos já válidos;
   * - não chamamos onComplete();
   * - não permitimos que a UI tente guardar a liveness;
   * - só haverá resultado final depois dos 10 vídeos.
   */
  if (
    completed &&
    !allTenVideosValid
  ) {
    await beginVideoRecoveryOrFinish();

    /*
     * NÃO devolver aqui um objeto com completed=true.
     *
     * Para a camada UI, a sessão ainda NÃO terminou.
     * O motor continua a trabalhar na recuperação.
     */
    return null;
  }

  /*
   * Só existe aprovação final quando:
   *
   * - 10 posições foram reconhecidas;
   * - 10 vídeos válidos existem;
   * - as posições dos vídeos são 1..10.
   */

  const success =
    completed &&
    allTenVideosValid;

  result = {
    completed,

    success,

    /*
     * IMPORTANTE:
     * nunca marcar passed=true apenas porque
     * as posições faciais foram concluídas.
     */
    passed:
      success,

    clientId,

    sessionId,

    completedCount:
      completedPositions.length,

    total:
      POSITIONS.length,

    score:
      Number(
        score.toFixed(4)
      ),

    positions:
      capturedPositions,

    completedPositions:
      completedPositions.slice(),

    audioReady,

    video: {
      available:
        allTenVideosValid,

      supported:
        videoRecordingSupported,

      segmentCount:
        validVideoSegments.length,

      expectedSegments:
        POSITIONS.length,

      complete:
        allTenVideosValid,

      verified:
        allTenVideosValid,

      positions:
        validVideoSegments.map(
          segment => ({
            position:
              Number(
                segment.position
              ),

            positionId:
              segment.positionId ||
              null,

            sequence:
              Number(
                segment.sequence
              ),

            mimeType:
              segment.mimeType,

            size:
              Number(
                segment.size
              ),

            durationMs:
              Number(
                segment.durationMs
              ),

            startedAt:
              segment.startedAt,

            completedAt:
              segment.completedAt
          })
        )
    },

    completedAt:
      new Date().toISOString()
  };

  if (
    success
  ) {
    setStatus(
      "As dez posições e os dez vídeos foram concluídos corretamente.",
      "success"
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

  async function stop() {
    running = false;
    processing = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    await discardActivePositionRecording();

    stopSpeech();

    await stopCamera();
  }

  /*
   * ==========================================================
   * CSRF
   * ==========================================================
   */

  function getCsrfToken() {
    try {
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

        if (
          key ===
          "csrf_token"
        ) {
          return decodeURIComponent(
            parts.join("=")
          );
        }
      }
    } catch (error) {
      console.warn(
        "[FacialPreflight] Não foi possível ler o token CSRF:",
        error
      );
    }

    return null;
  }

  /*
   * ==========================================================
   * ENVIO DOS VÍDEOS
   * ==========================================================
   *
   * Endpoint separado do JSON de liveness.
   *
   * Isto evita colocar vídeos grandes dentro
   * do JSON principal.
   */
async function uploadVideoSegments(
  targetClientId
) {
  if (!targetClientId) {
    throw new Error(
      "ID do cliente não encontrado para envio dos vídeos."
    );
  }

  /*
   * ==========================================================
   * VALIDAR OS 10 VÍDEOS
   * ==========================================================
   */

  const orderedSegments =
    videoSegments
      .slice()
      .sort(
        (a, b) =>
          Number(a.position) -
          Number(b.position)
      );

  if (
    orderedSegments.length !==
    POSITIONS.length
  ) {
    throw new Error(
      `A liveness possui ${orderedSegments.length} vídeos, mas são necessários exatamente ${POSITIONS.length}.`
    );
  }

  const positions =
    new Set();

  for (
    const segment of orderedSegments
  ) {
    const position =
      Number(
        segment?.position
      );

    if (
      !segment?.blob ||
      segment.blob.size <
        CONFIG.minimumVideoSegmentBytes
    ) {
      throw new Error(
        `O vídeo da posição ${position || "desconhecida"} está vazio ou inválido.`
      );
    }

    if (
      !Number.isInteger(
        position
      ) ||
      position < 1 ||
      position > 10
    ) {
      throw new Error(
        `Posição de vídeo inválida: ${segment?.position}`
      );
    }

    if (
      positions.has(
        position
      )
    ) {
      throw new Error(
        `O vídeo da posição ${position} foi duplicado.`
      );
    }

    positions.add(
      position
    );
  }

  for (
    let position = 1;
    position <= 10;
    position += 1
  ) {
    if (
      !positions.has(
        position
      )
    ) {
      throw new Error(
        `O vídeo da posição ${position} não existe.`
      );
    }
  }

  /*
   * ==========================================================
   * CSRF
   * ==========================================================
   */

  const csrfToken =
    getCsrfToken();

  if (!csrfToken) {
    throw new Error(
      "Token de segurança da sessão não encontrado. Atualize a página e tente novamente."
    );
  }

  /*
   * ==========================================================
   * CRIAR FORMDATA NOVO PARA CADA TENTATIVA
   * ==========================================================
   */

  function createVideoFormData() {
    const formData =
      new FormData();

    formData.append(
      "clientId",
      String(
        targetClientId
      )
    );

    formData.append(
      "sessionId",
      String(
        sessionId
      )
    );

    formData.append(
      "segmentCount",
      "10"
    );

    orderedSegments.forEach(
      (
        segment,
        index
      ) => {
        const position =
          Number(
            segment.position
          );

        const blob =
          segment.blob;

        const mimeType =
          blob?.type ||
          segment.mimeType ||
          "video/webm";

        const extension =
          mimeType
            .toLowerCase()
            .includes(
              "mp4"
            )
            ? "mp4"
            : "webm";

        formData.append(
          `livenessVideo_${index}`,
          blob,
          `liveness-${sessionId}-position-${position}.${extension}`
        );

        formData.append(
          `livenessMeta_${index}`,
          JSON.stringify({
            position,

            sequence:
              position,

            positionId:
              segment.positionId ||
              null,

            label:
              segment.label ||
              null,

            instruction:
              segment.instruction ||
              null,

            score:
              segment.score ??
              null,

            positionScore:
              segment.positionScore ??
              null,

            mimeType,

            size:
              Number(
                blob.size
              ),

            durationMs:
              Number(
                segment.durationMs ||
                0
              ),

            startedAt:
              segment.startedAt ||
              null,

            completedAt:
              segment.completedAt ||
              null
          })
        );
      }
    );

    return formData;
  }

  /*
   * ==========================================================
   * UMA TENTATIVA DE UPLOAD
   * ==========================================================
   */

  async function performUpload() {
    const formData =
      createVideoFormData();

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          targetClientId
        )}/liveness-video`,
        {
          method:
            "POST",

          credentials:
            "include",

          headers: {
            Accept:
              "application/json",

            "x-csrf-token":
              csrfToken
          },

          body:
            formData
        }
      );

    const rawText =
      await response.text();

    let data = null;

    try {
      data =
        rawText
          ? JSON.parse(
              rawText
            )
          : null;
    } catch (_) {
      data = null;
    }

    console.info(
      "[FacialPreflight] Resposta do upload:",
      {
        status:
          response.status,

        ok:
          response.ok,

        data
      }
    );

    if (
      !response.ok
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        `O servidor recusou os vídeos de liveness. HTTP ${response.status}`
      );
    }

    if (
      data?.success !==
      true
    ) {
      throw new Error(
        data?.error ||
        data?.message ||
        "O servidor não confirmou o armazenamento dos vídeos."
      );
    }

    if (
      Number(
        data?.segmentsReceived
      ) !== 10
    ) {
      throw new Error(
        `O servidor recebeu ${Number(
          data?.segmentsReceived || 0
        )} vídeos, mas eram esperados 10.`
      );
    }

    if (
      Number(
        data?.segmentsStored
      ) !== 10
    ) {
      throw new Error(
        `O servidor armazenou ${Number(
          data?.segmentsStored || 0
        )} vídeos, mas eram esperados 10.`
      );
    }

    if (
      data?.video?.verified !==
      true
    ) {
      throw new Error(
        "O servidor recebeu os vídeos, mas não confirmou a verificação dos 10 vídeos."
      );
    }

    if (
      data?.livenessPassed !==
      true
    ) {
      throw new Error(
        "Os vídeos foram recebidos, mas a liveness não foi confirmada pelo servidor."
      );
    }

    return data;
  }

  /*
   * ==========================================================
   * PRIMEIRA TENTATIVA
   * ==========================================================
   */

  try {
    const data =
      await performUpload();

    console.info(
      "[FacialPreflight] Upload confirmado.",
      data
    );

    return {
      uploaded:
        true,

      verified:
        true,

      segmentCount:
        10,

      data
    };

  } catch (
    firstError
  ) {
    console.warn(
      "[FacialPreflight] Primeira tentativa falhou:",
      firstError
    );
  }

  /*
   * ==========================================================
   * SEGUNDA TENTATIVA
   * ==========================================================
   *
   * Um FormData completamente novo será criado.
   */

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        1200
      )
  );

  try {
    const data =
      await performUpload();

    console.info(
      "[FacialPreflight] Upload confirmado na segunda tentativa.",
      data
    );

    return {
      uploaded:
        true,

      verified:
        true,

      segmentCount:
        10,

      data
    };

  } catch (
    secondError
  ) {
    console.error(
      "[FacialPreflight] As duas tentativas falharam.",
      secondError
    );

    throw new Error(
      secondError?.message ||
      "Não foi possível armazenar os 10 vídeos de liveness."
    );
  }
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

    /*
     * ========================================================
     * BLOQUEIO ABSOLUTO
     * ========================================================
     *
     * Nunca enviamos para o backend uma liveness completa
     * sem os 10 vídeos reais.
     */

    if (
      !result.completed
    ) {
      throw new Error(
        "A liveness ainda não foi concluída nas 10 posições."
      );
    }

    if (
      videoSegments.length !==
      POSITIONS.length
    ) {
      throw new Error(
        `A liveness foi concluída, mas existem apenas ${videoSegments.length} vídeos. São necessários 10.`
      );
    }

    const videoPositions =
      new Set(
        videoSegments.map(
          segment =>
            Number(
              segment?.position
            )
        )
      );

    if (
      videoPositions.size !==
      10
    ) {
      throw new Error(
        "Os vídeos de liveness não correspondem às 10 posições únicas."
      );
    }

    for (
      let position = 1;
      position <= 10;
      position += 1
    ) {
      if (
        !videoPositions.has(
          position
        )
      ) {
        throw new Error(
          `O vídeo da posição ${position} está em falta.`
        );
      }
    }

    /*
     * ========================================================
     * CSRF
     * ========================================================
     */

    const csrfToken =
      getCsrfToken();

    if (!csrfToken) {
      throw new Error(
        "Token de segurança da sessão não encontrado. Atualize a página e tente novamente."
      );
    }

    /*
     * ========================================================
     * PRIMEIRA ETAPA
     * ========================================================
     *
     * O backend cria a sessão como video_pending.
     *
     * Ainda NÃO é livenessPassed.
     */

    const body = {
      clientId:
        targetClientId,

      sessionId:
        sessionId,

      consentAccepted:
        true,

      completed:
        true,

      success:
        true,

      passed:
        false,

      score:
        result.score,

      completedCount:
        result.completedCount,

      total:
        result.total,

      positions:
        result.positions,

      video: {
        available:
          false,

        segmentCount:
          0,

        expectedSegments:
          POSITIONS.length,

        sessionId
      },

      passportMatch:
        payload.passportMatch ||
        null
    };

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          targetClientId
        )}/facial-preflight`,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",

            "x-csrf-token":
              csrfToken
          },

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

    if (!response.ok) {
      const issues =
        Array.isArray(
          data?.issues
        )
          ? data.issues
          : [];

      const issueText =
        issues.length
          ? ` ${issues.join(" ")}`
          : "";

      throw new Error(
        data?.message ||
        data?.error ||
        `O servidor recusou a sessão de liveness. HTTP ${response.status}.${issueText}`
      );
    }

    if (
      data?.success !== true
    ) {
      throw new Error(
        data?.error ||
        "O servidor não confirmou a criação da sessão de liveness."
      );
    }

    /*
     * O primeiro endpoint DEVE deixar a sessão
     * pendente dos vídeos.
     */

    if (
      data?.livenessPassed ===
      true
    ) {
      throw new Error(
        "O servidor tentou aprovar a liveness antes de armazenar os 10 vídeos."
      );
    }

    /*
     * ========================================================
     * SEGUNDA ETAPA
     * ========================================================
     *
     * Agora enviamos os 10 vídeos.
     */

    setStatus(
      "A guardar os 10 vídeos de liveness...",
      "info"
    );

    let videoUpload;

    try {
      videoUpload =
        await uploadVideoSegments(
          targetClientId
        );
    } catch (videoError) {
      console.error(
        "[FacialPreflight] Falha definitiva ao guardar vídeos:",
        videoError
      );

      setStatus(
        "Não foi possível guardar os vídeos. A liveness não foi aprovada. Tente novamente.",
        "warning"
      );

      throw videoError;
    }

    /*
     * ========================================================
     * CONFIRMAÇÃO FINAL
     * ========================================================
     */

    if (
      videoUpload?.uploaded !==
      true ||
      videoUpload?.verified !==
      true ||
      Number(
        videoUpload?.segmentCount
      ) !== 10
    ) {
      throw new Error(
        "Os 10 vídeos não foram confirmados pelo servidor."
      );
    }

    const serverData =
      videoUpload.data;

    if (
      serverData?.livenessPassed !==
      true
    ) {
      throw new Error(
        "A liveness não foi aprovada pelo servidor após o armazenamento dos vídeos."
      );
    }

    if (
      Number(
        serverData?.segmentsStored
      ) !== 10
    ) {
      throw new Error(
        "O servidor não confirmou os 10 vídeos armazenados."
      );
    }

    if (
      serverData?.video?.verified !==
      true
    ) {
      throw new Error(
        "O servidor não confirmou a verificação final dos vídeos."
      );
    }

    /*
     * ========================================================
     * RESULTADO DEFINITIVO
     * ========================================================
     */

    result.video = {
      ...result.video,

      available:
        true,

      supported:
        videoRecordingSupported,

      segmentCount:
        10,

      expectedSegments:
        10,

      complete:
        true,

      verified:
        true,

      positions:
        getVideoMetadata().positions
    };

    result.passed =
      true;

    result.success =
      true;

    result.completed =
      true;

    result.videoUploadVerified =
      true;

    setStatus(
      "Liveness aprovada. As 10 posições e os 10 vídeos foram guardados com sucesso.",
      "success"
    );

    return {
      ...data,

      livenessVideo:
        videoUpload,

      livenessPassed:
        true,

      sessionId,

      video:
        result.video,

      result
    };
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

      sessionId,

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

      video:
        getVideoMetadata(),

      result
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

    uploadVideoSegments,

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
