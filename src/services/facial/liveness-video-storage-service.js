"use strict";

const mongoose =
  require("mongoose");

const {
  encrypt,
  decrypt
} =
  require("../../utils/crypto");


/*
 * ============================================================
 * TRAVEL AUTOMATION
 * LIVENESS VIDEO STORAGE SERVICE
 * ============================================================
 *
 * Guarda SOMENTE os segmentos das posições CORRETAS.
 *
 * NÃO guarda:
 *
 * - tentativa errada;
 * - sessão completa;
 * - vídeo contínuo;
 * - vídeo dentro do Client;
 * - vídeo dentro da Application.
 *
 * Cada posição correta é armazenada como um segmento
 * independente no GridFS.
 *
 * Estrutura:
 *
 * accountId
 *    +
 * clientId
 *    +
 * sessionId
 *    +
 * position
 *
 * Assim a Administração pode recuperar:
 *
 * 1 - frontal
 * 2 - esquerda
 * 3 - direita
 * ...
 * 10 - sorriso
 *
 * sem receber as tentativas erradas.
 *
 * O conteúdo binário é cifrado antes de entrar no GridFS.
 * ============================================================
 */


const DEFAULT_MAX_SEGMENT_BYTES =
  Number(
    process.env.LIVENESS_VIDEO_MAX_SEGMENT_BYTES
  ) ||
  5 * 1024 * 1024;


const DEFAULT_MAX_SESSION_BYTES =
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


const MAX_POSITIONS =
  10;


/*
 * ============================================================
 * GRIDFS
 * ============================================================
 */

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
 */

function encryptBuffer(
  buffer
) {

  if (
    !Buffer.isBuffer(
      buffer
    )
  ) {
    throw new TypeError(
      "O vídeo de liveness deve ser um Buffer."
    );
  }


  return encrypt(
    buffer.toString(
      "base64"
    )
  );
}


