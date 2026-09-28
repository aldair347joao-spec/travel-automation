"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const logger = require("../../utils/logger");

let ffmpegStaticPath = null;

try {
  ffmpegStaticPath = require("ffmpeg-static");
} catch (error) {
  logger.warn(
    "ffmpeg-static could not be loaded",
    {
      error:
        error?.message ||
        String(error)
    }
  );
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const DEFAULT_FPS = 30;

const WIDTH =
  Number(
    process.env.LIVENESS_Y4M_WIDTH
  ) ||
  DEFAULT_WIDTH;

const HEIGHT =
  Number(
    process.env.LIVENESS_Y4M_HEIGHT
  ) ||
  DEFAULT_HEIGHT;

const FPS =
  Number(
    process.env.LIVENESS_Y4M_FPS
  ) ||
  DEFAULT_FPS;

const FFMPEG_TIMEOUT_MS =
  Number(
    process.env.LIVENESS_Y4M_FFMPEG_TIMEOUT_MS
  ) ||
  120000;

const CACHE_DIRECTORY =
  process.env.LIVENESS_Y4M_DIRECTORY ||
  path.join(
    os.tmpdir(),
    "travel-automation-liveness-y4m"
  );

/*
 * ============================================================
 * UTILITÁRIOS
 * ============================================================
 */

function ensureDirectory(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function safeString(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
}

function resolveFfmpegPath() {
  const configured =
    String(
      process.env.LIVENESS_FFMPEG_PATH ||
      process.env.FFMPEG_PATH ||
      ""
    ).trim();

  if (configured) {
    if (
      fs.existsSync(configured)
    ) {
      return configured;
    }

    throw new Error(
      `Configured FFmpeg path does not exist: ${configured}`
    );
  }

  if (
    ffmpegStaticPath &&
    fs.existsSync(
      ffmpegStaticPath
    )
  ) {
    return ffmpegStaticPath;
  }

  return "ffmpeg";
}

/*
 * ============================================================
 * CONFIGURAÇÃO
 * ============================================================
 */

function validateConfiguration() {
  if (
    !Number.isInteger(WIDTH) ||
    WIDTH <= 0
  ) {
    throw new Error(
      `Invalid LIVENESS_Y4M_WIDTH: ${WIDTH}`
    );
  }

  if (
    !Number.isInteger(HEIGHT) ||
    HEIGHT <= 0
  ) {
    throw new Error(
      `Invalid LIVENESS_Y4M_HEIGHT: ${HEIGHT}`
    );
  }

  if (
    !Number.isInteger(FPS) ||
    FPS <= 0
  ) {
    throw new Error(
      `Invalid LIVENESS_Y4M_FPS: ${FPS}`
    );
  }
}

/*
 * ============================================================
 * CACHE
 * ============================================================
 */

function createCacheKey({
  videoId,
  position,
  buffer
}) {
  const hash =
    crypto
      .createHash("sha256")
      .update(
        buffer
      )
      .digest("hex");

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        videoId:
          videoId || null,

        position:
          Number(position) || null,

        width:
          WIDTH,

        height:
          HEIGHT,

        fps:
          FPS,

        sourceHash:
          hash
      })
    )
    .digest("hex");
}

/*
 * ============================================================
 * VALIDAÇÃO Y4M
 * ============================================================
 */

