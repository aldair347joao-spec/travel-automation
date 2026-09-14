/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT
 * ============================================================
 *
 * Objetivo:
 * - Usar a câmera real do dispositivo.
 * - Detectar rosto localmente com MediaPipe Face Landmarker.
 * - Orientar o cliente sobre enquadramento, distância,
 *   pose, iluminação e sorriso.
 * - Executar uma sequência de 10 posições.
 * - Enviar somente métricas/resultados para o backend.
 *
 * IMPORTANTE:
 * Este módulo NÃO:
 * - falsifica câmera;
 * - reproduz vídeo como webcam;
 * - tenta enganar sistemas de liveness;
 * - substitui a verificação oficial do VFS;
 * - grava vídeo do cliente.
 *
 * As imagens usadas durante a análise permanecem em memória.
 * ============================================================
 */

(() => {
  "use strict";

  const MEDIAPIPE_VERSION = "0.10.22";

  const WASM_PATH =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

  const MODEL_PATH =
    "https://storage.googleapis.com/mediapipe-models/" +
    "face_landmarker/face_landmarker/float16/1/" +
    "face_landmarker.task";

  const MEDIAPIPE_MODULE =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`;

  const POSITIONS = [
    {
      id: "frontal",
      label: "Olhe diretamente para a câmera",
      instruction:
        "Mantenha o rosto de frente para a câmera.",
      duration: 1100
    },

    {
      id: "left",
      label: "Vire lentamente para a esquerda",
      instruction:
        "Vire a cabeça suavemente para a esquerda.",
      duration: 1100
    },

    {
      id: "right",
      label: "Vire lentamente para a direita",
      instruction:
        "Vire a cabeça suavemente para a direita.",
      duration: 1100
    },

    {
      id: "up",
      label: "Olhe ligeiramente para cima",
      instruction:
        "Levante o olhar e incline ligeiramente a cabeça para cima.",
      duration: 1100
    },

    {
      id: "down",
      label: "Olhe ligeiramente para baixo",
      instruction:
        "Baixe ligeiramente o olhar e a cabeça.",
      duration: 1100
    },

    {
      id: "left_up",
      label: "Esquerda e cima",
      instruction:
        "Vire ligeiramente para a esquerda e para cima.",
      duration: 1100
    },

    {
      id: "right_up",
      label: "Direita e cima",
      instruction:
        "Vire ligeiramente para a direita e para cima.",
      duration: 1100
    },

    {
      id: "left_down",
      label: "Esquerda e baixo",
      instruction:
        "Vire ligeiramente para a esquerda e para baixo.",
      duration: 1100
    },

    {
      id: "right_down",
      label: "Direita e baixo",
      instruction:
        "Vire ligeiramente para a direita e para baixo.",
      duration: 1100
    },

    {
      id: "smile",
      label: "Sorria naturalmente",
      instruction:
        "Olhe para a câmera e faça um sorriso natural.",
      duration: 1300
    }
  ];

  const CONFIG = {
    minFaceArea: 0.08,
    maxFaceArea: 0.72,

    idealFaceAreaMin: 0.14,
    idealFaceAreaMax: 0.48,

    minBrightness: 45,
    maxBrightness: 220,

    minSharpness: 20,

    stableFramesRequired: 8,

    detectionIntervalMs: 80,

    positionScoreThreshold: 0.75,

    overallScoreThreshold: 0.82,

    smileThreshold: 0.58,

    positionTimeoutMs: 10000,

    maxFaces: 2
  };

  let visionModule = null;
  let faceLandmarker = null;

  let video = null;
  let canvas = null;
  let canvasContext = null;

  let stream = null;
  let running = false;
  let initialized = false;

  let currentPositionIndex = 0;
  let currentPositionStartedAt = 0;

  let stableFrames = 0;
  let lastDetectionAt = 0;

  let capturedPositions = [];

  let animationFrame = null;

  let currentClientId = null;

  let callbacks = {
    onStatus: null,
    onProgress: null,
    onPosition: null,
    onComplete: null,
    onError: null
  };

  /*
   * ----------------------------------------------------------
   * UTILIDADES
   * ----------------------------------------------------------
   */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function average(values) {
    if (!values.length) return 0;

    return (
      values.reduce(
        (sum, value) => sum + value,
        0
      ) / values.length
    );
  }

  function safeNumber(value, fallback = 0) {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  function emit(name, payload) {
    const callback = callbacks[name];

    if (typeof callback === "function") {
      try {
        callback(payload);
      } catch (error) {
        console.error(
          `[FacialPreflight] callback ${name} failed`,
          error
        );
      }
    }
  }

  function setStatus(message, type = "info") {
    emit("onStatus", {
      message,
      type
    });
  }

  /*
   * ----------------------------------------------------------
   * MEDIA PIPE
   * ----------------------------------------------------------
   */

  async function loadMediaPipe() {
    if (visionModule) {
      return visionModule;
    }

    visionModule =
      await import(MEDIAPIPE_MODULE);

    return visionModule;
  }

  async function createLandmarker() {
    const vision =
      await loadMediaPipe();

    const {
      FaceLandmarker,
      FilesetResolver
    } = vision;

    const fileset =
      await FilesetResolver.forVisionTasks(
        WASM_PATH
      );

    /*
     * Primeiro tentamos GPU.
     *
     * Alguns dispositivos móveis não conseguem
     * inicializar o backend GPU corretamente.
     *
     * Nesse caso fazemos fallback para CPU.
     */

    try {
      faceLandmarker =
        await FaceLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: {
              modelAssetPath:
                MODEL_PATH,

              delegate: "GPU"
            },

            runningMode: "VIDEO",

            numFaces: CONFIG.maxFaces,

            minFaceDetectionConfidence: 0.55,

            minFacePresenceConfidence: 0.55,

            minTrackingConfidence: 0.55,

            outputFaceBlendshapes: true,

            outputFacialTransformationMatrixes:
              true
          }
        );
    } catch (gpuError) {
      console.warn(
        "[FacialPreflight] GPU indisponível; usando CPU.",
        gpuError
      );

      faceLandmarker =
        await FaceLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: {
              modelAssetPath:
                MODEL_PATH,

              delegate: "CPU"
            },

            runningMode: "VIDEO",

            numFaces: CONFIG.maxFaces,

            minFaceDetectionConfidence: 0.55,

            minFacePresenceConfidence: 0.55,

            minTrackingConfidence: 0.55,

            outputFaceBlendshapes: true,

            outputFacialTransformationMatrixes:
              true
          }
        );
    }

    return faceLandmarker;
  }

  /*
   * ----------------------------------------------------------
   * CAMERA
   * ----------------------------------------------------------
   */

  async function startCamera() {
    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Este navegador não disponibiliza acesso à câmera."
      );
    }

    stopCamera();

    stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "user"
          },

          width: {
            ideal: 1280
          },

          height: {
            ideal: 720
          },

          frameRate: {
            ideal: 30,
            max: 30
          }
        },

        audio: false
      });

    if (!video) {
      throw new Error(
        "Elemento de vídeo não foi configurado."
      );
    }

    video.srcObject = stream;

    video.muted = true;

    video.playsInline = true;

    await video.play();

    setStatus(
      "Câmera ativada. Vamos verificar o enquadramento.",
      "success"
    );
  }

  function stopCamera() {
    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    running = false;

    if (stream) {
      stream
        .getTracks()
        .forEach(track => {
          try {
            track.stop();
          } catch (_) {}
        });

      stream = null;
    }

    if (video) {
      video.srcObject = null;
    }
  }

  /*
   * ----------------------------------------------------------
   * CANVAS
   * ----------------------------------------------------------
   */

  function ensureCanvas() {
    if (!canvas) {
      canvas =
        document.createElement("canvas");

      canvas.width = 640;
      canvas.height = 480;

      canvasContext =
        canvas.getContext(
          "2d",
          {
            willReadFrequently: true
          }
        );
    }
  }

  function analyzeImageQuality() {
    if (
      !video ||
      video.readyState <
        HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return {
        brightness: 0,
        brightnessScore: 0,
        sharpness: 0,
        sharpnessScore: 0
      };
    }

    ensureCanvas();

    canvasContext.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const imageData =
      canvasContext.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    let brightnessSum = 0;

    let varianceSum = 0;

    let previousGray = null;

    let samples = 0;

    for (
      let i = 0;
      i < data.length;
      i += 16
    ) {
      const r = data[i];

      const g = data[i + 1];

      const b = data[i + 2];

      const gray =
        0.299 * r +
        0.587 * g +
        0.114 * b;

      brightnessSum += gray;

      if (
        previousGray !== null
      ) {
        const difference =
          Math.abs(
            gray -
            previousGray
          );

        varianceSum +=
          difference * difference;
      }

      previousGray = gray;

      samples++;
    }

    const brightness =
      samples
        ? brightnessSum / samples
        : 0;

    const sharpness =
      samples
        ? varianceSum / samples
        : 0;

    let brightnessScore = 1;

    if (
      brightness <
      CONFIG.minBrightness
    ) {
      brightnessScore =
        clamp(
          brightness /
            CONFIG.minBrightness,
          0,
          1
        );
    } else if (
      brightness >
      CONFIG.maxBrightness
    ) {
      brightnessScore =
        clamp(
          (255 - brightness) /
            (255 -
              CONFIG.maxBrightness),
          0,
          1
        );
    }

    const sharpnessScore =
      clamp(
        sharpness /
          100,
        0,
        1
      );

    return {
      brightness:
        Math.round(
          brightness
        ),

      brightnessScore,

      sharpness:
        Math.round(
          sharpness
        ),

      sharpnessScore
    };
  }

  /*
   * ----------------------------------------------------------
   * FACE GEOMETRY
   * ----------------------------------------------------------
   */

  function calculateBoundingBox(
    landmarks
  ) {
    if (
      !landmarks ||
      !landmarks.length
    ) {
      return null;
    }

    let minX = 1;

    let maxX = 0;

    let minY = 1;

    let maxY = 0;

    for (
      const point
      of landmarks
    ) {
      minX =
        Math.min(
          minX,
          point.x
        );

      maxX =
        Math.max(
          maxX,
          point.x
        );

      minY =
        Math.min(
          minY,
          point.y
        );

      maxY =
        Math.max(
          maxY,
          point.y
        );
    }

    const width =
      maxX - minX;

    const height =
      maxY - minY;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,

      area:
        width * height,

      centerX:
        minX +
        width / 2,

      centerY:
        minY +
        height / 2
    };
  }

  function distance(
    a,
    b
  ) {
    if (!a || !b) {
      return 0;
    }

    const dx =
      a.x - b.x;

    const dy =
      a.y - b.y;

    const dz =
      (a.z || 0) -
      (b.z || 0);

    return Math.sqrt(
      dx * dx +
      dy * dy +
      dz * dz
    );
  }

  /*
   * ----------------------------------------------------------
   * POSE
   * ----------------------------------------------------------
   *
   * Estas estimativas servem para orientação.
   * Não são uma decisão biométrica de identidade.
   * ----------------------------------------------------------
   */

  function estimatePose(
    landmarks
  ) {
    /*
     * MediaPipe Face Mesh:
     *
     * 1   - região próxima do olho direito
     * 33  - canto externo do olho
     * 263 - canto externo do outro olho
     * 168 - região central
     * 1   - nariz
     * 152 - queixo
     *
     * Usamos relações geométricas,
     * não reconhecimento de identidade.
     */

    const nose =
      landmarks[1];

    const chin =
      landmarks[152];

    const leftEye =
      landmarks[33];

    const rightEye =
      landmarks[263];

    const forehead =
      landmarks[10];

    if (
      !nose ||
      !chin ||
      !leftEye ||
      !rightEye ||
      !forehead
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
      Math.max(
        0.001,
        distance(
          leftEye,
          rightEye
        )
      );

    const yaw =
      clamp(
        (
          nose.x -
          eyeCenterX
        ) /
          eyeDistance,
        -1,
        1
      );

    const verticalFace =
      Math.max(
        0.001,
        distance(
          forehead,
          chin
        )
      );

    const expectedNoseY =
      eyeCenterY +
      (
        chin.y -
        eyeCenterY
      ) *
        0.48;

    const pitch =
      clamp(
        (
          nose.y -
          expectedNoseY
        ) /
          verticalFace,
        -1,
        1
      );

    const roll =
      Math.atan2(
        rightEye.y -
          leftEye.y,

        rightEye.x -
          leftEye.x
      );

    return {
      yaw,
      pitch,
      roll
    };
  }

  /*
   * ----------------------------------------------------------
   * SMILE
   * ----------------------------------------------------------
   */

  function estimateSmile(
    landmarks,
    blendshapes
  ) {
    /*
     * Se o modelo fornecer blendshapes,
     * usamos os coeficientes de sorriso.
     */

    if (
      Array.isArray(
        blendshapes
      ) &&
      blendshapes.length
    ) {
      const categories =
        blendshapes[0]
          ?.categories || [];

      const left =
        categories.find(
          item =>
            item.categoryName ===
            "mouthSmileLeft"
        );

      const right =
        categories.find(
          item =>
            item.categoryName ===
            "mouthSmileRight"
        );

      const smile =
        average([
          left?.score || 0,
          right?.score || 0
        ]);

      return clamp(
        smile,
        0,
        1
      );
    }

    /*
     * Fallback geométrico.
     */

    const leftMouth =
      landmarks[61];

    const rightMouth =
      landmarks[291];

    const upperLip =
      landmarks[13];

    const lowerLip =
      landmarks[14];

    if (
      !leftMouth ||
      !rightMouth ||
      !upperLip ||
      !lowerLip
    ) {
      return 0;
    }

    const mouthWidth =
      distance(
        leftMouth,
        rightMouth
      );

    const mouthHeight =
      distance(
        upperLip,
        lowerLip
      );

    if (
      mouthWidth <= 0
    ) {
      return 0;
    }

    return clamp(
      (
        mouthHeight /
        mouthWidth
      ) * 2.5,
      0,
      1
    );
  }

  /*
   * ----------------------------------------------------------
   * DETECÇÃO DE ROSTO
   * ----------------------------------------------------------
   */

  function analyzeResult(
    result
  ) {
    const faces =
      result?.faceLandmarks ||
      [];

    const quality =
      analyzeImageQuality();

    if (faces.length === 0) {
      return {
        faceDetected: false,

        singleFace: false,

        faceCount: 0,

        score: 0,

        issues: [
          "Nenhum rosto foi detectado."
        ],

        quality,

        pose: null,

        smileScore: 0
      };
    }

    if (
      faces.length > 1
    ) {
      return {
        faceDetected: true,

        singleFace: false,

        faceCount: faces.length,

        score: 0,

        issues: [
          "Mais de um rosto foi detectado. Deixe apenas uma pessoa diante da câmera."
        ],

        quality,

        pose: null,

        smileScore: 0
      };
    }

    const landmarks =
      faces[0];

    const box =
      calculateBoundingBox(
        landmarks
      );

    const pose =
      estimatePose(
        landmarks
      );

    const smileScore =
      estimateSmile(
        landmarks,
        result.faceBlendshapes
      );

    const issues = [];

    let framingScore = 1;

    if (!box) {
      issues.push(
        "Não foi possível avaliar o enquadramento."
      );

      framingScore = 0;
    } else {
      if (
        box.area <
        CONFIG.minFaceArea
      ) {
        issues.push(
          "Aproxime o rosto da câmera."
        );

        framingScore *= 0.45;
      }

      if (
        box.area >
        CONFIG.maxFaceArea
      ) {
        issues.push(
          "Afaste um pouco o rosto da câmera."
        );

        framingScore *= 0.55;
      }

      if (
        box.area >=
          CONFIG.idealFaceAreaMin &&
        box.area <=
          CONFIG.idealFaceAreaMax
      ) {
        framingScore = 1;
      }

      if (
        box.centerX <
          0.35
      ) {
        issues.push(
          "Centralize o rosto."
        );

        framingScore *= 0.7;
      }

      if (
        box.centerX >
          0.65
      ) {
        issues.push(
          "Centralize o rosto."
        );

        framingScore *= 0.7;
      }

      if (
        box.centerY <
          0.25
      ) {
        issues.push(
          "Baixe ligeiramente o enquadramento."
        );

        framingScore *= 0.8;
      }

      if (
        box.centerY >
          0.75
      ) {
        issues.push(
          "Suba ligeiramente o enquadramento."
        );

        framingScore *= 0.8;
      }
    }

    const brightnessScore =
      quality.brightnessScore;

    if (
      brightnessScore <
      0.55
    ) {
      issues.push(
        "A iluminação está insuficiente. Procure um local mais iluminado."
      );
    }

    if (
      quality.brightness >
      CONFIG.maxBrightness
    ) {
      issues.push(
        "Há luz excessiva. Evite luz forte diretamente no rosto."
      );
    }

    const sharpnessScore =
      quality.sharpnessScore;

    if (
      sharpnessScore <
      0.25
    ) {
      issues.push(
        "A imagem parece pouco nítida. Mantenha o dispositivo estável."
      );
    }

    const faceScore =
      average([
        framingScore,
        brightnessScore,
        sharpnessScore
      ]);

    return {
      faceDetected: true,

      singleFace: true,

      faceCount: 1,

      score:
        clamp(
          faceScore,
          0,
          1
        ),

      issues,

      quality,

      pose,

      smileScore,

      boundingBox: box
    };
  }

  /*
   * ----------------------------------------------------------
   * POSE MATCH
   * ----------------------------------------------------------
   */

  function positionScore(
    positionId,
    analysis
  ) {
    if (
      !analysis ||
      !analysis.faceDetected ||
      !analysis.singleFace ||
      !analysis.pose
    ) {
      return 0;
    }

    const {
      yaw,
      pitch,
      roll
    } = analysis.pose;

    const absRoll =
      Math.abs(roll);

    let score = 1;

    /*
     * Em todas as posições
     * queremos evitar uma inclinação
     * exagerada da cabeça.
     */

    if (
      absRoll >
      0.45
    ) {
      score *= 0.55;
    }

    switch (
      positionId
    ) {
      case "frontal":
        score *=
          clamp(
            1 -
              Math.abs(yaw) *
                1.8,
            0,
            1
          );

        score *=
          clamp(
            1 -
              Math.abs(pitch) *
                1.8,
            0,
            1
          );

        break;

      case "left":
        score *=
          clamp(
            Math.abs(yaw) /
              0.16,
            0,
            1
          );

        break;

      case "right":
        score *=
          clamp(
            Math.abs(yaw) /
              0.16,
            0,
            1
          );

        break;

      case "up":
        score *=
          clamp(
            Math.abs(pitch) /
              0.08,
            0,
            1
          );

        break;

      case "down":
        score *=
          clamp(
            Math.abs(pitch) /
              0.08,
            0,
            1
          );

        break;

      case "left_up":
        score *=
          clamp(
            Math.abs(yaw) /
              0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.abs(pitch) /
              0.06,
            0,
            1
          );

        break;

      case "right_up":
        score *=
          clamp(
            Math.abs(yaw) /
              0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.abs(pitch) /
              0.06,
            0,
            1
          );

        break;

      case "left_down":
        score *=
          clamp(
            Math.abs(yaw) /
              0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.abs(pitch) /
              0.06,
            0,
            1
          );

        break;

      case "right_down":
        score *=
          clamp(
            Math.abs(yaw) /
              0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.abs(pitch) /
              0.06,
            0,
            1
          );

        break;

      case "smile":
        score =
          analysis.smileScore >=
          CONFIG.smileThreshold
            ? 1
            : analysis.smileScore /
              CONFIG.smileThreshold;

        break;

      default:
        break;
    }

    return clamp(
      score,
      0,
      1
    );
  }

  /*
   * ----------------------------------------------------------
   * CAPTURE DE POSIÇÃO
   * ----------------------------------------------------------
   *
   * Guardamos apenas métricas.
   * Não enviamos frames da câmera.
   * ----------------------------------------------------------
   */

  function capturePosition(
    position,
    analysis,
    score
  ) {
    const entry = {
      position:
        position.id,

      qualityScore:
        Number(
          analysis.score.toFixed(4)
        ),

      positionScore:
        Number(
          score.toFixed(4)
        ),

      faceDetected:
        analysis.faceDetected,

      singleFace:
        analysis.singleFace,

      faceCount:
        analysis.faceCount,

      smileDetected:
        position.id ===
        "smile"
          ? analysis.smileScore >=
            CONFIG.smileThreshold
          : false,

      smileScore:
        Number(
          analysis.smileScore.toFixed(4)
        ),

      brightness:
        analysis.quality
          ?.brightness || 0,

      sharpness:
        analysis.quality
          ?.sharpness || 0,

      yaw:
        Number(
          safeNumber(
            analysis.pose?.yaw
          ).toFixed(4)
        ),

      pitch:
        Number(
          safeNumber(
            analysis.pose?.pitch
          ).toFixed(4)
        ),

      roll:
        Number(
          safeNumber(
            analysis.pose?.roll
          ).toFixed(4)
        ),

      capturedAt:
        new Date().toISOString()
    };

    capturedPositions.push(
      entry
    );

    return entry;
  }

  /*
   * ----------------------------------------------------------
   * LOOP
   * ----------------------------------------------------------
   */

  async function processFrame(
    timestamp
  ) {
    if (
      !running ||
      !faceLandmarker ||
      !video
    ) {
      return;
    }

    if (
      timestamp -
        lastDetectionAt <
      CONFIG.detectionIntervalMs
    ) {
      animationFrame =
        requestAnimationFrame(
          processFrame
        );

      return;
    }

    lastDetectionAt =
      timestamp;

    let result;

    try {
      result =
        faceLandmarker.detectForVideo(
          video,
          timestamp
        );
    } catch (error) {
      console.error(
        "[FacialPreflight] Face detection failed",
        error
      );

      setStatus(
        "Não foi possível analisar a câmera. Tente novamente.",
        "error"
      );

      stop();

      emit("onError", error);

      return;
    }

    const analysis =
      analyzeResult(
        result
      );

    emit(
      "onStatus",
      {
        message:
          buildLiveMessage(
            analysis
          ),

        type:
          analysis.score >=
          CONFIG.positionScoreThreshold
            ? "success"
            : "info",

        analysis
      }
    );

    const position =
      POSITIONS[
        currentPositionIndex
      ];

    if (!position) {
      await finish();

      return;
    }

    const score =
      positionScore(
        position.id,
        analysis
      );

    emit(
      "onProgress",
      {
        current:
          currentPositionIndex + 1,

        total:
          POSITIONS.length,

        position:
          position.id,

        positionScore:
          score,

        analysis
      }
    );

    const now =
      Date.now();

    if (
      now -
        currentPositionStartedAt >
      CONFIG.positionTimeoutMs
    ) {
      stableFrames = 0;

      currentPositionStartedAt =
        now;

      setStatus(
        getRetryInstruction(
          position.id
        ),
        "warning"
      );
    }

    if (
      score >=
      CONFIG.positionScoreThreshold
    ) {
      stableFrames++;
    } else {
      stableFrames = 0;
    }

    if (
      stableFrames >=
      CONFIG.stableFramesRequired
    ) {
      const captured =
        capturePosition(
          position,
          analysis,
          score
        );

      stableFrames = 0;

      emit(
        "onPosition",
        {
          completed:
            currentPositionIndex + 1,

          total:
            POSITIONS.length,

          position,

          captured
        }
      );

      currentPositionIndex++;

      currentPositionStartedAt =
        Date.now();

      if (
        currentPositionIndex <
        POSITIONS.length
      ) {
        const next =
          POSITIONS[
            currentPositionIndex
          ];

        setStatus(
          next.instruction,
          "info"
        );
      }
    }

    animationFrame =
      requestAnimationFrame(
        processFrame
      );
  }

  function buildLiveMessage(
    analysis
  ) {
    if (
      !analysis.faceDetected
    ) {
      return "Posicione o rosto diante da câmera.";
    }

    if (
      !analysis.singleFace
    ) {
      return "Deixe apenas uma pessoa diante da câmera.";
    }

    if (
      analysis.quality
        .brightnessScore <
      0.55
    ) {
      return "Melhore a iluminação do rosto.";
    }

    if (
      analysis.quality
        .sharpnessScore <
      0.25
    ) {
      return "Mantenha o dispositivo estável.";
    }

    if (
      analysis.score <
      CONFIG.positionScoreThreshold
    ) {
      return "Ajuste o rosto conforme a instrução.";
    }

    return "Perfeito. Mantenha esta posição.";
  }

  function getRetryInstruction(
    position
  ) {
    const item =
      POSITIONS.find(
        p =>
          p.id ===
          position
      );

    return (
      item?.instruction ||
      "Ajuste o rosto e tente novamente."
    );
  }

  /*
   * ----------------------------------------------------------
   * RESULTADO
   * ----------------------------------------------------------
   */

  function calculateFinalResult() {
    const positionScores =
      capturedPositions.map(
        item =>
          item.positionScore
      );

    const qualityScores =
      capturedPositions.map(
        item =>
          item.qualityScore
      );

    const score =
      average(
        capturedPositions.map(
          item =>
            average([
              item.positionScore,
              item.qualityScore
            ])
        )
      );

    const positionsCompleted =
      capturedPositions.length;

    const positionsRequired =
      POSITIONS.length;

    const smile =
      capturedPositions.find(
        item =>
          item.position ===
          "smile"
      );

    const smileDetected =
      Boolean(
        smile?.smileDetected
      );

    const issues = [];

    if (
      positionsCompleted <
      positionsRequired
    ) {
      issues.push(
        `Foram concluídas ${positionsCompleted} de ${positionsRequired} posições.`
      );
    }

    capturedPositions.forEach(
      item => {
        if (
          item.qualityScore <
          CONFIG.positionScoreThreshold
        ) {
          issues.push(
            `Qualidade insuficiente na posição ${item.position}.`
          );
        }

        if (
          item.positionScore <
          CONFIG.positionScoreThreshold
        ) {
          issues.push(
            `A posição ${item.position} precisa ser repetida.`
          );
        }
      }
    );

    if (
      !smileDetected
    ) {
      issues.push(
        "O sorriso não foi detectado claramente."
      );
    }

    if (
      score <
      CONFIG.overallScoreThreshold
    ) {
      issues.push(
        "A qualidade geral da captura ainda não atingiu o nível recomendado."
      );
    }

    const passed =
      positionsCompleted ===
        positionsRequired &&
      smileDetected &&
      score >=
        CONFIG.overallScoreThreshold &&
      positionScores.every(
        value =>
          value >=
          CONFIG.positionScoreThreshold
      );

    return {
      passed,

      score:
        Number(
          score.toFixed(4)
        ),

      minimumScore:
        CONFIG.overallScoreThreshold,

      minimumPositionScore:
        CONFIG.positionScoreThreshold,

      positionsCompleted,

      positionsRequired,

      smileDetected,

      qualityScores,

      positionScores,

      issues,

      checkedAt:
        new Date().toISOString()
    };
  }

  /*
   * ----------------------------------------------------------
   * FINALIZAÇÃO
   * ----------------------------------------------------------
   */

  async function finish() {
    running = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    const result =
      calculateFinalResult();

    emit(
      "onComplete",
      result
    );

    return result;
  }

  /*
   * ----------------------------------------------------------
   * ENVIO PARA O BACKEND
   * ----------------------------------------------------------
   *
   * O endpoint atual espera:
   *
   * POST /api/clients/:id/facial-preflight
   *
   * Não enviamos imagem nem vídeo.
   * ----------------------------------------------------------
   */

  async function submitToBackend({
    clientId,
    passportMatch = null
  } = {}) {
    const id =
      clientId ||
      currentClientId;

    if (!id) {
      throw new Error(
        "clientId é obrigatório."
      );
    }

    const result =
      calculateFinalResult();

    const response =
      await fetch(
        `/api/clients/${encodeURIComponent(
          id
        )}/facial-preflight`,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              consentAccepted: true,

              positions:
                capturedPositions,

              passportMatch:
                passportMatch || null
            })
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
        data?.error ||
        "Não foi possível guardar o resultado da verificação facial."
      );
    }

    emit(
      "onComplete",
      {
        ...result,

        backend:
          data
      }
    );

    return data;
  }

  /*
   * ----------------------------------------------------------
   * API PÚBLICA
   * ----------------------------------------------------------
   */

  async function initialize({
    videoElement,
    clientId = null,
    onStatus = null,
    onProgress = null,
    onPosition = null,
    onComplete = null,
    onError = null
  } = {}) {
    if (!videoElement) {
      throw new Error(
        "videoElement é obrigatório."
      );
    }

    video =
      videoElement;

    currentClientId =
      clientId;

    callbacks = {
      onStatus,
      onProgress,
      onPosition,
      onComplete,
      onError
    };

    ensureCanvas();

    setStatus(
      "A preparar o reconhecimento facial local...",
      "info"
    );

    await createLandmarker();

    initialized = true;

    setStatus(
      "Sistema facial preparado.",
      "success"
    );

    return {
      success: true
    };
  }

  async function start({
    clientId = null
  } = {}) {
    if (!initialized) {
      await initialize({
        videoElement: video,
        clientId
      });
    }

    if (clientId) {
      currentClientId =
        clientId;
    }

    capturedPositions = [];

    currentPositionIndex = 0;

    stableFrames = 0;

    currentPositionStartedAt =
      Date.now();

    await startCamera();

    running = true;

    const first =
      POSITIONS[0];

    setStatus(
      first.instruction,
      "info"
    );

    emit(
      "onPosition",
      {
        started: true,

        completed: 0,

        total:
          POSITIONS.length,

        position:
          first
      }
    );

    animationFrame =
      requestAnimationFrame(
        processFrame
      );

    return {
      success: true
    };
  }

  function stop() {
    running = false;

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );

      animationFrame = null;
    }

    stopCamera();

    stableFrames = 0;

    setStatus(
      "Verificação facial interrompida.",
      "info"
    );
  }

  function reset() {
    stop();

    capturedPositions = [];

    currentPositionIndex = 0;

    stableFrames = 0;

    currentPositionStartedAt =
      0;

    setStatus(
      "Verificação reiniciada.",
      "info"
    );
  }

  function getResult() {
    return calculateFinalResult();
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
      faceLandmarker
    );
  }

  /*
   * ----------------------------------------------------------
   * EXPOSIÇÃO GLOBAL
   * ----------------------------------------------------------
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
      MEDIAPIPE_VERSION,

      POSITIONS,

      CONFIG
    }
  };

  /*
   * Limpeza quando a página é fechada.
   */

  window.addEventListener(
    "beforeunload",
    () => {
      stopCamera();

      if (
        faceLandmarker &&
        typeof faceLandmarker.close ===
          "function"
      ) {
        try {
          faceLandmarker.close();
        } catch (_) {}
      }
    }
  );
})();
