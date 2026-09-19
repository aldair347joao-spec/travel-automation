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

const requiredManifests = [
  "tiny_face_detector_model-weights_manifest.json",
  "face_landmark_68_model-weights_manifest.json",
  "face_expression_model-weights_manifest.json",
  "face_recognition_model-weights_manifest.json"
];

function copyFile(
  source,
  target
) {
  if (
    !fs.existsSync(source)
  ) {
    throw new Error(
      "Ficheiro necessário não encontrado:\n" +
      source
    );
  }

  fs.mkdirSync(
    path.dirname(target),
    {
      recursive: true
    }
  );

  fs.copyFileSync(
    source,
    target
  );

  console.log(
    "[FACE API] OK: " +
    path.relative(
      projectRoot,
      target
    )
  );
}

function readManifest(
  manifestPath
) {
  let parsed;

  try {
    parsed = JSON.parse(
      fs.readFileSync(
        manifestPath,
        "utf8"
      )
    );
  } catch (error) {
    throw new Error(
      "Não foi possível ler o manifest facial:\n" +
      manifestPath +
      "\n" +
      (
        error?.message ||
        String(error)
      )
    );
  }

  if (
    !Array.isArray(parsed) ||
    !parsed[0] ||
    !Array.isArray(
      parsed[0].paths
    )
  ) {
    throw new Error(
      "Manifest facial inválido ou sem paths:\n" +
      manifestPath
    );
  }

  return parsed[0].paths;
}

function findBrowserLibrary() {
  const candidates = [
    path.join(
      sourceDist,
      "face-api.min.js"
    ),

    path.join(
      sourceDist,
      "face-api.js"
    )
  ];

  for (
    const candidate of candidates
  ) {
    if (
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }

  throw new Error(
    "A biblioteca browser do FaceAPI não foi encontrada.\n\n" +
    "Foram procurados:\n" +
    candidates.join("\n")
  );
}

function prepareFaceModels() {
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
    throw new Error(
      "O pacote @vladmandic/face-api não foi encontrado.\n\n" +
      "Local esperado:\n" +
      faceApiRoot
    );
  }

  if (
    !fs.existsSync(sourceDist)
  ) {
    throw new Error(
      "A pasta dist do FaceAPI não foi encontrada:\n" +
      sourceDist
    );
  }

  if (
    !fs.existsSync(sourceModels)
  ) {
    throw new Error(
      "A pasta model do FaceAPI não foi encontrada:\n" +
      sourceModels
    );
  }

  const browserLibrary =
    findBrowserLibrary();

  fs.mkdirSync(
    targetFaceApi,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    targetModels,
    {
      recursive: true
    }
  );

  console.log(
    "[FACE API] Biblioteca encontrada:"
  );

  console.log(
    "          " +
    path.relative(
      projectRoot,
      browserLibrary
    )
  );

  /*
   * O frontend espera exatamente:
   *
   * /face-api/face-api.min.js
   *
   * Independentemente de o pacote instalado
   * trazer face-api.js ou face-api.min.js.
   */
  copyFile(
    browserLibrary,
    path.join(
      targetFaceApi,
      "face-api.min.js"
    )
  );

  console.log(
    "[FACE API] A preparar manifests e pesos..."
  );

  for (
    const manifestName of requiredManifests
  ) {
    const manifestSource =
      path.join(
        sourceModels,
        manifestName
      );

    const manifestTarget =
      path.join(
        targetModels,
        manifestName
      );

    copyFile(
      manifestSource,
      manifestTarget
    );

    const shardPaths =
      readManifest(
        manifestSource
      );

    for (
      const shard of shardPaths
    ) {
      if (
        typeof shard !== "string" ||
        !shard.trim()
      ) {
        throw new Error(
          "O manifest contém um shard inválido:\n" +
          manifestSource
        );
      }

      copyFile(
        path.join(
          sourceModels,
          shard
        ),
        path.join(
          targetModels,
          shard
        )
      );
    }
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

  return {
    library:
      path.join(
        targetFaceApi,
        "face-api.min.js"
      ),

    models:
      targetModels
  };
}

module.exports =
  prepareFaceModels;

if (
  require.main === module
) {
  try {
    prepareFaceModels();

  } catch (error) {
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

    console.error(
      error?.message ||
      String(error)
    );

    console.error("");

    process.exit(1);
  }
}