function validateY4mFile(filePath) {
  if (
    !filePath ||
    typeof filePath !== "string"
  ) {
    throw new Error(
      "Y4M file path is required."
    );
  }

  if (
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      `Y4M file was not created: ${filePath}`
    );
  }

  const stats =
    fs.statSync(
      filePath
    );

  if (
    !stats.isFile() ||
    stats.size < 32
  ) {
    throw new Error(
      `Y4M file is empty or invalid: ${filePath}`
    );
  }

  const fd =
    fs.openSync(
      filePath,
      "r"
    );

  try {
    const headerBuffer =
      Buffer.alloc(1024);

    const bytesRead =
      fs.readSync(
        fd,
        headerBuffer,
        0,
        headerBuffer.length,
        0
      );

    const header =
      headerBuffer
        .subarray(
          0,
          bytesRead
        )
        .toString(
          "ascii"
        );

    if (
      !header.startsWith(
        "YUV4MPEG2"
      )
    ) {
      throw new Error(
        "Generated file does not contain a valid YUV4MPEG2 header."
      );
    }

    const firstLine =
      header
        .split("\n")[0]
        .trim();

    const expectedWidth =
      `W${WIDTH}`;

    const expectedHeight =
      `H${HEIGHT}`;

    if (
      !firstLine.includes(
        expectedWidth
      ) ||
      !firstLine.includes(
        expectedHeight
      )
    ) {
      throw new Error(
        `Generated Y4M dimensions are not ${WIDTH}x${HEIGHT}. Header: ${firstLine}`
      );
    }

    /*
     * A câmera simulada deve receber
     * exatamente a taxa configurada.
     *
     * O FFmpeg pode escrever:
     *
     * F30:1
     * F30000:1001
     * etc.
     *
     * Por isso não rejeitamos aqui formatos
     * equivalentes sem antes parsear.
     */

    const frameRateMatch =
      firstLine.match(
        /(?:^|\s)F(\d+):(\d+)(?:\s|$)/
      );

    let frameRate = null;

    if (
      frameRateMatch
    ) {
      const numerator =
        Number(
          frameRateMatch[1]
        );

      const denominator =
        Number(
          frameRateMatch[2]
        );

      if (
        numerator > 0 &&
        denominator > 0
      ) {
        frameRate =
          numerator /
          denominator;
      }
    }

    return {
      valid: true,

      size:
        stats.size,

      header:
        firstLine,

      width:
        WIDTH,

      height:
        HEIGHT,

      fps:
        frameRate
    };
  } finally {
    fs.closeSync(fd);
  }
}

/*
 * ============================================================
 * FFmpeg
 * ============================================================
 */

function runFfmpeg({
  inputPath,
  outputPath
}) {
  return new Promise(
    (resolve, reject) => {
      const ffmpeg =
        resolveFfmpegPath();

      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",

        "-i",
        inputPath,

        "-vf",
        [
          `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
          `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
          "format=yuv420p"
        ].join(","),

        "-r",
        String(FPS),

        /*
         * Não transportar áudio.
         *
         * A fonte Y4M será exclusivamente
         * vídeo.
         */
        "-an",

        "-f",
        "yuv4mpegpipe",

        outputPath
      ];

      logger.info(
        "Starting liveness video conversion to Y4M",
        {
          inputPath,
          outputPath,
          width:
            WIDTH,
          height:
            HEIGHT,
          fps:
            FPS,
          ffmpeg:
            ffmpeg ===
            "ffmpeg"
              ? "system"
              : ffmpeg
        }
      );

      const child =
        spawn(
          ffmpeg,
          args,
          {
            stdio: [
              "ignore",
              "ignore",
              "pipe"
            ]
          }
        );

      let stderr = "";

      let finished = false;

      const timer =
        setTimeout(
          () => {
            if (finished) {
              return;
            }

            finished = true;

            try {
              child.kill(
                "SIGKILL"
              );
            } catch {
              // Ignore process termination errors.
            }

            reject(
              new Error(
                `FFmpeg conversion timed out after ${FFMPEG_TIMEOUT_MS}ms.`
              )
            );
          },
          FFMPEG_TIMEOUT_MS
        );

      child.stderr.on(
        "data",
        chunk => {
          stderr +=
            chunk.toString();

          if (
            stderr.length >
            10000
          ) {
            stderr =
              stderr.slice(
                -10000
              );
          }
        }
      );

      child.once(
        "error",
        error => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(
            timer
          );

          reject(
            new Error(
              `FFmpeg could not be started: ${
                error?.message ||
                String(error)
              }`
            )
          );
        }
      );

      child.once(
        "close",
        code => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(
            timer
          );

          if (
            code !== 0
          ) {
            reject(
              new Error(
                `FFmpeg exited with code ${code}. ${
                  stderr.trim()
                }`
              )
            );

            return;
          }

          resolve({
            success: true
          });
        }
      );
    }
  );
}

