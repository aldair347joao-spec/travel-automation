/*
 * ============================================================
 * TRAVEL AUTOMATION
 * LOCAL FACE IDENTITY MATCH
 * ============================================================
 *
 * Objetivo:
 *
 * - carregar FaceAPI no navegador;
 * - obter a fotografia do passaporte através do endpoint
 *   protegido do próprio Travel Automation;
 * - gerar um descritor facial do passaporte;
 * - gerar descritores da câmera;
 * - comparar os dois localmente;
 * - NÃO enviar imagem/vídeo para uma API externa.
 *
 * IMPORTANTE:
 *
 * Isto é uma PRÉ-VERIFICAÇÃO LOCAL de identidade.
 * Não representa uma certificação biométrica VFS.
 *
 * ============================================================
 */

(() => {
  "use strict";

  const CONFIG = {
    SCRIPT_URL:
      window.TRAVEL_FACE_API_SCRIPT_URL ||
      "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.min.js",

    MODEL_URL:
      window.TRAVEL_FACE_API_MODEL_URL ||
      "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model",

    PASSPORT_ENDPOINT_BASE:
      "/api/clients",

    /*
     * Distância menor = rostos mais semelhantes.
     *
     * Começamos conservadores.
     * Este valor deverá ser calibrado com os passaportes
     * reais que estão sendo testados.
     */
    MAX_DISTANCE:
      Number(
        window.TRAVEL_FACE_MATCH_MAX_DISTANCE
      ) || 0.58,

    /*
     * Número de amostras da câmera.
     */
    LIVE_SAMPLES:
      3,

    /*
     * Pequeno intervalo entre amostras.
     */
    SAMPLE_DELAY_MS:
      250,

    /*
     * Confiança mínima da detecção.
     */
    MIN_DETECTION_SCORE:
      0.55
  };

  let apiPromise = null;
  let modelsPromise = null;

  let passportCache = new Map();

  /*
   * ==========================================================
   * UTILITÁRIOS
   * ==========================================================
   */

  function sleep(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function distanceToScore(distance) {
    const max =
      CONFIG.MAX_DISTANCE;

    if (
      !Number.isFinite(distance)
    ) {
      return 0;
    }

    /*
     * 0 distância = 100%.
     *
     * Na distância máxima = 0%.
     *
     * Não tratamos este valor como
     * probabilidade estatística.
     */
    return clamp(
      1 -
        distance / max,
      0,
      1
    );
  }

  function getFaceApi() {
    if (!window.faceapi) {
      throw new Error(
        "FaceAPI não foi carregada."
      );
    }

    return window.faceapi;
  }

  /*
   * ==========================================================
   * CARREGAR BIBLIOTECA
   * ==========================================================
   */

  function loadScript() {
    if (
      window.faceapi
    ) {
      return Promise.resolve(
        window.faceapi
      );
    }

    if (apiPromise) {
      return apiPromise;
    }

    apiPromise =
      new Promise(
        (resolve, reject) => {
          const existing =
            document.querySelector(
              'script[data-travel-face-api="true"]'
            );

          if (existing) {
            existing.addEventListener(
              "load",
              () => {
                if (window.faceapi) {
                  resolve(
                    window.faceapi
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
                once: true
              }
            );

            existing.addEventListener(
              "error",
              () => {
                reject(
                  new Error(
                    "Não foi possível carregar a biblioteca facial."
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
            CONFIG.SCRIPT_URL;

          script.async = true;

          script.dataset.travelFaceApi =
            "true";

          script.onload = () => {
            if (
              window.faceapi
            ) {
              resolve(
                window.faceapi
              );
            } else {
              reject(
                new Error(
                  "FaceAPI não ficou disponível depois do carregamento."
                )
              );
            }
          };

          script.onerror = () => {
            reject(
              new Error(
                "Falha ao carregar FaceAPI."
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      );

    return apiPromise;
  }

  /*
   * ==========================================================
   * CARREGAR MODELOS
   * ==========================================================
   */

  async function loadModels() {
    const faceapi =
      await loadScript();

    if (
      modelsPromise
    ) {
      return modelsPromise;
    }

    modelsPromise =
      Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(
          CONFIG.MODEL_URL
        ),

        faceapi.nets.faceLandmark68Net.loadFromUri(
          CONFIG.MODEL_URL
        ),

        faceapi.nets.faceRecognitionNet.loadFromUri(
          CONFIG.MODEL_URL
        )
      ]);

    try {
      await modelsPromise;

      return true;
    } catch (error) {
      modelsPromise = null;

      console.error(
        "[LocalFaceMatch] model loading failed",
        error
      );

      throw new Error(
        "Não foi possível carregar os modelos de reconhecimento facial."
      );
    }
  }

  /*
   * ==========================================================
   * INICIALIZAÇÃO
   * ==========================================================
   */

  async function initialize() {
    await loadModels();

    return {
      success: true,
      local: true,
      externalRecognitionApi: false
    };
  }

  /*
   * ==========================================================
   * DETECTAR FACE EM UMA IMAGEM
   * ==========================================================
   */

  async function detectSingleFace(input) {
    const faceapi =
      await loadScript();

    const result =
      await faceapi
        .detectSingleFace(
          input,
          new faceapi.SsdMobilenetv1Options({
            minConfidence:
              CONFIG.MIN_DETECTION_SCORE
          })
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

    return result || null;
  }

  /*
   * ==========================================================
   * OBTER FOTOGRAFIA DO PASSAPORTE
   * ==========================================================
   */

  async function fetchPassportImage(
    clientId
  ) {
    if (!clientId) {
      throw new Error(
        "clientId é obrigatório para obter a fotografia do passaporte."
      );
    }

    const key =
      String(clientId);

    if (
      passportCache.has(key)
    ) {
      return passportCache.get(key);
    }

    const endpoint =
      `${CONFIG.PASSPORT_ENDPOINT_BASE}/${encodeURIComponent(
        key
      )}/facial-preflight/passport-image`;

    const response =
      await fetch(
        endpoint,
        {
          method: "GET",

          credentials:
            "include",

          cache:
            "no-store",

          headers: {
            Accept:
              "image/jpeg,image/png"
          }
        }
      );

    if (!response.ok) {
      let message =
        "Não foi possível obter a fotografia do passaporte.";

      try {
        const data =
          await response.json();

        message =
          data?.error ||
          data?.message ||
          message;
      } catch (_) {}

      throw new Error(
        message
      );
    }

    const blob =
      await response.blob();

    if (
      !blob.size
    ) {
      throw new Error(
        "A fotografia do passaporte está vazia."
      );
    }

    const objectUrl =
      URL.createObjectURL(
        blob
      );

    try {
      const image =
        new Image();

      image.decoding =
        "async";

      image.src =
        objectUrl;

      await new Promise(
        (resolve, reject) => {
          image.onload =
            resolve;

          image.onerror =
            () =>
              reject(
                new Error(
                  "Não foi possível abrir a fotografia do passaporte."
                )
              );
        }
      );

      passportCache.set(
        key,
        image
      );

      return image;
    } finally {
      /*
       * Mantemos a URL enquanto a imagem
       * estiver sendo usada pelo cache.
       */
    }
  }

  /*
   * ==========================================================
   * DESCRITOR DO PASSAPORTE
   * ==========================================================
   */

  async function createPassportDescriptor(
    clientId
  ) {
    await initialize();

    const image =
      await fetchPassportImage(
        clientId
      );

    const detection =
      await detectSingleFace(
        image
      );

    if (!detection) {
      throw new Error(
        "Não foi possível encontrar claramente um rosto na fotografia do passaporte."
      );
    }

    if (
      !detection.descriptor
    ) {
      throw new Error(
        "Não foi possível criar o descritor facial do passaporte."
      );
    }

    return {
      descriptor:
        detection.descriptor,

      detectionScore:
        Number(
          detection.detection.score ||
          0
        ),

      box:
        detection.detection.box
    };
  }

  /*
   * ==========================================================
   * DESCRITOR DA CÂMERA
   * ==========================================================
   */

  async function createLiveDescriptor(
    video
  ) {
    if (!video) {
      throw new Error(
        "Elemento de vídeo da câmera não encontrado."
      );
    }

    const detection =
      await detectSingleFace(
        video
      );

    if (!detection) {
      return null;
    }

    if (
      !detection.descriptor
    ) {
      return null;
    }

    return {
      descriptor:
        detection.descriptor,

      detectionScore:
        Number(
          detection.detection.score ||
          0
        ),

      box:
        detection.detection.box
    };
  }

  /*
   * ==========================================================
   * COMPARAÇÃO
   * ==========================================================
   */

  async function compareDescriptors(
    passportDescriptor,
    liveDescriptor
  ) {
    const faceapi =
      await loadScript();

    const distance =
      faceapi.euclideanDistance(
        passportDescriptor,
        liveDescriptor
      );

    const similarityScore =
      distanceToScore(
        distance
      );

    return {
      distance:
        Number(
          distance.toFixed(6)
        ),

      similarityScore:
        Number(
          similarityScore.toFixed(4)
        ),

      similarityPercent:
        Math.round(
          similarityScore * 100
        ),

      threshold:
        CONFIG.MAX_DISTANCE,

      matched:
        distance <=
        CONFIG.MAX_DISTANCE
    };
  }

  /*
   * ==========================================================
   * AMOSTRAGEM DA CÂMERA
   * ==========================================================
   */

  async function collectLiveSamples(
    video
  ) {
    const samples = [];

    for (
      let index = 0;
      index <
      CONFIG.LIVE_SAMPLES;
      index++
    ) {
      const sample =
        await createLiveDescriptor(
          video
        );

      if (sample) {
        samples.push(
          sample
        );
      }

      if (
        index + 1 <
        CONFIG.LIVE_SAMPLES
      ) {
        await sleep(
          CONFIG.SAMPLE_DELAY_MS
        );
      }
    }

    return samples;
  }

  /*
   * ==========================================================
   * COMPARAR PASSAPORTE VS CÂMERA
   * ==========================================================
   */

  async function compare({
  clientId,
  videoElement
} = {}) {
  try {
    console.log(
      "[LocalFaceMatch] 1/7 início da comparação",
      {
        clientId,
        videoReadyState:
          videoElement?.readyState,
        videoWidth:
          videoElement?.videoWidth,
        videoHeight:
          videoElement?.videoHeight
      }
    );

    if (!clientId) {
      throw new Error(
        "LOCAL_FACE_MATCH: clientId não informado."
      );
    }

    if (!videoElement) {
      throw new Error(
        "LOCAL_FACE_MATCH: elemento da câmera não encontrado."
      );
    }

    /*
     * 1 — modelos
     */
    await initialize();

    console.log(
      "[LocalFaceMatch] 2/7 modelos carregados"
    );

    /*
     * 2 — passaporte
     */
    const passport =
      await createPassportDescriptor(
        clientId
      );

    console.log(
      "[LocalFaceMatch] 3/7 rosto do passaporte detectado",
      {
        detectionScore:
          passport.detectionScore
      }
    );

    /*
     * 3 — verificar câmera
     */
    if (
      videoElement.readyState <
      HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      throw new Error(
        "LOCAL_FACE_MATCH: a câmera ainda não possui imagem disponível."
      );
    }

    if (
      !videoElement.videoWidth ||
      !videoElement.videoHeight
    ) {
      throw new Error(
        "LOCAL_FACE_MATCH: a câmera está ativa mas não possui resolução de vídeo."
      );
    }

    console.log(
      "[LocalFaceMatch] 4/7 câmera pronta"
    );

    /*
     * 4 — amostras
     */
    const liveSamples =
      await collectLiveSamples(
        videoElement
      );

    console.log(
      "[LocalFaceMatch] 5/7 amostras capturadas",
      {
        count:
          liveSamples.length
      }
    );

    if (
      !liveSamples.length
    ) {
      throw new Error(
        "LOCAL_FACE_MATCH: nenhum rosto foi detectado na câmera."
      );
    }

    /*
     * 5 — comparar
     */
    const comparisons =
      [];

    for (
      const sample of
      liveSamples
    ) {
      const comparison =
        await compareDescriptors(
          passport.descriptor,
          sample.descriptor
        );

      comparisons.push({
        ...comparison,

        liveDetectionScore:
          sample.detectionScore
      });
    }

    console.log(
      "[LocalFaceMatch] 6/7 comparações concluídas",
      comparisons
    );

    if (
      !comparisons.length
    ) {
      throw new Error(
        "LOCAL_FACE_MATCH: não foi possível comparar os descritores."
      );
    }

    /*
     * Menor distância = maior semelhança.
     */
    comparisons.sort(
      (a, b) =>
        a.distance -
        b.distance
    );

    const best =
      comparisons[0];

    const matched =
      comparisons.some(
        item =>
          item.matched === true
      );

    const result = {
      attempted: true,

      matched,

      method:
        "browser-local",

      passportFaceDetected:
        true,

      liveFaceDetected:
        true,

      distance:
        best.distance,

      similarityScore:
        best.similarityScore,

      similarityPercent:
        best.similarityPercent,

      threshold:
        best.threshold,

      samples:
        comparisons.length,

      sampleResults:
        comparisons.map(
          item => ({
            distance:
              item.distance,

            similarityPercent:
              item.similarityPercent,

            matched:
              item.matched
          })
        ),

      checkedAt:
        new Date().toISOString()
    };

    console.log(
      "[LocalFaceMatch] 7/7 RESULTADO FINAL",
      result
    );

    return result;

  } catch (error) {

    console.error(
      "[LocalFaceMatch] FALHA EXATA",
      error
    );

    /*
     * Não esconder o motivo verdadeiro.
     */
    throw new Error(
      error?.message ||
      String(error) ||
      "LOCAL_FACE_MATCH: falha desconhecida."
    );
  }
}

  /*
   * ==========================================================
   * LIMPAR CACHE
   * ==========================================================
   */

  function clearCache(
    clientId = null
  ) {
    if (
      clientId
    ) {
      const key =
        String(clientId);

      passportCache.delete(
        key
      );

      return;
    }

    passportCache.clear();
  }

  /*
   * ==========================================================
   * API GLOBAL
   * ==========================================================
   */

  window.TravelLocalFaceMatch = {
    initialize,

    compare,

    clearCache,

    getConfig() {
      return {
        ...CONFIG
      };
    }
  };

  console.info(
    "[LocalFaceMatch] módulo carregado."
  );
})();