function decryptBuffer(
  value
) {

  if (!value) {
    return null;
  }


  const base64 =
    decrypt(
      value
    );


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


  const base =
    value.split(
      ";"
    )[0].trim();


  const allowed = [
    "video/webm",
    "video/mp4",
    "video/quicktime"
  ];


  if (
    allowed.includes(
      base
    )
  ) {
    return base;
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
 * NORMALIZAÇÃO DA POSIÇÃO
 * ============================================================
 */

function normalizePosition(
  value
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isInteger(
      number
    )
  ) {
    return null;
  }


  if (
    number < 1 ||
    number > MAX_POSITIONS
  ) {
    return null;
  }


  return number;
}


/*
 * ============================================================
 * SERVIÇO
 * ============================================================
 */

class LivenessVideoStorageService {

  constructor() {

    this.maxSegmentBytes =
      DEFAULT_MAX_SEGMENT_BYTES;


    this.maxSessionBytes =
      DEFAULT_MAX_SESSION_BYTES;


    this.retentionDays =
      DEFAULT_RETENTION_DAYS;
  }


  /*
   * ==========================================================
   * VALIDAR INPUT
   * ==========================================================
   */

  validateInput({
    accountId,
    clientId,
    sessionId,
    position,
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


    const normalizedPosition =
      normalizePosition(
        position
      );


    if (
      !normalizedPosition
    ) {
      throw new Error(
        "A posição de liveness deve ser um número entre 1 e 10."
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
        "O segmento de vídeo de liveness está vazio."
      );
    }


    if (
      buffer.length >
      this.maxSegmentBytes
    ) {
      throw new Error(
        `O segmento da posição ${normalizedPosition} excede o limite de ${Math.round(
          this.maxSegmentBytes /
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


    return {
      position:
        normalizedPosition,

      mimeType:
        normalizedMime
    };
  }


  /*
   * ==========================================================
   * LISTAR SEGMENTOS DA SESSÃO
   * ==========================================================
   */

  async findAll({
    accountId,
    clientId,
    sessionId
  }) {

    const bucket =
      getBucket();


    const query = {
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
    };


    return bucket
      .find(
        query
      )
      .sort({
        "metadata.position":
          1
      })
      .toArray();
  }


  /*
   * ==========================================================
   * LOCALIZAR UMA POSIÇÃO
   * ==========================================================
   */

  async find({
    accountId,
    clientId,
    sessionId,
    position
  }) {

    const normalizedPosition =
      normalizePosition(
        position
      );


    const query = {
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
    };


    if (
      normalizedPosition
    ) {
      query[
        "metadata.position"
      ] =
        normalizedPosition;
    }


    const bucket =
      getBucket();


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
   * REMOVER UMA POSIÇÃO
   * ==========================================================
   *
   * Só é usada quando o mesmo segmento precisa ser substituído.
   * Não remove as outras posições.
   * ==========================================================
   */

  async deletePosition({
    accountId,
    clientId,
    sessionId,
    position
  }) {

    const normalizedPosition =
      normalizePosition(
        position
      );


    if (
      !normalizedPosition
    ) {
      return {
        deleted:
          0
      };
    }


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

          "metadata.sessionId":
            String(
              sessionId
            ),

          "metadata.position":
            normalizedPosition
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


        deleted +=
          1;

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Falha ao apagar segmento:",
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
   * GUARDAR SEGMENTO
   * ==========================================================
   *
   * IMPORTANTE:
   *
   * Não grava tentativas erradas.
   *
   * O frontend só chama este método depois de uma posição
   * ter sido validada.
   *
   * Cada posição possui o seu próprio ficheiro GridFS.
   * ==========================================================
   */

  async save({
    accountId,
    clientId,
    sessionId,
    position,
    label = null,
    instruction = null,
    score = null,
    positionScore = null,
    sequence = null,
    buffer,
    mimeType,
    startedAt = null,
    completedAt = null
  }) {

    const validation =
      this.validateInput({
        accountId,
        clientId,
        sessionId,
        position,
        buffer,
        mimeType
      });


    const normalizedPosition =
      validation.position;


    const normalizedMime =
      validation.mimeType;


    /*
     * --------------------------------------------------------
     * VERIFICAR TAMANHO TOTAL DA SESSÃO
     * --------------------------------------------------------
     */

    const existingFiles =
      await this.findAll({
        accountId,
        clientId,
        sessionId
      });


    let currentSessionBytes =
      0;


    for (
      const file
      of existingFiles
    ) {

      const filePosition =
        normalizePosition(
          file?.metadata
            ?.position
        );


      /*
       * Se estamos substituindo a mesma posição,
       * não contamos o tamanho antigo.
       */

      if (
        filePosition ===
        normalizedPosition
      ) {
        continue;
      }


      currentSessionBytes +=
        Number(
          file?.metadata
            ?.originalSize ||
            0
        );
    }


    const newSessionSize =
      currentSessionBytes +
      buffer.length;


    if (
      newSessionSize >
      this.maxSessionBytes
    ) {
      throw new Error(
        `Os segmentos de liveness desta sessão excedem o limite total de ${Math.round(
          this.maxSessionBytes /
            1024 /
            1024
        )} MB.`
      );
    }


    /*
     * --------------------------------------------------------
     * SUBSTITUIR APENAS A MESMA POSIÇÃO
     * --------------------------------------------------------
     */

    await this.deletePosition({
      accountId,
      clientId,
      sessionId,
      position:
        normalizedPosition
    });


    /*
     * --------------------------------------------------------
     * CIFRAR
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


    /*
     * --------------------------------------------------------
     * ID
     * --------------------------------------------------------
     */

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
      )}-position-${normalizedPosition}.${extension}`;


    const expiresAt =
      getExpirationDate(
        this.retentionDays
      );


    /*
     * --------------------------------------------------------
     * METADADOS
     * --------------------------------------------------------
     */

    const metadata = {

      type:
        "travel_automation_liveness_segment",


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


      position:
        normalizedPosition,


      sequence:
        Number.isInteger(
          Number(
            sequence
          )
        )
          ? Number(
              sequence
            )
          : normalizedPosition,


      label:
        label
          ? String(
              label
            ).slice(
              0,
              200
            )
          : null,


      instruction:
        instruction
          ? String(
              instruction
            ).slice(
              0,
              300
            )
          : null,


      score:
        Number.isFinite(
          Number(
            score
          )
        )
          ? Number(
              score
            )
          : null,


      positionScore:
        Number.isFinite(
          Number(
            positionScore
          )
        )
          ? Number(
              positionScore
            )
          : null,


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
    };


    /*
     * --------------------------------------------------------
     * GRIDFS
     * --------------------------------------------------------
     */

    const bucket =
      getBucket();


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

              metadata
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
     * RESULTADO
     * --------------------------------------------------------
     */

    return {

      videoId:
        fileId.toString(),


      clientId:
        String(
          clientId
        ),


      sessionId:
        String(
          sessionId
        ),


      position:
        normalizedPosition,


      sequence:
        metadata.sequence,


      label:
        metadata.label,


      instruction:
        metadata.instruction,


      score:
        metadata.score,


      positionScore:
        metadata.positionScore,


      mimeType:
        normalizedMime,


      originalSize:
        buffer.length,


      storedSize:
        encryptedBuffer.length,


      uploadedAt:
        new Date(),


      expiresAt,


      bucket:
        BUCKET_NAME
    };
  }


  /*
   * ==========================================================
   * LER UM SEGMENTO
   * ==========================================================
   */

  async get({
    accountId,
    clientId,
    sessionId,
    position,
    videoId
  }) {

    const bucket =
      getBucket();


    let file =
      null;


    /*
     * --------------------------------------------------------
     * POR VIDEO ID
     * --------------------------------------------------------
     */

    if (
      videoId &&
      mongoose.isValidObjectId(
        videoId
      )
    ) {

      const files =
        await bucket
          .find({
            _id:
              new mongoose.Types.ObjectId(
                videoId
              ),

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
          .limit(1)
          .toArray();


      file =
        files[0] ||
        null;

    } else {

      file =
        await this.find({
          accountId,
          clientId,
          sessionId,
          position
        });
    }


    if (!file) {
      return null;
    }


    /*
     * --------------------------------------------------------
     * EXPIRAÇÃO
     * --------------------------------------------------------
     */

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


    /*
     * --------------------------------------------------------
     * DOWNLOAD GRIDFS
     * --------------------------------------------------------
     */

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
        "O segmento de vídeo de liveness armazenado está vazio."
      );
    }


    /*
     * --------------------------------------------------------
     * DESENCRIPTAR
     * --------------------------------------------------------
     */

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
        "Não foi possível desencriptar o segmento de vídeo de liveness."
      );
    }


    /*
     * --------------------------------------------------------
     * RESULTADO
     * --------------------------------------------------------
     */

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


      clientId:
        file?.metadata
          ?.clientId ||
        String(
          clientId
        ),


      sessionId:
        file?.metadata
          ?.sessionId ||
        String(
          sessionId
        ),


      position:
        normalizePosition(
          file?.metadata
            ?.position
        ),


      sequence:
        Number(
          file?.metadata
            ?.sequence ||
            file?.metadata
              ?.position ||
            0
        ),


      label:
        file?.metadata
          ?.label ||
        null,


      instruction:
        file?.metadata
          ?.instruction ||
        null,


      score:
        Number.isFinite(
          Number(
            file?.metadata
              ?.score
          )
        )
          ? Number(
              file.metadata.score
            )
          : null,


      positionScore:
        Number.isFinite(
          Number(
            file?.metadata
              ?.positionScore
          )
        )
          ? Number(
              file.metadata
                .positionScore
            )
          : null,


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
   * LER TODOS OS SEGMENTOS
   * ==========================================================
   *
   * Retorna apenas as posições que realmente foram guardadas.
   * Tentativas erradas nunca entram aqui porque não são
   * armazenadas.
   * ==========================================================
   */

  async getAll({
    accountId,
    clientId,
    sessionId
  }) {

    const files =
      await this.findAll({
        accountId,
        clientId,
        sessionId
      });


    const result =
      [];


    for (
      const file
      of files
    ) {

      const position =
        normalizePosition(
          file?.metadata
            ?.position
        );


      if (
        !position
      ) {
        continue;
      }


      const video =
        await this.get({
          accountId,
          clientId,
          sessionId,
          position
        });


      if (
        video
      ) {
        result.push(
          video
        );
      }
    }


    return result.sort(
      (
        first,
        second
      ) =>
        Number(
          first.position
        ) -
        Number(
          second.position
        )
    );
  }


  /*
   * ==========================================================
   * APAGAR SESSÃO
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
      await this.findAll({
        accountId,
        clientId,
        sessionId
      });


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


        deleted +=
          1;

      } catch (
        error
      ) {

        console.warn(
          "[LivenessVideoStorage] Falha ao apagar segmento:",
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
   * LIMPEZA DE EXPIRADOS
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


        deleted +=
          1;

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
