"use strict";

/*
 * ============================================================
 * TRAVEL AUTOMATION
 * LIVENESS Y4M SERVICE
 * ============================================================
 *
 * Converte um segmento REAL de liveness já aprovado
 * para Y4M, formato que o Chromium pode utilizar como
 * fonte de câmera através de:
 *
 * --use-file-for-fake-video-capture
 *
 * IMPORTANTE:
 *
 * Este serviço NÃO:
 *
 * - cria movimentos artificiais;
 * - altera a posição do rosto;
 * - gera uma pessoa;
 * - modifica o conteúdo biométrico;
 * - substitui o liveness original;
 * - grava novamente no GridFS.
 *
 * Ele apenas:
 *
 *   vídeo real armazenado
 *          ↓
 *       FFmpeg
 *          ↓
 *     arquivo Y4M
 *
 * O vídeo original continua intacto no GridFS.
 * ============================================================
 */

const fs =
  require("fs");

const fsp =
  fs.promises;

const path =
  require("path");

const os =
  require("os");

const crypto =
  require("crypto");

const {
  spawn
} =
  require("child_process");

const logger =
  require("../../utils/logger");


/*
 * ============================================================
 * CONFIGURAÇÃO
 * ============================================================
 */

/*
 * Resolução padrão.
 *
 * 640x480 reduz bastante o tamanho do Y4M comparado com
 * 1280x720 e continua sendo uma resolução de webcam válida.
 *
 * Pode ser alterado por:
 *
 * LIVENESS_Y4M_WIDTH
 * LIVENESS_Y4M_HEIGHT
 */

const DEFAULT_WIDTH =
  Number(
    process.env.LIVENESS_Y4M_WIDTH
  ) ||
  640;


const DEFAULT_HEIGHT =
  Number(
    process.env.LIVENESS_Y4M_HEIGHT
  ) ||
  480;


/*
 * Framerate utilizado pela câmera virtual.
 */

const DEFAULT_FPS =
  Number(
    process.env.LIVENESS_Y4M_FPS
  ) ||
  30;


/*
 * Diretório temporário.
 *
 * Nunca usamos uma pasta pública do projeto.
 */

const DEFAULT_DIRECTORY =
  process.env.LIVENESS_Y4M_DIRECTORY ||
  path.join(
    os.tmpdir(),
    "travel-automation-liveness-y4m"
  );


/*
 * Tempo máximo de execução do FFmpeg.
 */

const DEFAULT_FFMPEG_TIMEOUT =
  Number(
    process.env.LIVENESS_Y4M_FFMPEG_TIMEOUT_MS
  ) ||
  120000;


/*
 * ============================================================
 * MIME
 * ============================================================
 */

function normalizeMimeType(
  mimeType
) {

  const value =
    String(
      mimeType ||
        ""
    )
      .trim()
      .toLowerCase()
      .split(";")[0]
      .trim();


  if (
    value ===
    "video/webm"
  ) {
    return "video/webm";
  }


  if (
    value ===
    "video/mp4"
  ) {
    return "video/mp4";
  }


  if (
    value ===
    "video/quicktime"
  ) {
    return "video/quicktime";
  }


  return null;
}


/*
 * ============================================================
 * EXTENSÃO
 * ============================================================
 */

function extensionForMime(
  mimeType
) {

  switch (
    normalizeMimeType(
      mimeType
    )
  ) {

    case "video/mp4":
      return ".mp4";

    case "video/quicktime":
      return ".mov";

    case "video/webm":
    default:
      return ".webm";
  }
}


/*
 * ============================================================
 * FFmpeg
 * ============================================================
 *
 * Ordem:
 *
 * 1. LIVENESS_FFMPEG_PATH
 * 2. FFMPEG_PATH
 * 3. "ffmpeg" no PATH do sistema
 *
 * Não usamos shell.
 */

function getFfmpegBinary() {

  const configured =
    String(
      process.env.LIVENESS_FFMPEG_PATH ||
      process.env.FFMPEG_PATH ||
      ""
    ).trim();


  if (
    configured
  ) {
    return configured;
  }


  return "ffmpeg";
}


/*
 * ============================================================
 * HASH
 * ============================================================
 *
 * Gera uma chave estável para o arquivo temporário.
 *
 * Assim, se a mesma posição já tiver sido convertida,
 * não precisamos executar FFmpeg novamente.
 */

