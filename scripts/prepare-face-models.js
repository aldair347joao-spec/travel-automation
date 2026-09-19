"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const sourceModels = path.join(
  projectRoot,
  "node_modules",
  "@vladmandic",
  "face-api",
  "model"
);

const targetModels = path.join(
  projectRoot,
  "public",
  "models"
);

const requiredFiles = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",

  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model.bin",

  "face_expression_model-weights_manifest.json",
  "face_expression_model.bin",

  "face_recognition_model-weights_manifest.json",
  "face_recognition_model.bin"
];

function fail(message) {
  console.error(
    "\n[FACE MODELS] ERRO:"
  );

  console.error(message);

  process.exit(1);
}

function copyModels() {
  console.log(
    "\n[FACE MODELS] Preparando modelos faciais..."
  );

  if (!fs.existsSync(sourceModels)) {
    fail(
      "A pasta de modelos do @vladmandic/face-api não foi encontrada:\n" +
        sourceModels +
        "\n\nExecute npm install antes de executar este script."
    );
  }

  fs.mkdirSync(
    targetModels,
    {
      recursive: true
    }
  );

  let copied = 0;

  for (const file of requiredFiles) {
    const source = path.join(
      sourceModels,
      file
    );

    const target = path.join(
      targetModels,
      file
    );

    if (!fs.existsSync(source)) {
      fail(
        "Modelo obrigatório não encontrado:\n" +
          source
      );
    }

    fs.copyFileSync(
      source,
      target
    );

    copied += 1;

    console.log(
      `[FACE MODELS] OK: ${file}`
    );
  }

  console.log(
    `\n[FACE MODELS] ${copied} arquivos preparados.`
  );

  console.log(
    `[FACE MODELS] Destino: ${targetModels}`
  );

  console.log(
    "[FACE MODELS] Reconhecimento facial local preparado.\n"
  );
}

try {
  copyModels();
} catch (error) {
  fail(
    error &&
      error.message
      ? error.message
      : String(error)
  );
}
