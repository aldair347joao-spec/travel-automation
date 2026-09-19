/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT
 * ============================================================
 *
 * MOTOR FACIAL LOCAL
 *
 * FaceAPI:
 * @vladmandic/face-api
 *
 * Modelos:
 * /models
 *
 * Não utiliza:
 * - MediaPipe Face Landmarker
 * - MediaPipe WASM
 * - API externa de reconhecimento facial
 *
 * O processamento facial acontece no navegador.
 * ============================================================
 */

(() => {
  "use strict";

  const FACE_API_SCRIPT_URL =
    window.TRAVEL_FACE_API_SCRIPT_URL ||
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.min.js";

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
    detectorScoreThreshold: 0.5,

    minFaceArea: 0.04,
    maxFaceArea: 0.82,

    idealFaceAreaMin: 0.10,
    idealFaceAreaMax: 0.60,

    minBrightness: 35,
    maxBrightness: 235,

    stableFramesRequired: 6,
    detectionIntervalMs: 100,

    positionScoreThreshold: 0.66,
    overallScoreThreshold: 0.68,

    smileThreshold: 0.50,

    positionTimeoutMs: 12000,

    maxFaces: 1,

    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFrameRate: 24
  };

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

  let completedPositions = [];
  let capturedPositions = [];

  let result = null;

  let callbacks = {};

  let initialized = false;

  function safeCall(
    name,
    payload
  ) {
    try {
      if (
        callbacks &&
        typeof callbacks[name] ===
          "function"
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
    type = "info"
  ) {
    safeCall(
      "onStatus",
      {
        message: String(
          message || ""
        ),
        type
      }
    );
  }

  function emitError(
    message,
    error = null
  ) {
    console.error(
      "[FacialPreflight]",
      message,
      error || ""
    );

    safeCall(
      "onError",
      {
        message,
        error
      }
    );
  }

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function average(
    values
  ) {
    if (
      !values ||
      !values.length
    ) {
      return 0;
    }

    return (
      values.reduce(
        (sum, value) =>
          sum +
          Number(
            value || 0
          ),
        0
      ) /
      values.length
    );
  }

  function speak(
    text
  ) {
    if (
      !text ||
      !window.speechSynthesis
    ) {
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(
          text
        );

      utterance.lang =
        AUDIO_LANGUAGE;

      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;

      window.speechSynthesis.speak(
        utterance
      );
    } catch (error) {
      console.warn(
        "[FacialPreflight] speech error",
        error
      );
    }
  }

  function stopSpeech() {
    try {
      if (
        window.speechSynthesis
      ) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
  }

  function getCurrentPosition() {
    return (
      POSITIONS[
        currentPositionIndex
      ] || null
    );
  }

  function getCompletedCount() {
    return completedPositions.length;
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

          if (
            existing &&
            window.faceapi
          ) {
            faceApi =
              window.faceapi;

            resolve(
              faceApi
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
                  "FaceAPI carregou mas não ficou disponível."
                )
              );
            }
          };

          script.onerror =
            () => {
              reject(
                new Error(
                  "Não foi possível carregar a biblioteca FaceAPI."
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
   * MODELOS LOCAIS
   * ==========================================================
   */

  async function verifyModelFile(
    file
  ) {
    const response =
      await fetch(
        `${FACE_API_MODEL_URL}/${file}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Modelo não encontrado: ${file} (${response.status})`
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
          "A verificar os modelos faciais locais...",
          "info"
        );

        await verifyModelFile(
          "tiny_face_detector_model-weights_manifest.json"
        );

        await verifyModelFile(
          "face_landmark_68_model-weights_manifest.json"
        );

        await verifyModelFile(
          "face_expression_model-weights_manifest.json"
        );

        setStatus(
          "A carregar os modelos faciais locais...",
          "info"
        );

        await api.nets
          .tinyFaceDetector
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        await api.nets
          .faceLandmark68Net
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        await api.nets
          .faceExpressionNet
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        /*
         * Modelo adicional preparado para a comparação
         * entre fotografia do passaporte e rosto vivo.
         */
        await verifyModelFile(
          "face_recognition_model-weights_manifest.json"
        );

        await api.nets
          .faceRecognitionNet
          .loadFromUri(
            FACE_API_MODEL_URL
          );

        console.info(
          "[FacialPreflight] Todos os modelos locais carregados."
        );

        return true;
      })();

    try {
      return await modelsPromise;
    } catch (error) {
      modelsPromise = null;

      const message =
        error &&
        error.message
          ? error.message
          : "Falha desconhecida ao carregar os modelos faciais.";

      emitError(
        message,
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
    if (
      !videoElement
    ) {
      return;
    }

    if (
      !canvasElement
    ) {
      canvasElement =
        document.createElement(
          "canvas"
        );

      canvasElement.width =
        videoElement.videoWidth ||
        CONFIG.cameraWidth;

      canvasElement.height =
        videoElement.videoHeight ||
        CONFIG.cameraHeight;

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
        videoElement &&
        videoElement.videoWidth
          ? videoElement.videoWidth
          : CONFIG.cameraWidth,

      height:
        videoElement &&
        videoElement.videoHeight
          ? videoElement.videoHeight
          : CONFIG.cameraHeight
    };
  }

  /*
   * ==========================================================
   * BRILHO
   * ==========================================================
   */

  function calculateBrightness() {
    if (
      !videoElement ||
      !canvasContext
    ) {
      return 128;
    }

    const size =
      getVideoSize();

    const width = 160;

    const height =
      Math.max(
        90,
        Math.round(
          width *
            (size.height /
              size.width)
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

    const imageData =
      canvasContext.getImageData(
        0,
        0,
        width,
        height
      );

    const data =
      imageData.data;

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
        (255 - brightness) /
          (255 -
            CONFIG.maxBrightness),
        0,
        1
      );
    }

    return 1;
  }

  /*
   * ==========================================================
   * POSE
   * ==========================================================
   */

  function distance(
    a,
    b
  ) {
    if (
      !a ||
      !b
    ) {
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
    if (
      !landmarks ||
      !landmarks.positions
    ) {
      return null;
    }

    return (
      landmarks.positions[
        index
      ] || null
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
      (leftEye.x +
        rightEye.x) /
      2;

    const eyeCenterY =
      (leftEye.y +
        rightEye.y) /
      2;

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
        (nose.x -
          eyeCenterX) /
        eyeDistance,

      pitch:
        (nose.y -
          eyeCenterY) /
        faceHeight,

      roll:
        (rightEye.y -
          leftEye.y) /
        eyeDistance
    };
  }

  function smileScore(
    expressions
  ) {
    return clamp(
      Number(
        expressions &&
          expressions.happy
          ? expressions.happy
          : 0
      ),
      0,
      1
    );
  }

  function faceArea(
    detection
  ) {
    if (
      !detection ||
      !detection.box
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

    return (
      detection.box.width *
      detection.box.height
    ) / total;
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

    return 0.75;
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
        pose.yaw || 0
      );

    const pitch =
      Number(
        pose.pitch || 0
      );

    const roll =
      Math.abs(
        Number(
          pose.roll || 0
        )
      );

    let yawScore = 0;
    let pitchScore = 0;
    let smilePositionScore = 0;

    switch (
      position.id
    ) {
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
        detectorScore ||
          0,
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
      position.id ===
      "smile"
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
      score: clamp(
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
          640,
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
        0.78
      );
    } catch (_) {
      return null;
    }
  }

  /*
   * ==========================================================
   * CÂMERA
   * ==========================================================
   */

  async function startCamera() {
    if (
      !videoElement
    ) {
      throw new Error(
        "Elemento de vídeo facial não encontrado."
      );
    }

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices
        .getUserMedia
    ) {
      throw new Error(
        "O navegador não disponibiliza acesso à câmera."
      );
    }

    if (stream) {
      return stream;
    }

    setStatus(
      "A solicitar acesso à câmera...",
      "info"
    );

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

    videoElement.srcObject =
      stream;

    videoElement.muted = true;

    videoElement.playsInline =
      true;

    await videoElement.play();

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
          videoElement.readyState >=
            2 &&
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
            10000
          );

        const ready =
          () => {
            if (
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

            videoElement.removeEventListener(
              "loadedmetadata",
              ready
            );

            videoElement.removeEventListener(
              "canplay",
              ready
            );
          };

        videoElement.addEventListener(
          "loadedmetadata",
          ready
        );

        videoElement.addEventListener(
          "canplay",
          ready
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

    if (
      videoElement
    ) {
      try {
        videoElement.pause();
      } catch (_) {}

      videoElement.srcObject =
        null;
    }
  }

  /*
   * ==========================================================
   * INICIALIZAÇÃO
   * ==========================================================
   */

  async function initialize(
    options = {}
  ) {
    callbacks = {
      onStatus:
        options.onStatus,

      onProgress:
        options.onProgress,

      onPosition:
        options.onPosition,

      onComplete:
        options.onComplete,

      onError:
        options.onError
    };

    videoElement =
      options.videoElement ||
      videoElement;

    clientId =
      options.clientId ||
      clientId;

    if (
      !videoElement
    ) {
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

      initialized =
        true;

      setStatus(
        "Motor facial local pronto.",
        "success"
      );

      return true;
    } catch (error) {
      initialized =
        false;

      emitError(
        error.message ||
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

    currentPositionIndex =
      0;

    stableFrames =
      0;

    positionStartedAt =
      0;

    completedPositions =
      [];

    capturedPositions =
      [];

    result =
      null;

    if (
      animationFrame
    ) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame =
        null;
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
      !initialized
    ) {
      await initialize({
        videoElement,
        clientId,
        onStatus:
          callbacks.onStatus,
        onProgress:
          callbacks.onProgress,
        onPosition:
          callbacks.onPosition,
        onComplete:
          callbacks.onComplete,
        onError:
          callbacks.onError
      });
    }

    reset();

    await startCamera();

    running =
      true;

    positionStartedAt =
      Date.now();

    const position =
      getCurrentPosition();

    if (
      position
    ) {
      setStatus(
        position.instruction,
        "instruction"
      );

      speak(
        position.instruction
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

  async function processFrame(
    timestamp
  ) {
    if (
      !running
    ) {
      return;
    }

    animationFrame =
      requestAnimationFrame(
        processFrame
      );

    if (
      processing
    ) {
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

    processing =
      true;

    try {
      await analyzeFrame();
    } catch (error) {
      console.warn(
        "[FacialPreflight] frame error",
        error
      );
    } finally {
      processing =
        false;
    }
  }

  async function analyzeFrame() {
    if (
      !running ||
      !faceApi ||
      !videoElement
    ) {
      return;
    }

    const position =
      getCurrentPosition();

    if (
      !position
    ) {
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

    if (
      !detections ||
      !detections.length
    ) {
      stableFrames =
        0;

      setStatus(
        "Posicione o rosto diante da câmera.",
        "warning"
      );

      emitProgress();

      return;
    }

    if (
      detections.length >
      CONFIG.maxFaces
    ) {
      stableFrames =
        0;

      setStatus(
        "Deixe apenas uma pessoa diante da câmera.",
        "warning"
      );

      emitProgress();

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

    if (
      evaluation.score >=
      CONFIG.positionScoreThreshold
    ) {
      stableFrames++;
    } else {
      stableFrames =
        0;
    }

    let message =
      position.instruction;

    if (
      position.id ===
        "smile" &&
      evaluation.smileScore <
        0.50
    ) {
      message =
        "Sorria para completar esta posição.";
    }

    if (
      evaluation.brightnessScore <
      0.60
    ) {
      message =
        "Melhore a iluminação do rosto.";
    }

    if (
      evaluation.faceSizeScore <
      0.55
    ) {
      message =
        "Aproxime ou afaste ligeiramente o rosto da câmera.";
    }

    if (
      evaluation.score >=
      CONFIG.positionScoreThreshold
    ) {
      message =
        "Perfeito. Mantenha esta posição.";
    }

    setStatus(
      message,
      evaluation.score >=
        CONFIG.positionScoreThreshold
        ? "success"
        : "instruction"
    );

    emitProgress(
      evaluation
    );

    if (
      Date.now() -
        positionStartedAt >
      CONFIG.positionTimeoutMs
    ) {
      stableFrames =
        0;

      positionStartedAt =
        Date.now();

      speak(
        position.instruction
      );
    }

    if (
      stableFrames >=
      CONFIG.stableFramesRequired
    ) {
      await completePosition(
        evaluation
      );
    }
  }

  /*
   * ==========================================================
   * COMPLETAR POSIÇÃO
   * ==========================================================
   */

  async function completePosition(
    evaluation
  ) {
    const position =
      getCurrentPosition();

    if (
      !position ||
      !running
    ) {
      return;
    }

    stableFrames =
      0;

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
        completed:
          true,

        completedCount:
          completedPositions.length,

        total:
          POSITIONS.length,

        position: {
          id:
            position.id,

          label:
            position.label
        },

        score:
          evaluation.score
      }
    );

    const next =
      currentPositionIndex +
      1;

    if (
      next >=
      POSITIONS.length
    ) {
      await finish();
      return;
    }

    currentPositionIndex =
      next;

    positionStartedAt =
      Date.now();

    const nextPosition =
      getCurrentPosition();

    setStatus(
      nextPosition.instruction,
      "instruction"
    );

    speak(
      nextPosition.instruction
    );

    emitProgress();
  }

  /*
   * ==========================================================
   * PROGRESSO
   * ==========================================================
   */

  function emitProgress(
    evaluation = null
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
            (completed /
              total) *
              100
          ),

        currentPosition:
          getCurrentPosition()
            ? getCurrentPosition().id
            : null,

        currentPositionIndex,

        evaluation
      }
    );
  }

  /*
   * ==========================================================
   * FINALIZAÇÃO
   * ==========================================================
   */

  async function finish() {
    running =
      false;

    if (
      animationFrame
    ) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame =
        null;
    }

    stopSpeech();

    const scores =
      capturedPositions.map(
        item =>
          Number(
            item.score || 0
          )
      );

    const score =
      average(scores);

    result = {
      completed:
        completedPositions.length ===
        POSITIONS.length,

      success:
        completedPositions.length ===
          POSITIONS.length &&
        score >=
          CONFIG.overallScoreThreshold,

      clientId,

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

      completedAt:
        new Date().toISOString()
    };

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
    running =
      false;

    if (
      animationFrame
    ) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame =
        null;
    }

    stopSpeech();

    stopCamera();
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

    if (
      !targetClientId
    ) {
      throw new Error(
        "ID do cliente não encontrado."
      );
    }

    const body = {
      clientId:
        targetClientId,

      completed:
        Boolean(
          result &&
          result.completed
        ),

      score:
        result
          ? result.score
          : 0,

      completedCount:
        result
          ? result.completedCount
          : 0,

      total:
        POSITIONS.length,

      positions:
        result
          ? result.positions
          : [],

      passportMatch:
        payload.passportMatch ||
        null,

      facialResult:
        result || null
    };

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          targetClientId
        )}/facial-preflight`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
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
        data &&
        (
          data.message ||
          data.error
        )
          ? data.message ||
              data.error
          : "O servidor recusou o resultado facial."
      );
    }

    return data;
  }

  /*
   * ==========================================================
   * API
   * ==========================================================
   */

  function getResult() {
    return result;
  }

  function getPositions() {
    return POSITIONS.map(
      item => ({
        ...item
      })
    );
  }

  function isReady() {
    return Boolean(
      initialized &&
      faceApi
    );
  }

  window.TravelFacialPreflight =
    {
      initialize,
      start,
      stop,
      reset,
      finish,
      submitToBackend,
      getResult,
      getPositions,
      isReady,

      constants: {
        AUDIO_LANGUAGE,

        POSITIONS,

        CONFIG,

        FACE_API_MODEL_URL
      }
    };

  console.info(
    "[FacialPreflight] Motor facial local disponível."
  );
})();
