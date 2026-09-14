const crypto = require("crypto");

const PassportDocument = require(
  "../../models/passport-document"
);

const {
  encrypt,
  decrypt
} = require("../../utils/crypto");

const MAX_STORAGE_BYTES =
  Number(
    process.env.PASSPORT_MAX_STORAGE_BYTES
  ) ||
  6 * 1024 * 1024;

const RETENTION_DAYS =
  Number(
    process.env.PASSPORT_STORAGE_RETENTION_DAYS
  ) ||
  30;

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function encryptBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError(
      "Passport document must be a Buffer"
    );
  }

  /*
   * O crypto.js existente trabalha com strings.
   *
   * Aqui transformamos o binário em base64 antes
   * da criptografia. O resultado continua protegido
   * por AES-256-GCM.
   */
  return encrypt(
    buffer.toString("base64")
  );
}

function decryptBuffer(encryptedValue) {
  const base64 =
    decrypt(encryptedValue);

  if (!base64) {
    return null;
  }

  return Buffer.from(
    base64,
    "base64"
  );
}

class PassportStorageService {
  constructor() {
    this.maxBytes =
      MAX_STORAGE_BYTES;

    this.retentionDays =
      RETENTION_DAYS;
  }

  getExpirationDate() {
    const expires =
      new Date();

    expires.setDate(
      expires.getDate() +
        this.retentionDays
    );

    return expires;
  }

  validateInput({
    buffer,
    mimeType
  }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(
        "Passport document must be a Buffer"
      );
    }

    if (!buffer.length) {
      throw new Error(
        "Passport document is empty"
      );
    }

    if (
      buffer.length >
      this.maxBytes
    ) {
      throw new Error(
        `Passport document exceeds the ${Math.round(
          this.maxBytes / 1024 / 1024
        )} MB limit`
      );
    }

    if (
      ![
        "image/jpeg",
        "image/png"
      ].includes(mimeType)
    ) {
      throw new Error(
        "Only JPEG and PNG passport images are supported"
      );
    }
  }

  async save({
    accountId,
    clientId,
    buffer,
    mimeType,
    originalName,
    validationStatus = "pending"
  }) {
    this.validateInput({
      buffer,
      mimeType
    });

    const fingerprint =
      sha256(buffer);

    /*
     * Evita manter várias cópias idênticas
     * do mesmo passaporte para o mesmo cliente.
     */
    const existing =
      await PassportDocument.findOne({
        accountId,
        clientId,
        sha256:
          fingerprint
      });

    if (existing) {
      existing.validationStatus =
        validationStatus;

      existing.expiresAt =
        this.getExpirationDate();

      await existing.save();

      return {
        document: existing,
        duplicate: true
      };
    }

    const encryptedData =
      encryptBuffer(buffer);

    const document =
      await PassportDocument.create({
        accountId,
        clientId,

        mimeType,

        originalName:
          String(
            originalName ||
              "passport"
          )
            .slice(0, 255),

        size:
          buffer.length,

        sha256:
          fingerprint,

        encryptedData,

        validationStatus,

        expiresAt:
          this.getExpirationDate()
      });

    return {
      document,
      duplicate: false
    };
  }

  async getForBot({
    accountId,
    clientId
  }) {
    const document =
      await PassportDocument.findOne({
        accountId,
        clientId,
        validationStatus:
          "passed"
      })
        .sort({
          createdAt: -1
        });

    if (!document) {
      return null;
    }

    if (
      document.expiresAt &&
      document.expiresAt.getTime() <
        Date.now()
    ) {
      return null;
    }

    const buffer =
      decryptBuffer(
        document.encryptedData
      );

    if (!buffer) {
      throw new Error(
        "Unable to decrypt passport document"
      );
    }

    document.usedByBotAt =
      new Date();

    await document.save();

    return {
      buffer,

      mimeType:
        document.mimeType,

      originalName:
        document.originalName,

      sha256:
        document.sha256,

      documentId:
        document._id.toString()
    };
  }

  async deleteForClient({
    accountId,
    clientId
  }) {
    await PassportDocument.deleteMany({
      accountId,
      clientId
    });
  }

  async cleanupExpired() {
    const result =
      await PassportDocument.deleteMany({
        expiresAt: {
          $ne: null,
          $lt: new Date()
        }
      });

    return {
      deleted:
        result.deletedCount || 0
    };
  }
}

module.exports =
  PassportStorageService;
