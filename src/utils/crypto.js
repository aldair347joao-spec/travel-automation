const crypto =
  require("crypto");

const algorithm =
  "aes-256-gcm";

function getKey() {
  const raw =
    process.env.DATA_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not configured"
    );
  }

  return crypto
    .createHash("sha256")
    .update(raw)
    .digest();
}

function encrypt(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const iv =
    crypto.randomBytes(12);

  const cipher =
    crypto.createCipheriv(
      algorithm,
      getKey(),
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        String(value),
        "utf8"
      ),
      cipher.final()
    ]);

  const authTag =
    cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

function decrypt(value) {
  if (!value) {
    return null;
  }

  const parts =
    String(value).split(".");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted value"
    );
  }

  const [
    ivBase64,
    authTagBase64,
    encryptedBase64
  ] = parts;

  const decipher =
    crypto.createDecipheriv(
      algorithm,
      getKey(),
      Buffer.from(
        ivBase64,
        "base64"
      )
    );

  decipher.setAuthTag(
    Buffer.from(
      authTagBase64,
      "base64"
    )
  );

  const decrypted =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedBase64,
          "base64"
        )
      ),
      decipher.final()
    ]);

  return decrypted.toString(
    "utf8"
  );
}

function encryptJson(value) {
  return encrypt(
    JSON.stringify(value)
  );
}

function decryptJson(value) {
  if (!value) {
    return null;
  }

  return JSON.parse(
    decrypt(value)
  );
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

module.exports = {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  hash
};
