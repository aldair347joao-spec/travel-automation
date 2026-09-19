/*
 * ============================================================
 * TRAVEL AUTOMATION
 * FACIAL PREFLIGHT
 * ============================================================
 *
 * MOTOR FACIAL LOCAL
 *
 * Esta versão NÃO utiliza:
 * - MediaPipe
 * - WebAssembly do MediaPipe
 * - Face Landmarker
 *
 * Utiliza:
 * - face-api.js
 * - Tiny Face Detector
 * - 68 Face Landmarks
 * - Face Expressions
 *
 * Tudo é processado no navegador.
 *
 * FLUXO:
 *
 * 1. O cliente é criado através do passaporte.
 * 2. O Identity Center continua fechado.
 * 3. O utilizador abre "Reconhecimento Facial".
 * 4. A câmera continua desligada.
 * 5. Ao clicar em "Iniciar verificação":
 *      - câmera é ativada;
 *      - motor facial é iniciado;
 *      - 10 posições são executadas;
 *      - cada posição concluída é enviada para a UI;
 *      - a UI pinta a posição de verde;
 *      - instruções são reproduzidas em português.
 *
 * IMPORTANTE:
 *
 * Este módulo faz uma PRÉ-VERIFICAÇÃO facial local.
 * Não representa certificação biométrica VFS.
 *
 * Nenhum vídeo é enviado para uma API de reconhecimento.
 * ============================================================
 */

