const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  encrypt,
  decrypt
} = require("../../utils/crypto");

/*
 * ============================================================
 * LIVENESS VIDEO STORAGE SERVICE
 * ============================================================
 *
 * Guarda o vídeo completo da sessão de liveness.
 *
 * O vídeo:
 *
 * - NÃO fica dentro do documento Client;
 * - NÃO fica dentro da Application;
 * - NÃO fica exposto através de URL pública;
 * - é associado ao accountId + clientId + sessionId;
 * - é cifrado antes de entrar no GridFS;
 * - só pode ser recuperado por uma rota administrativa
 *   autorizada.
 *
 * O objetivo é permitir que a Administração veja a sessão
 * facial real do cliente executando as 10 posições.
 * ============================================================
 */

const DEFAULT_MAX_BYTES =
  Number(
    process.env.LIVENESS_VIDEO_MAX_STORAGE_BYTES
  ) ||
  25 * 1024 * 1024;

const DEFAULT_RETENTION_DAYS =
  Number(
    process.env.LIVENESS_VIDEO_RETENTION_DAYS
  ) ||
  30;

const BUCKET_NAME =
  "travel_liveness_videos";


function getBucket() {
  if (
    !mongoose.connection ||
    mongoose.connection.readyState !== 1 ||
    !mongoose.connection.db
  ) {
    throw new Error(
      "MongoDB não está disponível para armazenamento do vídeo de liveness."
    );
  }

  return new mongoose.mongo.GridFSBucket(
    mongoose.connection.db,
    {
      bucketName:
        BUCKET_NAME
    }
  );
}


/*
 * ============================================================
 * CIFRAGEM
 * ============================================================
 *
 * O crypto.js existente trabalha com strings.
 *
 * O vídeo é convertido para base64 antes da cifragem.
 *
 * Isto significa que o GridFS nunca recebe o vídeo original.
 * ============================================================
 */

function encryptBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(
      "Liveness video must be a Buffer"
    );
  }

  return encrypt(
    buffer.toString("base64")
  );
}


function decryptBuffer(value) {
  if (!value) {
    return null;
  }

  const base64 =
    decrypt(value);

  if (!base64) {
    return null;
  }

  return Buffer.from(
    base64,
    "base64"
  );
}


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
      .toLowerCase();

  const aliases = {
    "video/webm":
      "video/webm",

    "video/webm;codecs=vp8,opus":
      "video/webm",

    "video/webm;codecs=vp9,opus":
      "video/webm",

    "video/mp4":
      "video/mp4",

    "video/quicktime":
      "video/quicktime"
  };

  return (
    aliases[value] ||
    null
  );
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
      return "mp4";

    case "video/quicktime":
      return "mov";

    case "video/webm":
    default:
      return "webm";
  }
}


/*
 * ============================================================
 * RETENÇÃO
 * ============================================================
 */

function getExpirationDate(
  retentionDays
) {
  const days =
    Number.isFinite(
      Number(
        retentionDays
      )
    )
      ? Number(
          retentionDays
        )
      : DEFAULT_RETENTION_DAYS;

  const expires =
    new Date();

  expires.setDate(
    expires.getDate() +
      Math.max(
        1,
        days
      )
  );

  return expires;
}


/*
 * ============================================================
 * SERVIÇO
 * ============================================================
 */

class LivenessVideoStorageService {

  constructor() {
    this.maxBytes =
      DEFAULT_MAX_BYTES;

    this.retentionDays =
      DEFAULT_RETENTION_DAYS;
  }


  /*
   * ==========================================================
   * VALIDAR
   * ==========================================================
   */

  validateInput({
    accountId,
    clientId,
    sessionId,
    buffer,
    mimeType
  }) {

    if (
      !accountId
    ) {
      throw new Error(
        "accountId é obrigatório para guardar o vídeo de liveness."
      );
    }


    if (
      !clientId
    ) {
      throw new Error(
        "clientId é obrigatório para guardar o vídeo de liveness."
      );
    }


    if (
      !sessionId
    ) {
      throw new Error(
        "sessionId é obrigatório para guardar o vídeo de liveness."
      );
    }


    if (
      !Buffer.isBuffer(
        buffer
      )
    ) {
      throw new TypeError(
        "O vídeo de liveness deve ser um Buffer."
      );
    }


    if (
      !buffer.length
    ) {
      throw new Error(
        "O vídeo de liveness está vazio."
      );
    }


    if (
      buffer.length >
      this.maxBytes
    ) {
      throw new Error(
        `O vídeo de liveness excede o limite de ${Math.round(
          this.maxBytes /
            1024 /
            1024
        )} MB.`
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
        "Formato de vídeo de liveness não suportado."
      );
    }


    return normalizedMime;
  }