function createCacheKey({
  videoId,
  position,
  buffer
}) {

  const hash =
    crypto
      .createHash("sha256");


  hash.update(
    String(
      videoId ||
      ""
    )
  );


  hash.update(
    "|"
  );


  hash.update(
    String(
      position ||
      ""
    )
  );


  /*
   * O conteúdo também participa da chave.
   *
   * Isso evita reutilizar um Y4M antigo se o vídeo tiver
   * sido substituído mantendo o mesmo identificador lógico.
   */

  if (
    Buffer.isBuffer(
      buffer
    )
  ) {

    hash.update(
      buffer
    );
  }


  return hash.digest(
    "hex"
  );
}


/*
 * ============================================================
 * DIRETÓRIO
 * ============================================================
 */

async function ensureDirectory() {

  await fsp.mkdir(
    DEFAULT_DIRECTORY,
    {
      recursive:
        true
    }
  );


  return DEFAULT_DIRECTORY;
}


/*
 * ============================================================
 * LIMPEZA SEGURA
 * ============================================================
 */

async function safeUnlink(
  filePath
) {

  if (
    !filePath
  ) {
    return;
  }


  try {

    await fsp.unlink(
      filePath
    );

  } catch (
    error
  ) {

    if (
      error?.code !==
      "ENOENT"
    ) {

      logger.warn(
        "Could not remove temporary liveness file",
        {
          filePath,
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
 * EXECUTAR FFmpeg
 * ============================================================
 */

function runFfmpeg({
  inputPath,
  outputPath,
  width,
  height,
  fps,
  timeoutMs
}) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const ffmpeg =
        getFfmpegBinary();


      const args = [
        "-hide_banner",
        "-loglevel",
        "error",

        "-y",

        "-i",
        inputPath,

        /*
         * Padronizar framerate.
         */

        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,

        "-r",
        String(
          fps
        ),

        /*
         * Y4M não precisa de áudio.
         */

        "-an",

        /*
         * Formato de saída exigido pelo Chromium.
         */

        "-f",
        "yuv4mpegpipe",

        outputPath
      ];


      logger.info(
        "Starting liveness video to Y4M conversion",
        {
          ffmpeg,
          inputPath,
          outputPath,
          width,
          height,
          fps
        }
      );


      let stderr =
        "";


      let settled =
        false;


      const finishError =
        error => {

          if (
            settled
          ) {
            return;
          }


          settled =
            true;


          reject(
            error
          );
        };


      const finishSuccess =
        result => {

          if (
            settled
          ) {
            return;
          }


          settled =
            true;


          resolve(
            result
          );
        };


      let child;


      try {

        /*
         * shell:false é intencional.
         *
         * Nenhum argumento vem de shell.
         */

        child =
          spawn(
            ffmpeg,
            args,
            {
              shell:
                false,

              windowsHide:
                true
            }
          );

      } catch (
        error
      ) {

        finishError(
          error
        );

        return;
      }


      const timer =
        setTimeout(
          () => {

            try {

              child.kill(
                "SIGKILL"
              );

            } catch {}


            const error =
              new Error(
                `FFmpeg excedeu o tempo máximo de ${timeoutMs} ms.`
              );


            error.code =
              "LIVENESS_Y4M_FFMPEG_TIMEOUT";


            finishError(
              error
            );

          },
          timeoutMs
        );


      child.stderr.on(
        "data",
        chunk => {

          stderr +=
            chunk.toString();

          /*
           * Evitar crescimento ilimitado do log.
           */

          if (
            stderr.length >
            20000
          ) {

            stderr =
              stderr.slice(
                -20000
              );
          }
        }
      );


      child.once(
        "error",
        error => {

          clearTimeout(
            timer
          );


          if (
            error?.code ===
            "ENOENT"
          ) {

            const ffmpegError =
              new Error(
                "FFmpeg não foi encontrado. Configure LIVENESS_FFMPEG_PATH ou instale FFmpeg no ambiente do servidor."
              );


            ffmpegError.code =
              "LIVENESS_Y4M_FFMPEG_NOT_FOUND";


            finishError(
              ffmpegError
            );

            return;
          }


          finishError(
            error
          );
        }
      );


      child.once(
        "close",
        code => {

          clearTimeout(
            timer
          );


          if (
            code === 0
          ) {

            finishSuccess({
              code,
              stderr
            });

            return;
          }


          const error =
            new Error(
              `FFmpeg falhou ao converter o vídeo para Y4M. Código: ${code}. ${stderr || "Sem detalhes adicionais."}`
            );


          error.code =
            "LIVENESS_Y4M_FFMPEG_FAILED";


          error.ffmpegExitCode =
            code;


          error.stderr =
            stderr;


          finishError(
            error
          );
        }
      );
    }
  );
}


/*
 * ============================================================
 * VALIDAR Y4M
 * ============================================================
 */

async function validateY4M(
  filePath,
  width,
  height
) {

  const stat =
    await fsp.stat(
      filePath
    );


  if (
    !stat.isFile()
  ) {

    throw new Error(
      "O resultado Y4M não é um ficheiro válido."
    );
  }


  if (
    stat.size <
    20
  ) {

    throw new Error(
      "O arquivo Y4M gerado está vazio ou incompleto."
    );
  }


  /*
   * Lemos apenas o cabeçalho.
   */

  const handle =
    await fsp.open(
      filePath,
      "r"
    );


  try {

    const buffer =
      Buffer.alloc(
        256
      );


    const result =
      await handle.read(
        buffer,
        0,
        buffer.length,
        0
      );


    const header =
      buffer
        .subarray(
          0,
          result.bytesRead
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
        "O FFmpeg não produziu um arquivo Y4M válido."
      );
    }


    /*
     * Verificação adicional da resolução.
     */

    const expectedResolution =
      `W${width} H${height}`;


    if (
      !header.includes(
        expectedResolution
      )
    ) {

      throw new Error(
        `O Y4M possui resolução diferente da esperada (${expectedResolution}).`
      );
    }

  } finally {

    await handle.close();
  }


  return {
    path:
      filePath,

    size:
      stat.size,

    width,

    height
  };
}


/*
 * ============================================================
 * SERVIÇO
 * ============================================================
 */

class LivenessY4MService {

  constructor({
    width =
      DEFAULT_WIDTH,

    height =
      DEFAULT_HEIGHT,

    fps =
      DEFAULT_FPS,

    directory =
      DEFAULT_DIRECTORY,

    timeoutMs =
      DEFAULT_FFMPEG_TIMEOUT
  } = {}) {

    this.width =
      Number(
        width
      );

    this.height =
      Number(
        height
      );

    this.fps =
      Number(
        fps
      );

    this.directory =
      directory;

    this.timeoutMs =
      Number(
        timeoutMs
      );


    if (
      !Number.isInteger(
        this.width
      ) ||
      this.width <= 0
    ) {

      throw new Error(
        "Liveness Y4M width inválida."
      );
    }


    if (
      !Number.isInteger(
        this.height
      ) ||
      this.height <= 0
    ) {

      throw new Error(
        "Liveness Y4M height inválida."
      );
    }


    if (
      !Number.isInteger(
        this.fps
      ) ||
      this.fps <= 0
    ) {

      throw new Error(
        "Liveness Y4M FPS inválido."
      );
    }
  }


  /*
   * ==========================================================
   * CONVERTER SEGMENTO
   * ==========================================================
   */

  async convert({
    buffer,
    mimeType,
    videoId = null,
    position = null,
    force = false
  }) {

    if (
      !Buffer.isBuffer(
        buffer
      )
    ) {

      throw new TypeError(
        "O segmento de liveness para conversão deve ser um Buffer."
      );
    }


    if (
      !buffer.length
    ) {

      throw new Error(
        "O segmento de liveness para conversão está vazio."
      );
    }


    const normalizedMime =
      normalizeMimeType(
        mimeType
      );


    if (
      !normalizedMime
    ) {

      throw new Error(
        "O MIME do segmento de liveness não é suportado para conversão Y4M."
      );
    }


    await ensureDirectory();


    const cacheKey =
      createCacheKey({
        videoId,
        position,
        buffer
      });


    const y4mPath =
      path.join(
        this.directory,
        `liveness-${cacheKey}-${this.width}x${this.height}-${this.fps}.y4m`
      );


    /*
     * --------------------------------------------------------
     * CACHE
     * --------------------------------------------------------
     */

    if (
      !force
    ) {

      try {

        const cached =
          await validateY4M(
            y4mPath,
            this.width,
            this.height
          );


        logger.info(
          "Using cached liveness Y4M",
          {
            videoId,
            position,
            path:
              y4mPath,
            size:
              cached.size
          }
        );


        return {
          ...cached,

          videoId,
          position,
          mimeType:
            normalizedMime,

          cached:
            true
        };

      } catch {
        /*
         * Cache inexistente ou inválido.
         * Continuamos com a conversão.
         */
      }
    }


    /*
     * --------------------------------------------------------
     * ARQUIVO DE ENTRADA
     * --------------------------------------------------------
     */

    const inputExtension =
      extensionForMime(
        normalizedMime
      );


    const inputPath =
      path.join(
        this.directory,
        `input-${cacheKey}${inputExtension}`
      );


    /*
     * Arquivo temporário de saída.
     *
     * Só renomeamos para o nome definitivo depois que
     * a conversão e validação terminarem.
     */

    const temporaryOutputPath =
      path.join(
        this.directory,
        `output-${cacheKey}-${Date.now()}.y4m`
      );


    try {

      await fsp.writeFile(
        inputPath,
        buffer
      );


      logger.info(
        "Converting real liveness segment to Y4M",
        {
          videoId,
          position,
          mimeType:
            normalizedMime,
          inputSize:
            buffer.length,
          output:
            y4mPath,
          width:
            this.width,
          height:
            this.height,
          fps:
            this.fps
        }
      );


      await runFfmpeg({
        inputPath,
        outputPath:
          temporaryOutputPath,

        width:
          this.width,

        height:
          this.height,

        fps:
          this.fps,

        timeoutMs:
          this.timeoutMs
      });


      const validated =
        await validateY4M(
          temporaryOutputPath,
          this.width,
          this.height
        );


      /*
       * ------------------------------------------------------
       * ATOMICIDADE
       * ------------------------------------------------------
       *
       * O arquivo só aparece no cache definitivo depois
       * que o FFmpeg terminou e o Y4M foi validado.
       */

      await safeUnlink(
        y4mPath
      );


      await fsp.rename(
        temporaryOutputPath,
        y4mPath
      );


      const finalValidated =
        await validateY4M(
          y4mPath,
          this.width,
          this.height
        );


      return {
        ...finalValidated,

        videoId,
        position,

        mimeType:
          normalizedMime,

        cached:
          false
      };

    } catch (
      error
    ) {

      logger.error(
        "Failed to convert liveness segment to Y4M",
        {
          videoId,
          position,
          mimeType:
            normalizedMime,

          error:
            error?.message ||
            String(error),

          code:
            error?.code ||
            null
        }
      );


      throw error;

    } finally {

      /*
       * Nunca deixamos o vídeo WebM/MP4 descriptografado
       * no diretório temporário depois da conversão.
       */

      await safeUnlink(
        inputPath
      );


      await safeUnlink(
        temporaryOutputPath
      );
    }
  }


  /*
   * ==========================================================
   * LIMPAR CACHE
   * ==========================================================
   *
   * Não é chamado automaticamente durante cada conversão.
   * O cache pode ser reutilizado enquanto a automação estiver
   * utilizando a mesma sessão.
   */

  async clearCache() {

    await ensureDirectory();


    const entries =
      await fsp.readdir(
        this.directory,
        {
          withFileTypes:
            true
        }
      );


    let removed =
      0;


    for (
      const entry
      of entries
    ) {

      if (
        !entry.isFile()
      ) {
        continue;
      }


      if (
        !entry.name.endsWith(
          ".y4m"
        )
      ) {
        continue;
      }


      const filePath =
        path.join(
          this.directory,
          entry.name
        );


      await safeUnlink(
        filePath
      );


      removed +=
        1;
    }


    return {
      removed
    };
  }


  /*
   * ==========================================================
   * INFO
   * ==========================================================
   */

  getConfig() {

    return {
      width:
        this.width,

      height:
        this.height,

      fps:
        this.fps,

      directory:
        this.directory,

      timeoutMs:
        this.timeoutMs,

      ffmpeg:
        getFfmpegBinary()
    };
  }
}


module.exports =
  LivenessY4MService;