(() => {
  "use strict";


  /* ==========================================================
   * CONFIGURAÇÃO
   * ========================================================== */

  const FACE_API_SCRIPT_URL =
    window.TRAVEL_FACE_API_SCRIPT_URL ||
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.min.js";

  const FACE_API_MODEL_URL =
    window.TRAVEL_FACE_API_MODEL_URL ||
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";


  const AUDIO_LANGUAGE =
    "pt-PT";


  /*
   * Dez posições obrigatórias.
   */
  const POSITIONS = [
    {
      id: "frontal",

      label:
        "Olhe diretamente para a câmera",

      instruction:
        "Olhe diretamente para a câmera e mantenha o rosto parado.",

      duration:
        1100
    },

    {
      id: "left",

      label:
        "Vire lentamente para a esquerda",

      instruction:
        "Vire lentamente a cabeça para a esquerda.",

      duration:
        1100
    },

    {
      id: "right",

      label:
        "Vire lentamente para a direita",

      instruction:
        "Vire lentamente a cabeça para a direita.",

      duration:
        1100
    },

    {
      id: "up",

      label:
        "Olhe ligeiramente para cima",

      instruction:
        "Olhe ligeiramente para cima.",

      duration:
        1100
    },

    {
      id: "down",

      label:
        "Olhe ligeiramente para baixo",

      instruction:
        "Olhe ligeiramente para baixo.",

      duration:
        1100
    },

    {
      id: "left_up",

      label:
        "Esquerda e cima",

      instruction:
        "Vire ligeiramente para a esquerda e olhe para cima.",

      duration:
        1100
    },

    {
      id: "right_up",

      label:
        "Direita e cima",

      instruction:
        "Vire ligeiramente para a direita e olhe para cima.",

      duration:
        1100
    },

    {
      id: "left_down",

      label:
        "Esquerda e baixo",

      instruction:
        "Vire ligeiramente para a esquerda e olhe para baixo.",

      duration:
        1100
    },

    {
      id: "right_down",

      label:
        "Direita e baixo",

      instruction:
        "Vire ligeiramente para a direita e olhe para baixo.",

      duration:
        1100
    },

    {
      id: "smile",

      label:
        "Sorria naturalmente",

      instruction:
        "Olhe para a câmera e faça um sorriso natural.",

      duration:
        1300
    }
  ];


  const CONFIG = {

    /*
     * Detector facial.
     *
     * 320 é um bom equilíbrio para telefone.
     */
    detectorInputSize:
      320,

    detectorScoreThreshold:
      0.55,


    /*
     * Área mínima/máxima do rosto
     * relativamente à imagem.
     */
    minFaceArea:
      0.055,

    maxFaceArea:
      0.72,


    idealFaceAreaMin:
      0.12,

    idealFaceAreaMax:
      0.52,


    /*
     * Iluminação.
     */
    minBrightness:
      45,

    maxBrightness:
      225,


    /*
     * Número de frames consecutivos
     * necessários para aceitar uma posição.
     */
    stableFramesRequired:
      7,


    /*
     * Frequência de análise.
     */
    detectionIntervalMs:
      110,


    /*
     * Score mínimo para uma posição.
     */
    positionScoreThreshold:
      0.72,


    /*
     * Score geral.
     */
    overallScoreThreshold:
      0.78,


    /*
     * Sorriso.
     */
    smileThreshold:
      0.55,


    /*
     * Tempo máximo de uma posição.
     */
    positionTimeoutMs:
      10000,


    /*
     * O nosso fluxo exige uma única pessoa.
     */
    maxFaces:
      1
  };


  /* ==========================================================
   * ESTADO
   * ========================================================== */

  let faceApiPromise =
    null;

  let modelsPromise =
    null;

  let faceApi =
    null;


  let video =
    null;

  let canvas =
    null;

  let canvasContext =
    null;


  let stream =
    null;


  let initialized =
    false;

  let running =
    false;


  let currentPositionIndex =
    0;

  let currentPositionStartedAt =
    0;


  let stableFrames =
    0;

  let lastDetectionAt =
    0;


  let capturedPositions =
    [];


  let animationFrame =
    null;


  let currentClientId =
    null;


  let callbacks = {
    onStatus: null,
    onProgress: null,
    onPosition: null,
    onComplete: null,
    onError: null
  };


  /* ==========================================================
   * UTILITÁRIOS
   * ========================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }


  function average(
    values
  ) {
    if (
      !Array.isArray(values) ||
      !values.length
    ) {
      return 0;
    }

    return (
      values.reduce(
        (
          sum,
          value
        ) =>
          sum +
          (
            Number(value) ||
            0
          ),
        0
      ) /
      values.length
    );
  }


  function safeNumber(
    value,
    fallback = 0
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : fallback;
  }


  function emit(
    name,
    payload
  ) {
    const callback =
      callbacks[name];

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    try {
      callback(
        payload
      );
    } catch (error) {
      console.error(
        `[FacialPreflight] callback ${name} failed`,
        error
      );
    }
  }


  function setStatus(
    message,
    type = "info"
  ) {
    emit(
      "onStatus",
      {
        message,
        type
      }
    );
  }


  /* ==========================================================
   * ÁUDIO
   * ========================================================== */

  function speakInstruction(
    message
  ) {
    if (
      !message ||
      typeof window ===
        "undefined" ||
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return;
    }

    try {

      window.speechSynthesis.cancel();

      const utterance =
        new SpeechSynthesisUtterance(
          String(message)
        );

      utterance.lang =
        AUDIO_LANGUAGE;

      utterance.rate =
        0.92;

      utterance.pitch =
        1;

      utterance.volume =
        1;

      window.speechSynthesis.speak(
        utterance
      );

    } catch (error) {

      console.warn(
        "[FacialPreflight] áudio indisponível",
        error
      );

    }
  }


  function stopSpeech() {
    if (
      typeof window ===
        "undefined" ||
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }


  /* ==========================================================
   * CARREGAR FACE API
   * ========================================================== */

  function loadFaceApiScript() {

    if (
      window.faceapi
    ) {
      faceApi =
        window.faceapi;

      return Promise.resolve(
        faceApi
      );
    }


    if (
      faceApiPromise
    ) {
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
              'script[data-travel-face-api="true"]'
            );


          if (existing) {

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
                      "FaceAPI carregou mas não ficou disponível."
                    )
                  );

                }
              },
              {
                once:
                  true
              }
            );


            existing.addEventListener(
              "error",
              () => {

                reject(
                  new Error(
                    "Não foi possível carregar o motor facial local."
                  )
                );

              },
              {
                once:
                  true
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

          script.async =
            true;

          script.defer =
            true;

          script.dataset.travelFaceApi =
            "true";


          script.onload =
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
                    "FaceAPI não ficou disponível depois do carregamento."
                  )
                );

              }

            };


          script.onerror =
            () => {

              reject(
                new Error(
                  "Falha ao carregar o motor facial local."
                )
              );

            };


          document.head.appendChild(
            script
          );

        }
      );


    return faceApiPromise;
  }


  /* ==========================================================
   * CARREGAR MODELOS FACIAIS
   * ========================================================== */

  async function loadModels() {

    const api =
      await loadFaceApiScript();


    if (
      modelsPromise
    ) {
      return modelsPromise;
    }


    modelsPromise =
      (async () => {

        setStatus(
          "A carregar o motor facial local...",
          "info"
        );


        /*
         * Tiny Face Detector
         *
         * É utilizado porque foi projetado
         * para cenários de tempo real e dispositivos
         * com recursos limitados.
         */
        await api.nets
          .tinyFaceDetector
          .loadFromUri(
            FACE_API_MODEL_URL
          );


        /*
         * 68 landmarks.
         *
         * Necessários para calcular:
         * - esquerda
         * - direita
         * - cima
         * - baixo
         * - diagonais
         */
        await api.nets
          .faceLandmark68Net
          .loadFromUri(
            FACE_API_MODEL_URL
          );


        /*
         * Expressões.
         *
         * Usamos para validar o sorriso.
         */
        await api.nets
          .faceExpressionNet
          .loadFromUri(
            FACE_API_MODEL_URL
          );


        return true;

      })()
      .catch(
        error => {

          modelsPromise =
            null;

          console.error(
            "[FacialPreflight] model loading failed",
            error
          );


          throw new Error(
            "Não foi possível carregar os modelos faciais locais."
          );

        }
      );


    return modelsPromise;
  }


  /* ==========================================================
   * CÂMERA
   * ========================================================== */

  async function startCamera() {

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices
        .getUserMedia
    ) {

      throw new Error(
        "Este navegador não disponibiliza acesso à câmera."
      );

    }


    stopCamera();


    stream =
      await navigator.mediaDevices.getUserMedia(
        {
          video: {
            facingMode: {
              ideal:
                "user"
            },

            width: {
              ideal:
                1280
            },

            height: {
              ideal:
                720
            },

            frameRate: {
              ideal:
                24,

              max:
                30
            }
          },

          audio:
            false
        }
      );


    if (!video) {

      throw new Error(
        "Elemento de vídeo não foi configurado."
      );

    }


    video.srcObject =
      stream;

    video.muted =
      true;

    video.playsInline =
      true;

    video.autoplay =
      true;


    await video.play();


    setStatus(
      "Câmera ativada. Posicione o rosto dentro da área indicada.",
      "success"
    );
  }


  function stopCamera() {

    if (
      stream
    ) {

      stream
        .getTracks()
        .forEach(
          track => {

            try {
              track.stop();
            } catch (_) {}

          }
        );

      stream =
        null;
    }


    if (
      video
    ) {
      video.srcObject =
        null;
    }
  }


  /* ==========================================================
   * CANVAS
   * ========================================================== */

  function ensureCanvas() {

    if (
      canvas
    ) {
      return;
    }


    canvas =
      document.createElement(
        "canvas"
      );


    canvas.width =
      640;

    canvas.height =
      480;


    canvasContext =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true
        }
      );
  }


  /* ==========================================================
   * QUALIDADE DA IMAGEM
   * ========================================================== */

  function analyzeImageQuality() {

    if (
      !video ||
      video.readyState <
        HTMLMediaElement.HAVE_CURRENT_DATA
    ) {

      return {
        brightness:
          0,

        brightnessScore:
          0,

        sharpness:
          0,

        sharpnessScore:
          0
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


    let brightnessSum =
      0;

    let varianceSum =
      0;

    let previousGray =
      null;

    let samples =
      0;


    /*
     * Saltamos alguns pixels para
     * não sobrecarregar o telefone.
     */
    for (
      let i = 0;
      i < data.length;
      i += 32
    ) {

      const r =
        data[i];

      const g =
        data[i + 1];

      const b =
        data[i + 2];


      const gray =
        0.299 * r +
        0.587 * g +
        0.114 * b;


      brightnessSum +=
        gray;


      if (
        previousGray !==
        null
      ) {

        const difference =
          Math.abs(
            gray -
            previousGray
          );


        varianceSum +=
          difference *
          difference;

      }


      previousGray =
        gray;

      samples++;
    }


    const brightness =
      samples
        ? brightnessSum /
          samples
        : 0;


    const sharpness =
      samples
        ? varianceSum /
          samples
        : 0;


    let brightnessScore =
      1;


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


    const sharpnessScore =
      clamp(
        sharpness / 100,
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


  /* ==========================================================
   * GEOMETRIA
   * ========================================================== */

  function pointDistance(
    a,
    b
  ) {

    if (
      !a ||
      !b
    ) {
      return 0;
    }


    const dx =
      a.x -
      b.x;

    const dy =
      a.y -
      b.y;


    return Math.sqrt(
      dx * dx +
      dy * dy
    );
  }


  function calculateBoundingBox(
    landmarks
  ) {

    if (
      !landmarks ||
      !landmarks.length
    ) {
      return null;
    }


    let minX =
      1;

    let maxX =
      0;

    let minY =
      1;

    let maxY =
      0;


    for (
      const point of
      landmarks
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
      maxX -
      minX;

    const height =
      maxY -
      minY;


    return {

      minX,

      maxX,

      minY,

      maxY,

      width,

      height,

      area:
        width *
        height,

      centerX:
        minX +
        width / 2,

      centerY:
        minY +
        height / 2

    };
  }


  /* ==========================================================
   * POSE
   * ========================================================== */

  function estimatePose(
    landmarks
  ) {

    /*
     * face-api 68 landmarks:
     *
     * 1  = nariz
     * 30 = ponta do nariz
     * 33 = canto interno olho esquerdo
     * 36 = olho esquerdo
     * 39 = olho esquerdo
     * 42 = olho direito
     * 45 = olho direito
     * 48 = boca
     * 54 = boca
     * 8  = queixo
     *
     * Para estabilidade usamos centros dos olhos,
     * nariz e queixo.
     */

    const nose =
      landmarks[30];

    const chin =
      landmarks[8];

    const leftEyeOuter =
      landmarks[36];

    const leftEyeInner =
      landmarks[39];

    const rightEyeInner =
      landmarks[42];

    const rightEyeOuter =
      landmarks[45];


    if (
      !nose ||
      !chin ||
      !leftEyeOuter ||
      !leftEyeInner ||
      !rightEyeInner ||
      !rightEyeOuter
    ) {

      return {
        yaw:
          0,

        pitch:
          0,

        roll:
          0
      };

    }


    const leftEye = {
      x:
        (
          leftEyeOuter.x +
          leftEyeInner.x
        ) / 2,

      y:
        (
          leftEyeOuter.y +
          leftEyeInner.y
        ) / 2
    };


    const rightEye = {
      x:
        (
          rightEyeInner.x +
          rightEyeOuter.x
        ) / 2,

      y:
        (
          rightEyeInner.y +
          rightEyeOuter.y
        ) / 2
    };


    const eyeCenter = {

      x:
        (
          leftEye.x +
          rightEye.x
        ) / 2,

      y:
        (
          leftEye.y +
          rightEye.y
        ) / 2

    };


    const eyeDistance =
      Math.max(
        1,
        pointDistance(
          leftEye,
          rightEye
        )
      );


    /*
     * YAW
     *
     * Mantemos o sinal.
     */
    const yaw =
      clamp(
        (
          nose.x -
          eyeCenter.x
        ) /
        eyeDistance,
        -1,
        1
      );


    /*
     * PITCH
     */
    const faceHeight =
      Math.max(
        1,
        pointDistance(
          eyeCenter,
          chin
        )
      );


    const expectedNoseY =
      eyeCenter.y +
      (
        chin.y -
        eyeCenter.y
      ) *
      0.46;


    const pitch =
      clamp(
        (
          nose.y -
          expectedNoseY
        ) /
        faceHeight,
        -1,
        1
      );


    /*
     * ROLL
     */
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


  /* ==========================================================
   * SORRISO
   * ========================================================== */

  function estimateSmile(
    expressionResult,
    landmarks
  ) {

    const expressions =
      expressionResult
        ?.expressions;


    if (
      expressions
    ) {

      const happy =
        safeNumber(
          expressions.happy
        );


      if (
        happy > 0
      ) {
        return clamp(
          happy,
          0,
          1
        );
      }

    }


    /*
     * Fallback geométrico.
     */
    const leftMouth =
      landmarks[48];

    const rightMouth =
      landmarks[54];

    const upperLip =
      landmarks[51];

    const lowerLip =
      landmarks[57];


    if (
      !leftMouth ||
      !rightMouth ||
      !upperLip ||
      !lowerLip
    ) {
      return 0;
    }


    const width =
      pointDistance(
        leftMouth,
        rightMouth
      );


    const height =
      pointDistance(
        upperLip,
        lowerLip
      );


    if (
      width <= 0
    ) {
      return 0;
    }


    return clamp(
      (
        height /
        width
      ) * 2.2,
      0,
      1
    );
  }


  /* ==========================================================
   * ANÁLISE FACIAL
   * ========================================================== */

  function analyzeResult(
    detections
  ) {

    const quality =
      analyzeImageQuality();


    if (
      !Array.isArray(
        detections
      ) ||
      !detections.length
    ) {

      return {

        faceDetected:
          false,

        singleFace:
          false,

        faceCount:
          0,

        score:
          0,

        issues: [
          "Nenhum rosto foi detectado."
        ],

        quality,

        pose:
          null,

        smileScore:
          0

      };
    }


    if (
      detections.length >
      1
    ) {

      return {

        faceDetected:
          true,

        singleFace:
          false,

        faceCount:
          detections.length,

        score:
          0,

        issues: [
          "Mais de um rosto foi detectado. Deixe apenas uma pessoa diante da câmera."
        ],

        quality,

        pose:
          null,

        smileScore:
          0

      };
    }


    const detection =
      detections[0];


    const landmarks =
      detection.landmarks
        ?.positions ||
      [];


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
        detection,
        landmarks
      );


    const issues =
      [];


    let framingScore =
      1;


    if (
      !box
    ) {

      framingScore =
        0;

      issues.push(
        "Não foi possível avaliar o enquadramento."
      );

    } else {

      if (
        box.area <
        CONFIG.minFaceArea
      ) {

        framingScore *=
          0.45;

        issues.push(
          "Aproxime o rosto da câmera."
        );

      }


      if (
        box.area >
        CONFIG.maxFaceArea
      ) {

        framingScore *=
          0.55;

        issues.push(
          "Afaste um pouco o rosto da câmera."
        );

      }


      if (
        box.area >=
          CONFIG.idealFaceAreaMin &&
        box.area <=
          CONFIG.idealFaceAreaMax
      ) {

        framingScore =
          1;

      }


      if (
        box.centerX <
        0.30 ||
        box.centerX >
        0.70
      ) {

        framingScore *=
          0.70;

        issues.push(
          "Centralize o rosto."
        );

      }


      if (
        box.centerY <
        0.22
      ) {

        framingScore *=
          0.80;

        issues.push(
          "Baixe ligeiramente o enquadramento."
        );

      }


      if (
        box.centerY >
        0.78
      ) {

        framingScore *=
          0.80;

        issues.push(
          "Suba ligeiramente o enquadramento."
        );

      }

    }


    if (
      quality.brightnessScore <
      0.55
    ) {

      issues.push(
        "A iluminação está insuficiente."
      );

    }


    if (
      quality.brightness >
      CONFIG.maxBrightness
    ) {

      issues.push(
        "Há luz excessiva diretamente no rosto."
      );

    }


    if (
      quality.sharpnessScore <
      0.18
    ) {

      issues.push(
        "Mantenha o dispositivo estável."
      );

    }


    const detectorScore =
      safeNumber(
        detection.detection
          ?.score,
        0
      );


    const faceScore =
      average([
        framingScore,

        quality.brightnessScore,

        quality.sharpnessScore,

        detectorScore
      ]);


    return {

      faceDetected:
        true,

      singleFace:
        true,

      faceCount:
        1,

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

      boundingBox:
        box,

      detectionScore:
        detectorScore

    };
  }


  /* ==========================================================
   * SCORE DA POSIÇÃO
   * ========================================================== */

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
    } =
      analysis.pose;


    let score =
      1;


    /*
     * Penalização por inclinação lateral.
     */
    if (
      Math.abs(roll) >
      0.45
    ) {

      score *=
        0.55;

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
            Math.max(
              0,
              -yaw
            ) /
            0.16,
            0,
            1
          );

        break;


      case "right":

        score *=
          clamp(
            Math.max(
              0,
              yaw
            ) /
            0.16,
            0,
            1
          );

        break;


      case "up":

        score *=
          clamp(
            Math.max(
              0,
              -pitch
            ) /
            0.08,
            0,
            1
          );

        break;


      case "down":

        score *=
          clamp(
            Math.max(
              0,
              pitch
            ) /
            0.08,
            0,
            1
          );

        break;


      case "left_up":

        score *=
          clamp(
            Math.max(
              0,
              -yaw
            ) /
            0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.max(
              0,
              -pitch
            ) /
            0.06,
            0,
            1
          );

        break;


      case "right_up":

        score *=
          clamp(
            Math.max(
              0,
              yaw
            ) /
            0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.max(
              0,
              -pitch
            ) /
            0.06,
            0,
            1
          );

        break;


      case "left_down":

        score *=
          clamp(
            Math.max(
              0,
              -yaw
            ) /
            0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.max(
              0,
              pitch
            ) /
            0.06,
            0,
            1
          );

        break;


      case "right_down":

        score *=
          clamp(
            Math.max(
              0,
              yaw
            ) /
            0.12,
            0,
            1
          );

        score *=
          clamp(
            Math.max(
              0,
              pitch
            ) /
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

            : (
                analysis.smileScore /
                CONFIG.smileThreshold
              );

        break;


      default:
        break;
    }


    /*
     * A qualidade da imagem também
     * participa do score.
     */
    score *=
      average([
        analysis.score,
        1
      ]);


    return clamp(
      score,
      0,
      1
    );
  }


  /* ==========================================================
   * CAPTURA DA POSIÇÃO
   * ========================================================== */

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
          analysis.score
            .toFixed(4)
        ),

      positionScore:
        Number(
          score
            .toFixed(4)
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
          analysis.smileScore
            .toFixed(4)
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
            analysis.pose
              ?.yaw
          ).toFixed(4)
        ),

      pitch:
        Number(
          safeNumber(
            analysis.pose
              ?.pitch
          ).toFixed(4)
        ),

      roll:
        Number(
          safeNumber(
            analysis.pose
              ?.roll
          ).toFixed(4)
        ),

      capturedAt:
        new Date()
          .toISOString()

    };


    capturedPositions.push(
      entry
    );


    return entry;
  }


  /* ==========================================================
   * PROCESSAMENTO DE FRAME
   * ========================================================== */

  async function processFrame(
    timestamp
  ) {

    if (
      !running ||
      !faceApi ||
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


    let detections;


    try {

      /*
       * TinyFaceDetector é usado para
       * manter o processamento leve no telefone.
       */
      detections =
        await faceApi
          .detectAllFaces(
            video,
            new faceApi
              .TinyFaceDetectorOptions(
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


    } catch (error) {

      console.error(
        "[FacialPreflight] análise facial falhou",
        error
      );


      setStatus(
        "Não foi possível analisar a câmera. Tente novamente.",
        "error"
      );


      stop();


      emit(
        "onError",
        error
      );


      return;
    }


    const analysis =
      analyzeResult(
        detections
      );


    const position =
      POSITIONS[
        currentPositionIndex
      ];


    if (
      !position
    ) {

      await finish();

      return;
    }


    const score =
      positionScore(
        position.id,
        analysis
      );


    emit(
      "onStatus",
      {
        message:
          buildLiveMessage(
            analysis,
            position,
            score
          ),

        type:
          score >=
          CONFIG.positionScoreThreshold
            ? "success"
            : "info",

        analysis,

        position,

        positionScore:
          score
      }
    );


    emit(
      "onProgress",
      {

        current:
          currentPositionIndex +
          1,

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

      stableFrames =
        0;

      currentPositionStartedAt =
        now;


      const retry =
        getRetryInstruction(
          position.id
        );


      setStatus(
        retry,
        "warning"
      );


      speakInstruction(
        retry
      );

    }


    if (
      score >=
      CONFIG.positionScoreThreshold
    ) {

      stableFrames++;

    } else {

      stableFrames =
        0;
    }


    /*
     * Só agora aceitamos a posição.
     */
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


      stableFrames =
        0;


      emit(
        "onPosition",
        {

          completed:
            currentPositionIndex +
            1,

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


        speakInstruction(
          next.instruction
        );

      } else {

        setStatus(
          "As dez posições foram concluídas. A finalizar a análise.",
          "success"
        );


        speakInstruction(
          "As dez posições foram concluídas. A finalizar a análise."
        );


        /*
         * Não finalizamos imediatamente
         * dentro deste mesmo frame.
         */
        setTimeout(
          () => {

            if (
              running
            ) {

              finish();

            }

          },
          250
        );
      }
    }


    if (
      running
    ) {

      animationFrame =
        requestAnimationFrame(
          processFrame
        );

    }
  }


  /* ==========================================================
   * MENSAGEM AO VIVO
   * ========================================================== */

  function buildLiveMessage(
    analysis,
    position,
    score
  ) {

    if (
      !analysis.faceDetected
    ) {

      return
        "Posicione o rosto diante da câmera.";

    }


    if (
      !analysis.singleFace
    ) {

      return
        "Deixe apenas uma pessoa diante da câmera.";

    }


    if (
      analysis.quality
        .brightnessScore <
      0.55
    ) {

      return
        "Melhore a iluminação do rosto.";

    }


    if (
      analysis.quality
        .sharpnessScore <
      0.18
    ) {

      return
        "Mantenha o dispositivo estável.";

    }


    if (
      score <
      CONFIG.positionScoreThreshold
    ) {

      return (
        position?.instruction ||
        "Ajuste o rosto conforme a instrução."
      );

    }


    return
       "Perfeito. Mantenha esta posição.";
  }


  function getRetryInstruction(
    positionId
  ) {

    const item =
      POSITIONS.find(
        position =>
          position.id ===
          positionId
      );


    return (
      item?.instruction ||
      "Ajuste o rosto e tente novamente."
    );
  }


  /* ==========================================================
   * RESULTADO FINAL
   * ========================================================== */

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


    const issues =
      [];


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
        new Date()
          .toISOString()

    };
  }


  /* ==========================================================
   * FINALIZAÇÃO
   * ========================================================== */

  async function finish() {

    if (
      !running &&
      !capturedPositions.length
    ) {

      return calculateFinalResult();

    }


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


    const result =
      calculateFinalResult();


    emit(
      "onComplete",
      result
    );


    return result;
  }


  /* ==========================================================
   * ENVIO PARA BACKEND
   * ========================================================== */

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
          method:
            "POST",

          credentials:
            "include",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              {
                consentAccepted:
                  true,

                positions:
                  capturedPositions,

                passportMatch:
                  passportMatch ||
                  null
              }
            )
        }
      );


    let data =
      null;


    try {

      data =
        await response.json();

    } catch (_) {

      data =
        null;

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data?.error ||
        data?.message ||
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


  /* ==========================================================
   * INICIALIZAÇÃO
   * ========================================================== */

  async function initialize({
    videoElement,
    clientId = null,
    onStatus = null,
    onProgress = null,
    onPosition = null,
    onComplete = null,
    onError = null
  } = {}) {

    if (
      !videoElement
    ) {

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


    await loadModels();


    initialized =
      true;


    setStatus(
      "Sistema facial preparado.",
      "success"
    );


    return {

      success:
        true,

      local:
        true,

      externalRecognitionApi:
        false

    };
  }


  /* ==========================================================
   * INICIAR
   * ========================================================== */

  async function start({
    clientId = null
  } = {}) {

    if (
      !initialized
    ) {

      if (
        !video
      ) {

        throw new Error(
          "O motor facial ainda não foi inicializado."
        );

      }


      await initialize(
        {
          videoElement:
            video,

          clientId,

          ...callbacks
        }
      );

    }


    if (
      clientId
    ) {

      currentClientId =
        clientId;

    }


    capturedPositions =
      [];


    currentPositionIndex =
      0;


    stableFrames =
      0;


    lastDetectionAt =
      0;


    currentPositionStartedAt =
      Date.now();


    await startCamera();


    running =
      true;


    const first =
      POSITIONS[0];


    setStatus(
      first.instruction,
      "info"
    );


    speakInstruction(
      first.instruction
    );


    emit(
      "onPosition",
      {

        started:
          true,

        completed:
          0,

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
      success:
        true
    };
  }


  /* ==========================================================
   * PARAR
   * ========================================================== */

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


    stableFrames =
      0;


    setStatus(
      "Verificação facial interrompida.",
      "info"
    );
  }


  /* ==========================================================
   * RESET
   * ========================================================== */

  function reset() {

    stop();


    capturedPositions =
      [];


    currentPositionIndex =
      0;


    stableFrames =
      0;


    currentPositionStartedAt =
      0;


    setStatus(
      "Verificação reiniciada.",
      "info"
    );
  }


  /* ==========================================================
   * API PÚBLICA
   * ========================================================== */

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
      faceApi
    );

  }


  /* ==========================================================
   * EXPOSIÇÃO GLOBAL
   * ========================================================== */

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

      FACE_API_MODEL_URL

    }

  };


  /* ==========================================================
   * LIMPEZA
   * ========================================================== */

  window.addEventListener(
    "beforeunload",
    () => {

      stopSpeech();

      stopCamera();

    }
  );

})();
