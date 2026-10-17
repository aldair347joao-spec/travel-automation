
"use strict";

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_INTERVAL_MS = 5000;

class VfsHttpRadar {
  constructor() {
    this.enabled =
      String(
        process.env.VFS_RADAR_HTTP_ENABLED || "false"
      ).toLowerCase() === "true";

    this.endpoint =
      process.env.VFS_RADAR_HTTP_URL || "";

    this.timeoutMs =
      Math.max(
        3000,
        Number(process.env.VFS_RADAR_HTTP_TIMEOUT_MS) ||
          DEFAULT_TIMEOUT_MS
      );

    this.lastRequestAt = 0;
  }

  validateConfiguration() {
    if (!this.enabled) {
      throw new Error(
        "HTTP radar disabled: set VFS_RADAR_HTTP_ENABLED=true after configuration."
      );
    }

    if (!this.endpoint) {
      throw new Error(
        "HTTP radar endpoint is not configured."
      );
    }

    const url = new URL(this.endpoint);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "lift-api.vfsglobal.com"
    ) {
      throw new Error(
        "HTTP radar only accepts the configured HTTPS VFS API host."
      );
    }

    if (
      !process.env.VFS_RADAR_HTTP_BODY_JSON ||
      !process.env.VFS_RADAR_HTTP_HEADERS_JSON
    ) {
      throw new Error(
        "HTTP radar request body and authorized headers must be configured."
      );
    }

    return true;
  }

  async checkAvailability() {
    this.validateConfiguration();

    const elapsed =
      Date.now() - this.lastRequestAt;

    if (elapsed < MIN_INTERVAL_MS) {
      throw new Error(
        "HTTP radar rate limit: wait before the next request."
      );
    }

    let headers;
    let body;

    try {
      headers = JSON.parse(
        process.env.VFS_RADAR_HTTP_HEADERS_JSON
      );

      body = JSON.parse(
        process.env.VFS_RADAR_HTTP_BODY_JSON
      );
    } catch {
      throw new Error(
        "HTTP radar headers or body contain invalid JSON."
      );
    }

    if (
      !headers ||
      typeof headers !== "object" ||
      Array.isArray(headers) ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new Error(
        "HTTP radar requires JSON objects for headers and body."
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    this.lastRequestAt = Date.now();

    try {
      const response = await fetch(
        this.endpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers
          },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );

      if ([401, 403, 429].includes(response.status)) {
        return {
          resultStatus: "unknown",
          slots: [],
          httpStatus: response.status,
          requiresUser: response.status !== 429,
          retryAllowed: false
        };
      }

      if (!response.ok) {
        throw new Error(
          `VFS HTTP radar returned HTTP ${response.status}.`
        );
      }

      const data = await response.json();

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        throw new Error(
          "VFS HTTP radar returned an unexpected response."
        );
      }

      return {
        resultStatus: "unverified",
        slots: [],
        rawResponse: data,
        httpStatus: response.status
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = VfsHttpRadar;
