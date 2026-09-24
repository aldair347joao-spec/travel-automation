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
          if (
            event &&
            event.data &&
            event.data.size > 0
          ) {
            activePositionChunks.push(
              event.data
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

      recorder.start(
        CONFIG.recordingTimesliceMs
      );

      console.info(
        "[FacialPreflight] Gravação iniciada:",
        position.id
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
          !recorder ||
          recorder.state ===
            "inactive"
        ) {
          const empty =
            saveSegment
              ? null
              : null;

          resetActiveRecorder();

          resolve(empty);
          return;
        }

        const positionId =
          activePositionRecordingId;

        const startedAt =
          activePositionRecordingStartedAt;

        const mimeType =
          activePositionRecordingMimeType ||
          recorder.mimeType ||
          "video/webm";

        const finishRecorder =
          () => {
            try {
              const chunks =
                activePositionChunks.slice();

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

              resetActiveRecorder();

              if (
                !saveSegment ||
                !blob.size ||
                blob.size <
                  CONFIG.minimumVideoSegmentBytes
              ) {
                resolve(null);
                return;
              }

              const segment = {
                position:
                  positionId,

                sequence:
                  videoSegments.length +
                  1,

                mimeType:
                  blob.type ||
                  mimeType,

                size:
                  blob.size,

                durationMs,

                startedAt:
                  startedAt
                    ? new Date(
                        startedAt
                      ).toISOString()
                    : null,

                completedAt:
                  new Date().toISOString(),

                blob
              };

              videoSegments.push(
                segment
              );

              videoRecordingAvailable =
                videoSegments.length >
                0;

              resolve(
                segment
              );
            } catch (error) {
              console.warn(
                "[FacialPreflight] Erro ao finalizar segmento:",
                error
              );

              resetActiveRecorder();
              resolve(null);
            }
          };

        recorder.onstop =
          finishRecorder;

        try {
          recorder.stop();
        } catch (error) {
          console.warn(
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
     * Primeiro fechamos o vídeo.
     *
     * Neste ponto sabemos que a posição
     * foi realmente aprovada.
     */

    const videoSegment =
      await stopCorrectPositionRecording(
        true
      );

    const completedAt =
      new Date().toISOString();

    const livenessPosition = {
      position:
        currentPositionIndex + 1,

      label:
        position.label,

      instruction:
        position.instruction,

      sequence:
        completedPositions.length + 1,

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

      verified: true,

      completedAt,

      /*
       * A referência do vídeo pertence
       * exclusivamente à posição correta.
       */

      video: videoSegment
        ? {
            available: true,

            position:
              videoSegment.position,

            sequence:
              videoSegment.sequence,

            mimeType:
              videoSegment.mimeType,

            size:
              videoSegment.size,

            durationMs:
              videoSegment.durationMs
          }
        : {
            available: false,

            position:
              position.id,

            sequence:
              completedPositions.length +
              1
          }
    };

    completedPositions.push(
      position.id
    );

    capturedPositions.push(
      livenessPosition
    );

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

          sequence:
            livenessPosition.sequence,

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
          livenessPosition
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

    /*
     * Nunca deixamos uma gravação aberta.
     *
     * Se existir, só será guardada se houver
     * uma posição oficialmente aprovada.
     */

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

    const success =
      completed;

    result = {
      completed,

      success,

      passed:
        completed,

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
          videoRecordingAvailable,

        supported:
          videoRecordingSupported,

        segmentCount:
          videoSegments.length,

        expectedSegments:
          POSITIONS.length,

        complete:
          videoSegments.length ===
          POSITIONS.length,

        positions:
          getVideoMetadata().positions
      },

      completedAt:
        new Date().toISOString()
    };

    if (completed) {
      setStatus(
        "As dez posições foram concluídas. Liveness aprovada.",
        "success"
      );
    } else {
      setStatus(
        "A liveness não foi concluída.",
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
    if (
      !targetClientId ||
      !videoSegments.length
    ) {
      return {
        uploaded: false,
        skipped: true,
        segmentCount:
          videoSegments.length
      };
    }

    const csrfToken =
      getCsrfToken();

    if (!csrfToken) {
      throw new Error(
        "Token de segurança da sessão não encontrado. Atualize a página e tente novamente."
      );
    }

    const formData =
      new FormData();

    formData.append(
      "clientId",
      targetClientId
    );

    formData.append(
      "sessionId",
      sessionId
    );

    formData.append(
      "segmentCount",
      String(
        videoSegments.length
      )
    );

    videoSegments.forEach(
      (
        segment,
        index
      ) => {
        formData.append(
          `livenessVideo_${index}`,
          segment.blob,
          `liveness-${sessionId}-${segment.sequence}-${segment.position}.webm`
        );

        formData.append(
          `livenessMeta_${index}`,
          JSON.stringify({
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
        );
      }
    );

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          targetClientId
        )}/liveness-video`,
        {
          method: "POST",

          credentials: "include",

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

    const data =
      await response
        .json()
        .catch(
          () => null
        );

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        `O servidor recusou os vídeos de liveness. HTTP ${response.status}`
      );
    }

    return data;
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

    const csrfToken =
      getCsrfToken();

    if (!csrfToken) {
      throw new Error(
        "Token de segurança da sessão não encontrado. Atualize a página e tente novamente."
      );
    }

    /*
     * Primeiro guardamos a informação oficial
     * de liveness.
     *
     * Os vídeos são enviados separadamente
     * logo depois.
     */

    const body = {
      clientId:
        targetClientId,

      sessionId:
        sessionId,

      consentAccepted:
        true,

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

      video:
        {
          available:
            Boolean(
              videoSegments.length
            ),

          segmentCount:
            videoSegments.length,

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
        `O servidor recusou o resultado facial. HTTP ${response.status}.${issueText}`
      );
    }

    /*
     * O liveness já foi guardado.
     *
     * Agora enviamos os 10 segmentos reais.
     */

    let videoUpload =
      null;

    if (
      result.completed &&
      videoSegments.length
    ) {
      try {
        videoUpload =
          await uploadVideoSegments(
            targetClientId
          );
      } catch (videoError) {
        /*
         * Não transformamos um problema temporário
         * do armazenamento do vídeo em "liveness
         * falhou".
         *
         * O resultado facial já foi aprovado.
         */

        console.error(
          "[FacialPreflight] Falha ao enviar vídeo de liveness:",
          videoError
        );

        videoUpload = {
          uploaded: false,
          pending: true,
          error:
            videoError?.message ||
            "Não foi possível enviar os vídeos de liveness."
        };
      }
    }

    return {
      ...data,

      livenessVideo:
        videoUpload,

      sessionId,

      video:
        getVideoMetadata()
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