  /*
   * ==========================================================
   * GUARDAR
   * ==========================================================
   */

  async save({
    accountId,
    clientId,
    sessionId,
    buffer,
    mimeType,
    startedAt = null,
    completedAt = null
  }) {

    const normalizedMime =
      this.validateInput({
        accountId,
        clientId,
        sessionId,
        buffer,
        mimeType
      });


    const bucket =
      getBucket();


    /*
     * --------------------------------------------------------
     * Remover vídeo anterior da mesma sessão.
     * --------------------------------------------------------
     */

    const existingFiles =
      await bucket
        .find({
          "metadata.accountId":
            String(
              accountId
            ),

          "metadata.clientId":
            String(
              clientId
            ),

          "metadata.sessionId":
            String(
              sessionId
            )
        })
        .toArray();


    for (
      const file
      of existingFiles
    ) {

      try {

        await bucket.delete(
          file._id
        );

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Não foi possível remover vídeo anterior:",
          error?.message ||
            error
        );

      }
    }


    /*
     * --------------------------------------------------------
     * Cifrar antes de guardar.
     * --------------------------------------------------------
     */

    const encryptedData =
      encryptBuffer(
        buffer
      );


    const encryptedBuffer =
      Buffer.from(
        encryptedData,
        "utf8"
      );


    const fileId =
      new mongoose.Types.ObjectId();


    const extension =
      extensionForMime(
        normalizedMime
      );


    const filename =
      `liveness-${String(
        clientId
      )}-${String(
        sessionId
      )}.${extension}`;


    const expiresAt =
      getExpirationDate(
        this.retentionDays
      );


    /*
     * --------------------------------------------------------
     * Upload GridFS
     * --------------------------------------------------------
     */

    await new Promise(
      (
        resolve,
        reject
      ) => {

        const uploadStream =
          bucket.openUploadStreamWithId(
            fileId,
            filename,
            {
              contentType:
                "application/octet-stream",

              metadata: {

                type:
                  "travel_automation_liveness_video",

                accountId:
                  String(
                    accountId
                  ),

                clientId:
                  String(
                    clientId
                  ),

                sessionId:
                  String(
                    sessionId
                  ),

                originalMimeType:
                  normalizedMime,

                originalSize:
                  buffer.length,

                encrypted:
                  true,

                expiresAt,

                startedAt:
                  startedAt
                    ? new Date(
                        startedAt
                      )
                    : null,

                completedAt:
                  completedAt
                    ? new Date(
                        completedAt
                      )
                    : null
              }
            }
          );


        uploadStream.once(
          "error",
          reject
        );


        uploadStream.once(
          "finish",
          resolve
        );


        uploadStream.end(
          encryptedBuffer
        );

      }
    );


    /*
     * --------------------------------------------------------
     * Resultado seguro.
     * --------------------------------------------------------
     */