/*
 * ============================================================
 * CONVERTER
 * ============================================================
 *
 * IMPORTANTE:
 *
 * Esta função NÃO altera o vídeo original.
 *
 * Ela recebe o buffer original,
 * cria uma representação Y4M separada
 * e coloca essa representação no cache.
 */

async function convert({
  buffer,
  videoId = null,
  position = null,
  filename = "liveness.webm",
  mimeType = "video/webm"
}) {
  validateConfiguration();

  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    throw new Error(
      "A non-empty video buffer is required."
    );
  }

  ensureDirectory(
    CACHE_DIRECTORY
  );

  const cacheKey =
    createCacheKey({
      videoId,
      position,
      buffer
    });

  const cachePath =
    path.join(
      CACHE_DIRECTORY,
      `${safeString(
        videoId ||
          `position-${position || "unknown"}`
      )}-${cacheKey}.y4m`
    );

  /*
   * Reutilizar conversão anterior
   * quando o vídeo é exatamente o mesmo.
   */

  if (
    fs.existsSync(
      cachePath
    )
  ) {
    try {
      const validation =
        validateY4mFile(
          cachePath
        );

      logger.info(
        "Using cached liveness Y4M",
        {
          videoId,
          position,
          cachePath,
          size:
            validation.size,
          header:
            validation.header
        }
      );

      return {
        success: true,

        path:
          cachePath,

        cached:
          true,

        width:
          WIDTH,

        height:
          HEIGHT,

        fps:
          FPS,

        videoId,

        position
      };
    } catch (error) {
      logger.warn(
        "Cached liveness Y4M is invalid; regenerating",
        {
          videoId,
          position,
          cachePath,
          error:
            error?.message ||
            String(error)
        }
      );

      try {
        fs.unlinkSync(
          cachePath
        );
      } catch {
        // Ignore cleanup failure.
      }
    }
  }

  const temporaryDirectory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "travel-liveness-"
      )
    );

  const extension =
    path.extname(
      filename ||
        ""
    ) ||
    ".webm";

  const inputPath =
    path.join(
      temporaryDirectory,
      `input${extension}`
    );

  const temporaryY4mPath =
    path.join(
      temporaryDirectory,
      "output.y4m"
    );

  try {
    fs.writeFileSync(
      inputPath,
      buffer
    );

    logger.info(
      "Converting stored liveness video to Y4M",
      {
        videoId,
        position,
        filename,
        mimeType,
        inputBytes:
          buffer.length
      }
    );

    await runFfmpeg({
      inputPath,
      outputPath:
        temporaryY4mPath
    });

    const validation =
      validateY4mFile(
        temporaryY4mPath
      );

    /*
     * Movimento atômico para o cache.
     */
    const temporaryCachePath =
      `${cachePath}.tmp-${process.pid}-${Date.now()}`;

    fs.copyFileSync(
      temporaryY4mPath,
      temporaryCachePath
    );

    validateY4mFile(
      temporaryCachePath
    );

    fs.renameSync(
      temporaryCachePath,
      cachePath
    );

    logger.info(
      "Liveness video successfully converted to Y4M",
      {
        videoId,
        position,
        cachePath,
        size:
          validation.size,
        width:
          WIDTH,
        height:
          HEIGHT,
        fps:
          FPS
      }
    );

    return {
      success: true,

      path:
        cachePath,

      cached:
        false,

      width:
        WIDTH,

      height:
        HEIGHT,

      fps:
        FPS,

      videoId,

      position
    };
  } finally {
    try {
      fs.rmSync(
        temporaryDirectory,
        {
          recursive:
            true,
          force:
            true
        }
      );
    } catch (error) {
      logger.warn(
        "Could not remove temporary liveness conversion directory",
        {
          error:
            error?.message ||
            String(error)
        }
      );
    }
  }
}

/*
 * ============================================================
 * PREPARAR CÂMERA SIMULADA
 * ============================================================
 *
 * Esta é a nova camada.
 *
 * Recebe o Y4M já preparado e devolve os argumentos
 * necessários para o Chromium utilizar esse arquivo
 * como fonte da câmera.
 *
 * O Y4M continua sendo apenas um arquivo intermediário.
 * O vídeo original não é alterado.
 */

