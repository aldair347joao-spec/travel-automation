"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot =
  path.resolve(__dirname, "..");

const faceApiRoot =
  path.join(
    projectRoot,
    "node_modules",
    "@vladmandic",
    "face-api"
  );

const sourceModels =
  path.join(
    faceApiRoot,
    "model"
  );

const sourceDist =
  path.join(
    faceApiRoot,
    "dist"
  );

const targetModels =
  path.join(
    projectRoot,
    "public",
    "models"
  );

const targetFaceApi =
  path.join(
    projectRoot,
    "public",
    "face-api"
  );

const requiredModelFiles = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",

  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",

  "face_expression_model-weights_manifest.json",
  "face_expression_model.bin",

  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin"
];

const requiredLibraryFiles = [
  "face-api.min.js"
];

function fail(message) {
  console.error("");
  console.error(
    "============================================================"
  );
  console.error(
    "[FACE API] ERRO NO PREPARO DO MOTOR FACIAL"
  );
  console.error(
    "============================================================"
  );
  console.error(message);
  console.error("");

  process.exit(1);
}

function copyFile(
  source,
  target,
  label
) {
  if (!fs.existsSync(source)) {
    fail(
      `${label} não encontrado:\n${source}`
    );
  }

  fs.copyFileSync(
    source,
    target
  );

  console.log(
    `[FACE API] OK: ${path.basename(target)}`
  );
}

function prepare() {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "[FACE API] PREPARANDO MOTOR FACIAL LOCAL"
  );
  console.log(
    "============================================================"
  );

  if (
    !fs.existsSync(faceApiRoot)
  ) {
    fail(
      "O pacote @vladmandic/face-api não foi encontrado.\n\n" +
      "Local esperado:\n" +
      faceApiRoot +
      "\n\n" +
      "Verifique se npm install foi executado corretamente."
    );
  }

  if (
    !fs.existsSync(sourceModels)
  ) {
    fail(
      "A pasta de modelos do FaceAPI não foi encontrada:\n" +
      sourceModels
    );
  }

  if (
    !fs.existsSync(sourceDist)
  ) {
    fail(
      "A pasta dist do FaceAPI não foi encontrada:\n" +
      sourceDist
    );
  }

  fs.mkdirSync(
    targetModels,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    targetFaceApi,
    {
      recursive: true
    }
  );

  console.log(
    "[FACE API] A preparar biblioteca..."
  );

  for (
    const file of requiredLibraryFiles
  ) {
    copyFile(
      path.join(
        sourceDist,
        file
      ),
      path.join(
        targetFaceApi,
        file
      ),
      "Biblioteca FaceAPI"
    );
  }

  console.log(
    "[FACE API] A preparar modelos..."
  );

  for (
    const file of requiredModelFiles
  ) {
    copyFile(
      path.join(
        sourceModels,
        file
      ),
      path.join(
        targetModels,
        file
      ),
      "Modelo facial"
    );
  }

  console.log("");
  console.log(
    "[FACE API] Biblioteca:"
  );
  console.log(
    "          /face-api/face-api.min.js"
  );

  console.log(
    "[FACE API] Modelos:"
  );
  console.log(
    "          /models/"
  );

  console.log("");
  console.log(
    "[FACE API] MOTOR FACIAL LOCAL PREPARADO COM SUCESSO."
  );
  console.log(
    "============================================================"
  );
  console.log("");
}

try {
  prepare();
} catch (error) {
  fail(
    error &&
    error.message
      ? error.message
      : String(error)
  );
}
