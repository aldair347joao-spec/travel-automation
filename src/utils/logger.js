function sanitizeMetadata(metadata = {}) {
  const blocked = new Set([
    "password",
    "passwordHash",
    "token",
    "accessToken",
    "refreshToken",
    "authorization",
    "cookie",
    "otp",
    "code",
    "apiKey",
    "secret"
  ]);

  const output = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.has(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = value;
  }

  return output;
}

function write(level, message, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata: sanitizeMetadata(metadata)
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function info(message, metadata) {
  write("info", message, metadata);
}

function warn(message, metadata) {
  write("warn", message, metadata);
}

function error(message, metadata) {
  write("error", message, metadata);
}

module.exports = {
  info,
  warn,
  error
};
