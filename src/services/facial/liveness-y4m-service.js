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

function validateY4mFile(filePath) {
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
      Buffer.alloc(512);

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

    const expectedWidth =
      `W${WIDTH}`;

    const expectedHeight =
      `H${HEIGHT}`;

    if (
      !header.includes(
        expectedWidth
      ) ||
      !header.includes(
        expectedHeight
      )
    ) {
      throw new Error(
        `Generated Y4M dimensions are not ${WIDTH}x${HEIGHT}.`
      );
    }

    return {
      valid: true,

      size:
        stats.size,

      header:
        header
          .split("\n")[0]
          .trim()
    };
  } finally {
    fs.closeSync(fd);
  }
}

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
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
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
          applicationId:
            null,

          videoId,
          position,
          cachePath,
          size:
            validation.size
        }
      );

      return {
        success: true,
        path: cachePath,
        cached: true,
        width: WIDTH,
        height: HEIGHT,
        fps: FPS,
        videoId,
        position
      };
    } catch {
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
      "Converting decrypted liveness video",
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
     * Move atomically into the cache.
     * This prevents another process from seeing
     * a partially generated Y4M file.
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
        width: WIDTH,
        height: HEIGHT,
        fps: FPS
      }
    );

    return {
      success: true,
      path: cachePath,
      cached: false,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      videoId,
      position
    };
  } finally {
    try {
      fs.rmSync(
        temporaryDirectory,
        {
          recursive: true,
          force: true
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

function getConfig() {
  let ffmpegPath;

  try {
    ffmpegPath =
      resolveFfmpegPath();
  } catch (error) {
    ffmpegPath = null;
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,

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
      FFMPEG_TIMEOUT_MS
  };
}

module.exports = {
  convert,
  clearCache,
  getConfig
};
