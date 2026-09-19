/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT
 * ============================================================
 *
 * MOTOR FACIAL LOCAL
 *
 * Esta versão utiliza:
 * - face-api.js
 * - Tiny Face Detector
 * - Face Landmark 68
 * - Face Expressions
 *
 * NÃO utiliza:
 * - MediaPipe
 * - Face Landmarker
 * - MediaPipe WASM
 * - API externa de reconhecimento facial
 *
 * O processamento facial é feito no navegador.
 * ============================================================
 */

(() => {
  "use strict";

  /*
   * ==========================================================
   * CONFIGURAÇÃO
   * ==========================================================
   */

  const FACE_API_SCRIPT_URL =
    window.TRAVEL_FACE_API_SCRIPT_URL ||
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.min.js";

  const FACE_API_SCRIPT_FALLBACK_URLS = [
    FACE_API_SCRIPT_URL,
    "https://unpkg.com/@vladmandic/face-api@1.7.15/dist/face-api.min.js"
  ].filter(
    (url, index, array) =>
      url && array.indexOf(url) === index
  );

  const FACE_API_MODEL_URL =
    window.TRAVEL_FACE_API_MODEL_URL ||
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

  const FACE_API_MODEL_FALLBACK_URLS = [
    FACE_API_MODEL_URL,
    "https://unpkg.com/@vladmandic/face-api@1.7.15/model"
  ].filter(
    (url, index, array) =>
      url && array.indexOf(url) === index
  );

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

  let completedPositions = [];

  let capturedPositions = [];

  let result = null;

  let callbacks = {};

  let initialized = false;

  let destroyed = false;

  /*
   * ==========================================================
   * UTILITÁRIOS
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

  function setStatus(message, type) {
    safeCall("onStatus", {
      message: String(message || ""),
      type: type || "info"
    });
  }

  function emitError(message, error) {
    const textMessage =
      message ||
      (error && error.message) ||
      "Ocorreu um erro no motor facial.";

    console.error(
      "[FacialPreflight]",
      textMessage,
      error || ""
    );

    safeCall("onError", {
      message: textMessage,
      error: error || null
    });
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function average(values) {
    if (!values || !values.length) {
      return 0;
    }

    return (
      values.reduce(
        (sum, value) =>
          sum + Number(value || 0),
        0
      ) / values.length
    );
  }

  function speak(text) {
    if (
      !text ||
      typeof window === "undefined" ||
      !window.speechSynthesis
    ) {
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(text);

      utterance.lang = AUDIO_LANGUAGE;
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
        typeof window !== "undefined" &&
        window.speechSynthesis
      ) {
        window.speechSynthesis.cancel();
      }
    } catch (error) {
      console.warn(
        "[FacialPreflight] speech stop error",
        error
      );
    }
  }

  function getCurrentPosition() {
    return (
      POSITIONS[currentPositionIndex] ||
      null
    );
  }

  function getCompletedCount() {
    return completedPositions.length;
  }

  /*
   * ==========================================================
   * CARREGAMENTO DO FACE-API
   * ==========================================================
   */

  async function loadFaceApiScript() {
    if (window.faceapi) {
      faceApi = window.faceapi;
      return faceApi;
    }

    if (faceApiPromise) {
      return faceApiPromise;
    }

    faceApiPromise = (async () => {
      let lastError = null;

      for (
        const url of FACE_API_SCRIPT_FALLBACK_URLS
      ) {
        try {
          if (window.faceapi) {
            faceApi = window.faceapi;
            return faceApi;
          }

          const existingScript =
            document.querySelector(
              "script[data-travel-face-api]"
            );

          if (existingScript) {
            existingScript.remove();
          }

          setStatus(
            "A carregar o motor facial local...",
            "info"
          );

          const api =
            await new Promise(
              (resolve, reject) => {
                const script =
                  document.createElement(
                    "script"
                  );

                script.src = url;
                script.async = true;
                script.defer = true;

                script.dataset.travelFaceApi =
                  "true";

                let settled = false;

                const cleanup = () => {
                  script.onload = null;
                  script.onerror = null;
                };

                script.onload = () => {
                  if (settled) {
                    return;
                  }

                  settled = true;

                  cleanup();

                  if (
                    window.faceapi
                  ) {
                    resolve(
                      window.faceapi
                    );
                    return;
                  }

                  reject(
                    new Error(
                      "A biblioteca FaceAPI foi carregada, mas não ficou disponível."
                    )
                  );
                };

                script.onerror = () => {
                  if (settled) {
                    return;
                  }

                  settled = true;

                  cleanup();

                  reject(
                    new Error(
                      "Não foi possível carregar FaceAPI através de " +
                        url
                    )
                  );
                };

                document.head.appendChild(
                  script
                );
              }
            );

          faceApi = api;

          console.info(
            "[FacialPreflight] FaceAPI carregada:",
            url
          );

          return api;
        } catch (error) {
          lastError = error;

          console.warn(
            "[FacialPreflight] Falha no CDN:",
            url,
            error
          );
        }
      }

      throw (
        lastError ||
        new Error(
          "Não foi possível carregar a biblioteca facial."
        )
      );
    })();

    try {
      return await faceApiPromise;
    } catch (error) {
      faceApiPromise = null;

      throw new Error(
        "Falha ao carregar o motor facial local. Verifique a ligação à internet e tente novamente."
      );
    }
  }

  /*
   * ==========================================================
   * CARREGAMENTO DOS MODELOS
   * ==========================================================
   */

  async function loadModels() {
    if (modelsPromise) {
      return modelsPromise;
    }

    modelsPromise = (async () => {
      const api =
        await loadFaceApiScript();

      let lastError = null;

      for (
        const modelUrl of FACE_API_MODEL_FALLBACK_URLS
      ) {
        try {
          setStatus(
            "A preparar o reconhecimento facial...",
            "info"
          );

          await api.nets
            .tinyFaceDetector
            .loadFromUri(modelUrl);

          await api.nets
            .faceLandmark68Net
            .loadFromUri(modelUrl);

          await api.nets
            .faceExpressionNet
            .loadFromUri(modelUrl);

          console.info(
            "[FacialPreflight] Modelos carregados:",
            modelUrl
          );

          return true;
        } catch (error) {
          lastError = error;

          console.warn(
            "[FacialPreflight] Falha nos modelos:",
            modelUrl,
            error
          );
        }
      }

      throw (
        lastError ||
        new Error(
          "Não foi possível carregar os modelos faciais."
        )
      );
    })();

    try {
      return await modelsPromise;
    } catch (error) {
      modelsPromise = null;

      throw new Error(
        "Não foi possível carregar os modelos faciais locais. Verifique a ligação à internet e tente novamente."
      );
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
            willReadFrequently: true
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
   * QUALIDADE DA IMAGEM
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

    const height = Math.max(
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
      let index = 0;
      index < data.length;
      index += 16
    ) {
      const r =
        data[index];

      const g =
        data[index + 1];

      const b =
        data[index + 2];

      total +=
        0.299 * r +
        0.587 * g +
        0.114 * b;

      count += 1;
    }

    return count
      ? total / count
      : 128;
  }

  function calculateBrightnessScore(
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
   * LANDMARKS / POSE
   * ==========================================================
   */

  function pointDistance(a, b) {
    if (!a || !b) {
      return 0;
    }

    return Math.hypot(
      b.x - a.x,
      b.y - a.y
    );
  }

  function getLandmarkPoint(
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
      landmarks.positions[index] ||
      null
    );
  }

  function calculatePose(
    landmarks
  ) {
    const nose =
      getLandmarkPoint(
        landmarks,
        30
      );

    const leftEye =
      getLandmarkPoint(
        landmarks,
        36
      );

    const rightEye =
      getLandmarkPoint(
        landmarks,
        45
      );

    const leftCheek =
      getLandmarkPoint(
        landmarks,
        2
      );

    const rightCheek =
      getLandmarkPoint(
        landmarks,
        14
      );

    const forehead =
      getLandmarkPoint(
        landmarks,
        27
      );

    const chin =
      getLandmarkPoint(
        landmarks,
        8
      );

    if (
      !nose ||
      !leftEye ||
      !rightEye ||
      !leftCheek ||
      !rightCheek ||
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
      pointDistance(
        leftEye,
        rightEye
      ) || 1;

    const faceWidth =
      pointDistance(
        leftCheek,
        rightCheek
      ) || 1;

    const faceHeight =
      pointDistance(
        forehead,
        chin
      ) || 1;

    const horizontalOffset =
      (nose.x -
        eyeCenterX) /
      eyeDistance;

    const verticalOffset =
      (nose.y -
        eyeCenterY) /
      faceHeight;

    const eyeSlope =
      (rightEye.y -
        leftEye.y) /
      eyeDistance;

    return {
      yaw: horizontalOffset,

      pitch: verticalOffset,

      roll: eyeSlope
    };
  }

  /*
   * ==========================================================
   * SORRISO
   * ==========================================================
   */

  function calculateSmileScore(
    expressions
  ) {
    if (!expressions) {
      return 0;
    }

    return clamp(
      Number(
        expressions.happy || 0
      ),
      0,
      1
    );
  }

  /*
   * ==========================================================
   * TAMANHO DO ROSTO
   * ==========================================================
   */

  function calculateFaceArea(
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

    const videoArea =
      size.width *
      size.height;

    if (!videoArea) {
      return 0;
    }

    const faceArea =
      detection.box.width *
      detection.box.height;

    return faceArea /
      videoArea;
  }

  function calculateFaceSizeScore(
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
   * AVALIAÇÃO DA POSIÇÃO
   * ==========================================================
   */

  function evaluatePosition(
    position,
    pose,
    smileScore,
    faceArea,
    brightness,
    detectionScore
  ) {
    let score = 0;

    let yawScore = 0;

    let pitchScore = 0;

    let rollScore = 0;

    let smilePositionScore = 0;

    /*
     * Valores negativos/positivos:
     *
     * yaw:
     *   negativo = esquerda
     *   positivo = direita
     *
     * pitch:
     *   negativo = cima
     *   positivo = baixo
     */

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
            smileScore /
              CONFIG.smileThreshold,
            0,
            1
          );

        break;

      default:
        yawScore = 1;
        pitchScore = 1;
        break;
    }

    rollScore =
      1 -
      clamp(
        roll /
          0.30,
        0,
        1
      );

    const faceSizeScore =
      calculateFaceSizeScore(
        faceArea
      );

    const brightnessScore =
      calculateBrightnessScore(
        brightness
      );

    const detection =
      clamp(
        detectionScore || 0,
        0,
        1
      );

    if (
      position.id ===
      "smile"
    ) {
      score =
        detection * 0.20 +
        yawScore * 0.12 +
        pitchScore * 0.12 +
        rollScore * 0.08 +
        smilePositionScore * 0.32 +
        faceSizeScore * 0.08 +
        brightnessScore * 0.08;
    } else {
      score =
        detection * 0.20 +
        yawScore * 0.27 +
        pitchScore * 0.22 +
        rollScore * 0.10 +
        faceSizeScore * 0.10 +
        brightnessScore * 0.11;
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

      faceSizeScore,

      brightnessScore,

      detectionScore:
        detection
    };
  }

  /*
   * ==========================================================
   * MENSAGENS
   * ==========================================================
   */

  function buildLiveMessage(
    position,
    evaluation,
    faceDetected
  ) {
    if (!faceDetected) {
      return "Posicione o rosto diante da câmera.";
    }

    if (
      evaluation.faceSizeScore <
      0.55
    ) {
      return "Aproxime ou afaste o rosto ligeiramente da câmera.";
    }

    if (
      evaluation.brightnessScore <
      0.60
    ) {
      return "Melhore a iluminação do rosto.";
    }

    if (
      evaluation.rollScore <
      0.45
    ) {
      return "Mantenha o dispositivo estável.";
    }

    if (
      position.id ===
      "smile" &&
      evaluation.smileScore <
        0.50
    ) {
      return "Sorria para completar esta posição.";
    }

    if (
      evaluation.score >=
      CONFIG.positionScoreThreshold
    ) {
      return "Perfeito. Mantenha esta posição.";
    }

    return position.instruction;
  }

  /*
   * ==========================================================
   * CAPTURA
   * ==========================================================
   */

  function captureCurrentFrame() {
    if (
      !videoElement ||
      !videoElement.videoWidth ||
      !videoElement.videoHeight
    ) {
      return null;
    }

    try {
      const canvas =
        document.createElement(
          "canvas"
        );

      const maxWidth = 640;

      const ratio =
        videoElement.videoHeight /
        videoElement.videoWidth;

      canvas.width =
        Math.min(
          maxWidth,
          videoElement.videoWidth
        );

      canvas.height =
        Math.round(
          canvas.width * ratio
        );

      const context =
        canvas.getContext(
          "2d"
        );

      context.drawImage(
        videoElement,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return {
        dataUrl:
          canvas.toDataURL(
            "image/jpeg",
            0.78
          ),

        width:
          canvas.width,

        height:
          canvas.height
      };
    } catch (error) {
      console.warn(
        "[FacialPreflight] capture failed",
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

    try {
      await videoElement.play();
    } catch (error) {
      console.warn(
        "[FacialPreflight] video play warning",
        error
      );
    }

    await waitForVideo();

    ensureCanvas();

    return stream;
  }

  function waitForVideo() {
    return new Promise(
      (resolve, reject) => {
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
          setTimeout(() => {
            cleanup();

            reject(
              new Error(
                "A câmera não ficou pronta a tempo."
              )
            );
          }, 10000);

        const onReady = () => {
          if (
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

          if (
            videoElement
          ) {
            videoElement.removeEventListener(
              "loadedmetadata",
              onReady
            );

            videoElement.removeEventListener(
              "canplay",
              onReady
            );
          }
        };

        videoElement.addEventListener(
          "loadedmetadata",
          onReady
        );

        videoElement.addEventListener(
          "canplay",
          onReady
        );
      }
    );
  }

  function stopCamera() {
    if (stream) {
      try {
        stream
          .getTracks()
          .forEach(
            track => {
              try {
                track.stop();
              } catch (_) {}
            }
          );
      } catch (_) {}
    }

    stream = null;

    if (videoElement) {
      try {
        videoElement.pause();
      } catch (_) {}

      try {
        videoElement.srcObject =
          null;
      } catch (_) {}
    }
  }

  /*
   * ==========================================================
   * INICIALIZAÇÃO
   * ==========================================================
   */

  async function initialize(options) {
    options =
      options || {};

    destroyed = false;

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
      null;

    clientId =
      options.clientId ||
      null;

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
        "Motor facial local pronto.",
        "success"
      );

      return true;
    } catch (error) {
      initialized = false;

      emitError(
        error.message ||
          "Falha ao carregar o motor facial local.",
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

    completedPositions = [];

    capturedPositions = [];

    result = null;

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
   * INÍCIO
   * ==========================================================
   */

  async function start(options) {
    options =
      options || {};

    if (options.clientId) {
      clientId =
        options.clientId;
    }

    if (!initialized) {
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

    running = true;

    positionStartedAt =
      Date.now();

    const firstPosition =
      getCurrentPosition();

    if (firstPosition) {
      setStatus(
        firstPosition.instruction,
        "instruction"
      );

      speak(
        firstPosition.instruction
      );
    }

    emitProgress();

    scheduleDetection();

    return true;
  }

  /*
   * ==========================================================
   * LOOP DE DETECÇÃO
   * ==========================================================
   */

  function scheduleDetection() {
    if (!running) {
      return;
    }

    animationFrame =
      requestAnimationFrame(
        processFrame
      );
  }

  async function processFrame(
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

    try {
      await analyzeFrame();
    } catch (error) {
      console.warn(
        "[FacialPreflight] frame analysis error",
        error
      );
    } finally {
      processing = false;
    }
  }

  async function analyzeFrame() {
    if (
      !faceApi ||
      !videoElement ||
      !running
    ) {
      return;
    }

    if (
      videoElement.readyState <
      2
    ) {
      return;
    }

    const position =
      getCurrentPosition();

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

    if (
      !detections ||
      !detections.length
    ) {
      stableFrames = 0;

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
      stableFrames = 0;

      setStatus(
        "Deixe apenas uma pessoa diante da câmera.",
        "warning"
      );

      emitProgress();

      return;
    }

    const detection =
      detections[0];

    const faceArea =
      calculateFaceArea(
        detection.detection
      );

    const pose =
      calculatePose(
        detection.landmarks
      );

    const smileScore =
      calculateSmileScore(
        detection.expressions
      );

    const evaluation =
      evaluatePosition(
        position,
        pose,
        smileScore,
        faceArea,
        brightness,
        detection.detection.score
      );

    const message =
      buildLiveMessage(
        position,
        evaluation,
        true
      );

    setStatus(
      message,
      evaluation.score >=
        CONFIG.positionScoreThreshold
        ? "success"
        : "instruction"
    );

    if (
      evaluation.score >=
      CONFIG.positionScoreThreshold
    ) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
    }

    emitProgress(
      evaluation
    );

    const timeout =
      Date.now() -
        positionStartedAt >
      CONFIG.positionTimeoutMs;

    if (timeout) {
      stableFrames = 0;

      positionStartedAt =
        Date.now();

      setStatus(
        position.instruction,
        "instruction"
      );

      speak(
        position.instruction
      );
    }

    if (
      stableFrames >=
      CONFIG.stableFramesRequired
    ) {
      await completeCurrentPosition(
        evaluation
      );
    }
  }

  /*
   * ==========================================================
   * POSIÇÃO COMPLETA
   * ==========================================================
   */

  async function completeCurrentPosition(
    evaluation
  ) {
    if (!running) {
      return;
    }

    const position =
      getCurrentPosition();

    if (!position) {
      return;
    }

    stableFrames = 0;

    const capture =
      captureCurrentFrame();

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
        capture
          ? capture.dataUrl
          : null
    });

    safeCall(
      "onPosition",
      {
        completed: true,

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

        captured: Boolean(
          capture
        ),

        score:
          evaluation.score
      }
    );

    emitProgress(
      evaluation
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
    evaluation
  ) {
    const current =
      getCurrentPosition();

    const completed =
      getCompletedCount();

    const total =
      POSITIONS.length;

    const progress =
      total
        ? Math.round(
            (completed /
              total) *
              100
          )
        : 0;

    safeCall(
      "onProgress",
      {
        completed,

        total,

        progress,

        currentPosition:
          current
            ? current.id
            : null,

        currentPositionIndex:
          currentPositionIndex,

        position:
          current
            ? current.id
            : null,

        evaluation:
          evaluation || null
      }
    );
  }

  /*
   * ==========================================================
   * FINALIZAÇÃO
   * ==========================================================
   */

  async function finish() {
    if (
      result &&
      result.completed
    ) {
      return result;
    }

    running = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    stopSpeech();

    const scores =
      capturedPositions
        .map(
          item =>
            Number(
              item.score || 0
            )
        )
        .filter(
          Number.isFinite
        );

    const overallScore =
      scores.length
        ? average(scores)
        : 0;

    result = {
      completed:
        completedPositions.length ===
        POSITIONS.length,

      success:
        completedPositions.length ===
          POSITIONS.length &&
        overallScore >=
          CONFIG.overallScoreThreshold,

      clientId:

        clientId,

      completedCount:
        completedPositions.length,

      total:
        POSITIONS.length,

      score:
        Number(
          overallScore.toFixed(
            4
          )
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
   * PARAR
   * ==========================================================
   */

  function stop() {
    running = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    stopSpeech();

    /*
     * A câmera é parada aqui porque o usuário
     * explicitamente solicitou a interrupção.
     */
    stopCamera();
  }

  /*
   * ==========================================================
   * ENVIO AO BACKEND
   * ==========================================================
   */

  async function submitToBackend(
    payload
  ) {
    payload =
      payload || {};

    const targetClientId =
      payload.clientId ||
      clientId;

    if (!targetClientId) {
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
        "/api/clients/" +
          encodeURIComponent(
            targetClientId
          ) +
          "/facial-preflight",
        {
          method: "POST",

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

    let data = null;

    try {
      data =
        await response.json();
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        data &&
        (
          data.message ||
          data.error
        )
          ? data.message ||
              data.error
          : "O servidor recusou o resultado do reconhecimento facial."
      );
    }

    return data;
  }

  /*
   * ==========================================================
   * RESULTADO
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

  /*
   * ==========================================================
   * API PÚBLICA
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

    isReady,

    constants: {
      AUDIO_LANGUAGE,

      POSITIONS,

      CONFIG,

      FACE_API_MODEL_URL,

      FACE_API_MODEL_FALLBACK_URLS
    }
  };

  console.info(
    "[FacialPreflight] Motor facial local disponível."
  );
})();