function prepareCameraCapture({
  y4mPath,
  videoId = null,
  position = null
}) {
  validateConfiguration();

  if (
    !y4mPath ||
    typeof y4mPath !== "string"
  ) {
    throw new Error(
      "A Y4M file path is required to prepare simulated camera capture."
    );
  }

  const absolutePath =
    path.resolve(
      y4mPath
    );

  const validation =
    validateY4mFile(
      absolutePath
    );

  logger.info(
    "Prepared Y4M source for Chromium camera capture",
    {
      videoId,
      position,
      y4mPath:
        absolutePath,
      width:
        validation.width,
      height:
        validation.height,
      fps:
        validation.fps
    }
  );

  return {
    success: true,

    path:
      absolutePath,

    videoId,

    position,

    width:
      WIDTH,

    height:
      HEIGHT,

    fps:
      FPS,

    chromiumArgs: [
      `--use-file-for-fake-video-capture=${absolutePath}`
    ]
  };
}

/*
 * ============================================================
 * CONVERTER + CÂMERA
 * ============================================================
 *
 * Atalho para o próximo estágio da integração:
 *
 * vídeo original
 *      ↓
 * Y4M
 *      ↓
 * argumentos Chromium
 */

async function prepareFromBuffer({
  buffer,
  videoId = null,
  position = null,
  filename = "liveness.webm",
  mimeType = "video/webm"
}) {
  const converted =
    await convert({
      buffer,
      videoId,
      position,
      filename,
      mimeType
    });

  const camera =
    prepareCameraCapture({
      y4mPath:
        converted.path,

      videoId,

      position
    });

  return {
    ...converted,

    camera
  };
}

/*
 * ============================================================
 * VERIFICAÇÃO DIRETA DE UM ARQUIVO
 * ============================================================
 */

function inspect(y4mPath) {
  validateConfiguration();

  const absolutePath =
    path.resolve(
      String(
        y4mPath || ""
      )
    );

  const validation =
    validateY4mFile(
      absolutePath
    );

  return {
    success: true,

    path:
      absolutePath,

    ...validation
  };
}

/*
 * ============================================================
 * LIMPAR CACHE
 * ============================================================
 */

function clearCache() {
  if (
    !fs.existsSync(
      CACHE_DIRECTORY
    )
  ) {
    return {
      success: true,
      removed: 0
    };
  }

  let removed = 0;

  for (
    const filename of
    fs.readdirSync(
      CACHE_DIRECTORY
    )
  ) {
    const filePath =
      path.join(
        CACHE_DIRECTORY,
        filename
      );

    try {
      const stats =
        fs.statSync(
          filePath
        );

      if (
        stats.isFile()
      ) {
        fs.unlinkSync(
          filePath
        );

        removed += 1;
      }
    } catch (error) {
      logger.warn(
        "Could not remove Y4M cache file",
        {
          filePath,
          error:
            error?.message ||
            String(error)
        }
      );
    }
  }

  return {
    success: true,
    removed
  };
}

/*
 * ============================================================
 * CONFIGURAÇÃO PÚBLICA
 * ============================================================
 */

function getConfig() {
  let ffmpegPath;

  try {
    ffmpegPath =
      resolveFfmpegPath();
  } catch {
    ffmpegPath = null;
  }

  return {
    width:
      WIDTH,

    height:
      HEIGHT,

    fps:
      FPS,

    directory:
      CACHE_DIRECTORY,

    ffmpeg:
      ffmpegPath,

    ffmpegStatic:
      Boolean(
        ffmpegStaticPath &&
        fs.existsSync(
          ffmpegStaticPath
        )
      ),

    timeoutMs:
      FFMPEG_TIMEOUT_MS,

    simulatedCamera:
      true,

    chromiumArgument:
      "--use-file-for-fake-video-capture=<absolute-y4m-path>"
  };
}

module.exports = {
  convert,
  prepareCameraCapture,
  prepareFromBuffer,
  inspect,
  clearCache,
  getConfig
};
