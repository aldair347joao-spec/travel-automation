/*

* ============================================================
* TRAVEL AUTOMATION
* LOCAL FACE MATCH
* ============================================================
* 
* Comparação:
* 
* PASSAPORTE
* ↓
* fotografia do documento
* ↓
* descritor facial
* ↓
* 
* CÂMERA
* ↓
* descritor facial
* ↓
* 
* comparação local
* 
* Não envia rosto para API externa.
* 
* Usa:
* 
* /face-api/face-api.min.js
* /models/
* 
* Modelos:
* 
* - Tiny Face Detector
* - Face Landmark 68
* - Face Recognition
* 
* ============================================================
  */

(() => {
"use strict";

const CONFIG = {

SCRIPT_URL:
  window.TRAVEL_FACE_API_SCRIPT_URL ||
  "/face-api/face-api.min.js",

MODEL_URL:
  window.TRAVEL_FACE_API_MODEL_URL ||
  "/models",

PASSPORT_ENDPOINT_BASE:
  "/api/clients",

/*
 * Distância menor significa maior semelhança.
 *
 * 0.60 é o limite principal.
 * 0.64 é usado apenas para avaliar estabilidade
 * das várias amostras.
 */

MAX_DISTANCE:
  Number(
    window.TRAVEL_FACE_MATCH_MAX_DISTANCE
  ) || 0.60,

SAMPLE_DISTANCE_LIMIT:
  0.64,

LIVE_SAMPLES:
  5,

REQUIRED_MATCHES:
  3,

SAMPLE_DELAY_MS:
  220,

MIN_DETECTION_SCORE:
  0.45,

DETECTOR_INPUT_SIZE:
  320

};

let apiPromise =
null;

let modelsPromise =
null;

let passportCache =
new Map();

/*

* ==========================================================
* UTILITÁRIOS
* ==========================================================
  */

function sleep(
ms
) {

return new Promise(
  resolve =>
    setTimeout(
      resolve,
      ms
    )
);

}

function clamp(
value,
min,
max
) {

return Math.max(
  min,
  Math.min(
    max,
    Number(value) || 0
  )
);

}

function getFaceApi() {

if (
  !window.faceapi
) {

  throw new Error(
    "FaceAPI local não está disponível."
  );
}

return window.faceapi;

}

function distanceToScore(
distance
) {

if (
  !Number.isFinite(
    distance
  )
) {

  return 0;
}

return clamp(
  1 -
    (
      distance /
      CONFIG.MAX_DISTANCE
    ),
  0,
  1
);

}

/*

* ==========================================================
* FACE API
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

if (
  apiPromise
) {

  return apiPromise;
}

apiPromise =
  new Promise(
    (
      resolve,
      reject
    ) => {

      const existing =
        document.querySelector(
          'script[data-travel-face-api="true"]'
        );

      if (
        existing
      ) {

        if (
          window.faceapi
        ) {

          resolve(
            window.faceapi
          );

          return;
        }

        existing.addEventListener(
          "load",
          () => {

            if (
              window.faceapi
            ) {

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
                "Não foi possível carregar a FaceAPI local."
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
        };

      script.onerror =
        () => {

          reject(
            new Error(
              "Falha ao carregar /face-api/face-api.min.js."
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
* MODELOS
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

    faceapi.nets
      .tinyFaceDetector
      .loadFromUri(
        CONFIG.MODEL_URL
      ),

    faceapi.nets
      .faceLandmark68Net
      .loadFromUri(
        CONFIG.MODEL_URL
      ),

    faceapi.nets
      .faceRecognitionNet
      .loadFromUri(
        CONFIG.MODEL_URL
      )
  ]);

try {

  await modelsPromise;

  return true;

} catch (error) {

  modelsPromise =
    null;

  console.error(
    "[LocalFaceMatch] erro nos modelos:",
    error
  );

  throw new Error(
    "Não foi possível carregar os modelos de reconhecimento facial locais."
  );
}

}

async function initialize() {

await loadModels();

return {

  success:
    true,

  local:
    true,

  externalRecognitionApi:
    false
};

}

/*

* ==========================================================
* DETECÇÃO
* ==========================================================
  */

async function detectSingleFace(
input
) {

const faceapi =
  await loadScript();

const result =
  await faceapi
    .detectSingleFace(
      input,
      new faceapi.TinyFaceDetectorOptions(
        {
          inputSize:
            CONFIG.DETECTOR_INPUT_SIZE,

          scoreThreshold:
            CONFIG.MIN_DETECTION_SCORE
        }
      )
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

return result ||
  null;

}

/*

* ==========================================================
* PASSAPORTE
* ==========================================================
  */

async function fetchPassportImage(
clientId
) {

if (
  !clientId
) {

  throw new Error(
    "ID do cliente não informado."
  );
}

const key =
  String(
    clientId
  );

if (
  passportCache.has(
    key
  )
) {

  return passportCache.get(
    key
  );
}

const endpoint =
  `${CONFIG.PASSPORT_ENDPOINT_BASE}/${encodeURIComponent(
    key
  )}/facial-preflight/passport-image`;

const response =
  await fetch(
    endpoint,
    {

      method:
        "GET",

      credentials:
        "include",

      cache:
        "no-store",

      headers: {

        Accept:
          "image/jpeg,image/png,image/webp"
      }
    }
  );

if (
  !response.ok
) {

  let message =
    "Não foi possível obter a fotografia do passaporte.";

  try {

    const data =
      await response.json();

    message =
      data?.message ||
      data?.error ||
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

const image =
  new Image();

image.decoding =
  "async";

image.src =
  objectUrl;

await new Promise(
  (
    resolve,
    reject
  ) => {

    image.onload =
      () => {

        resolve();
      };

    image.onerror =
      () => {

        reject(
          new Error(
            "Não foi possível abrir a fotografia do passaporte."
          )
        );
      };
  }
);

/*
 * Mantemos a imagem em cache.
 *
 * Não revogamos a objectURL enquanto
 * a imagem estiver no cache.
 */

passportCache.set(
  key,
  image
);

return image;

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

if (
  !detection
) {

  throw new Error(
    "Não foi possível encontrar claramente o rosto na fotografia do passaporte."
  );
}

const detectionScore =
  Number(
    detection.detection?.score ||
    0
  );

if (
  detectionScore <
  CONFIG.MIN_DETECTION_SCORE
) {

  throw new Error(
    "A fotografia do passaporte não apresenta um rosto suficientemente claro."
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

  detectionScore,

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

if (
  !video
) {

  throw new Error(
    "Elemento da câmera não encontrado."
  );
}

if (
  video.readyState <
  HTMLMediaElement.HAVE_CURRENT_DATA
) {

  return null;
}

if (
  !video.videoWidth ||
  !video.videoHeight
) {

  return null;
}

const detection =
  await detectSingleFace(
    video
  );

if (
  !detection
) {

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
      detection.detection?.score ||
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
      distance.toFixed(
        6
      )
    ),

  similarityScore:
    Number(
      similarityScore.toFixed(
        4
      )
    ),

  similarityPercent:
    Math.round(
      similarityScore *
      100
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
* AMOSTRAS
* ==========================================================
  */

async function collectLiveSamples(
video
) {

const samples =
  [];

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

  if (
    sample
  ) {

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
* COMPARAÇÃO COMPLETA
* ==========================================================
  */

async function compare({
clientId,
videoElement
} = {}) {

console.log(
  "[LocalFaceMatch] início"
);

if (
  !clientId
) {

  throw new Error(
    "LOCAL_FACE_MATCH: ID do cliente não informado."
  );
}

if (
  !videoElement
) {

  throw new Error(
    "LOCAL_FACE_MATCH: câmera não encontrada."
  );
}

/*
 * 1 — modelos locais
 */

await initialize();

/*
 * 2 — rosto do passaporte
 */

const passport =
  await createPassportDescriptor(
    clientId
  );

console.log(
  "[LocalFaceMatch] rosto do passaporte detectado",
  passport.detectionScore
);

/*
 * 3 — câmera
 */

if (
  !videoElement.videoWidth ||
  !videoElement.videoHeight
) {

  throw new Error(
    "A câmera está ativa, mas ainda não possui imagem disponível."
  );
}

/*
 * 4 — amostras
 */

const liveSamples =
  await collectLiveSamples(
    videoElement
  );

if (
  !liveSamples.length
) {

  throw new Error(
    "Não foi possível detectar o rosto na câmera. Posicione o rosto dentro do enquadramento."
  );
}

/*
 * 5 — comparação
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

if (
  !comparisons.length
) {

  throw new Error(
    "Não foi possível comparar os rostos."
  );
}

/*
 * Menor distância = maior correspondência.
 */

comparisons.sort(
  (
    a,
    b
  ) =>
    a.distance -
    b.distance
);

const distances =
  comparisons.map(
    item =>
      item.distance
  );

const best =
  comparisons[0];

const matchedSamples =
  comparisons.filter(
    item =>
      item.distance <=
      CONFIG.SAMPLE_DISTANCE_LIMIT
  );

/*
 * Exigimos estabilidade.
 *
 * Não basta uma única detecção acidental.
 */

const matched =
  matchedSamples.length >=
  Math.min(
    CONFIG.REQUIRED_MATCHES,
    comparisons.length
  );

const averageDistance =
  distances.reduce(
    (
      sum,
      value
    ) =>
      sum + value,
    0
  ) /
  distances.length;

const medianDistance =
  distances[
    Math.floor(
      distances.length /
      2
    )
  ];

const similarityScore =
  distanceToScore(
    best.distance
  );

const result = {

  attempted:
    true,

  matched,

  method:
    "browser-local",

  local:
    true,

  passportFaceDetected:
    true,

  liveFaceDetected:
    true,

  passportDetectionScore:
    passport.detectionScore,

  distance:
    best.distance,

  averageDistance:
    Number(
      averageDistance.toFixed(
        6
      )
    ),

  medianDistance:
    Number(
      medianDistance.toFixed(
        6
      )
    ),

  similarityScore:
    Number(
      similarityScore.toFixed(
        4
      )
    ),

  similarityPercent:
    Math.round(
      similarityScore *
      100
    ),

  threshold:
    CONFIG.MAX_DISTANCE,

  samples:
    comparisons.length,

  matchedSamples:
    matchedSamples.length,

  requiredMatches:
    Math.min(
      CONFIG.REQUIRED_MATCHES,
      comparisons.length
    ),

  sampleResults:
    comparisons.map(
      item => ({

        distance:
          item.distance,

        similarityPercent:
          item.similarityPercent,

        detectionScore:
          item.liveDetectionScore,

        matched:
          item.distance <=
          CONFIG.SAMPLE_DISTANCE_LIMIT
      })
    ),

  checkedAt:
    new Date().toISOString()
};

console.log(
  "[LocalFaceMatch] resultado:",
  result
);

return result;

}

/*

* ==========================================================
* CACHE
* ==========================================================
  */

function clearCache(
clientId = null
) {

if (
  clientId
) {

  passportCache.delete(
    String(
      clientId
    )
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
"[LocalFaceMatch] comparação facial local disponível."
);

})();