    return {
      videoId:
        fileId.toString(),

      sessionId:
        String(
          sessionId
        ),

      mimeType:
        normalizedMime,

      originalSize:
        buffer.length,

      storedSize:
        encryptedBuffer.length,

      expiresAt,

      bucket:
        BUCKET_NAME
    };
  }


  /*
   * ==========================================================
   * LOCALIZAR
   * ==========================================================
   */

  async find({
    accountId,
    clientId,
    sessionId
  }) {

    const bucket =
      getBucket();


    const query = {};


    if (
      accountId
    ) {
      query[
        "metadata.accountId"
      ] =
        String(
          accountId
        );
    }


    if (
      clientId
    ) {
      query[
        "metadata.clientId"
      ] =
        String(
          clientId
        );
    }


    if (
      sessionId
    ) {
      query[
        "metadata.sessionId"
      ] =
        String(
          sessionId
        );
    }


    const files =
      await bucket
        .find(
          query
        )
        .sort({
          uploadDate:
            -1
        })
        .limit(1)
        .toArray();


    return (
      files[0] ||
      null
    );
  }


  /*
   * ==========================================================
   * LER VÍDEO
   * ==========================================================
   */

  async get({
    accountId,
    clientId,
    sessionId
  }) {

    const file =
      await this.find({
        accountId,
        clientId,
        sessionId
      });


    if (!file) {
      return null;
    }


    const expiresAt =
      file?.metadata
        ?.expiresAt
        ? new Date(
            file.metadata.expiresAt
          )
        : null;


    if (
      expiresAt &&
      expiresAt.getTime() <
        Date.now()
    ) {

      try {

        const bucket =
          getBucket();

        await bucket.delete(
          file._id
        );

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Falha ao remover vídeo expirado:",
          error?.message ||
            error
        );

      }


      return null;
    }


    const bucket =
      getBucket();


    const chunks =
      [];


    await new Promise(
      (
        resolve,
        reject
      ) => {

        const downloadStream =
          bucket.openDownloadStream(
            file._id
          );


        downloadStream.on(
          "data",
          chunk => {
            chunks.push(
              chunk
            );
          }
        );


        downloadStream.once(
          "error",
          reject
        );


        downloadStream.once(
          "end",
          resolve
        );

      }
    );


    const encryptedBuffer =
      Buffer.concat(
        chunks
      );


    if (
      !encryptedBuffer.length
    ) {
      throw new Error(
        "O vídeo de liveness armazenado está vazio."
      );
    }


    const decrypted =
      decryptBuffer(
        encryptedBuffer.toString(
          "utf8"
        )
      );


    if (
      !decrypted ||
      !decrypted.length
    ) {
      throw new Error(
        "Não foi possível desencriptar o vídeo de liveness."
      );
    }


    return {
      buffer:
        decrypted,

      mimeType:
        file?.metadata
          ?.originalMimeType ||
        "video/webm",

      filename:
        String(
          file.filename ||
            "liveness.webm"
        )
          .replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          ),

      videoId:
        file._id.toString(),

      sessionId:
        file?.metadata
          ?.sessionId ||
        null,

      uploadedAt:
        file.uploadDate ||
        null,

      expiresAt,

      originalSize:
        Number(
          file?.metadata
            ?.originalSize ||
            decrypted.length
        )
    };
  }


  /*
   * ==========================================================
   * APAGAR
   * ==========================================================
   */

  async delete({
    accountId,
    clientId,
    sessionId
  }) {

    const bucket =
      getBucket();


    const files =
      await bucket
        .find({
          "metadata.accountId":
            String(
              accountId
            ),

          "metadata.clientId":
            String(
              clientId
            ),

          ...(sessionId
            ? {
                "metadata.sessionId":
                  String(
                    sessionId
                  )
              }
            : {})
        })
        .toArray();


    let deleted =
      0;


    for (
      const file
      of files
    ) {

      try {

        await bucket.delete(
          file._id
        );

        deleted += 1;

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Falha ao apagar vídeo:",
          error?.message ||
            error
        );

      }
    }


    return {
      deleted
    };
  }


  /*
   * ==========================================================
   * LIMPEZA DE VÍDEOS EXPIRADOS
   * ==========================================================
   */

  async cleanupExpired() {

    const bucket =
      getBucket();


    const files =
      await bucket
        .find({})
        .toArray();


    let deleted =
      0;


    for (
      const file
      of files
    ) {

      const expiresAt =
        file?.metadata
          ?.expiresAt
          ? new Date(
              file.metadata.expiresAt
            )
          : null;


      if (
        !expiresAt ||
        expiresAt.getTime() >=
          Date.now()
      ) {
        continue;
      }


      try {

        await bucket.delete(
          file._id
        );

        deleted += 1;

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Falha na limpeza:",
          error?.message ||
            error
        );

      }
    }


    return {
      deleted
    };
  }
}


module.exports =
  LivenessVideoStorageService;
