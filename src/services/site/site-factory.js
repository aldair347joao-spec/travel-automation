
"use strict";

const logger = require("../../utils/logger");

const isProduction =
  String(process.env.NODE_ENV || "")
    .trim()
    .toLowerCase() === "production";

const adapterName = String(
  process.env.SITE_ADAPTER ||
    (isProduction ? "vfs" : "mock")
)
  .trim()
  .toLowerCase();

let VfsSiteAdapter = null;
let vfsAdapterLoadError = null;

if (isProduction && adapterName !== "vfs") {
  const error = new Error(
    `Production requires SITE_ADAPTER=vfs; received "${adapterName}".`
  );

  error.code = "PRODUCTION_REQUIRES_VFS";
  logger.error("Invalid production browser configuration", {
    adapterName,
    requiredAdapter: "vfs"
  });

  throw error;
}

if (adapterName === "vfs" || (!isProduction && adapterName === "puppeteer")) {
  try {
    VfsSiteAdapter = require("./vfs-puppeteer-adapter");

    logger.info("VFS SITE ADAPTER MODULE LOADED", {
      provider: "Scrapeless Agent Browser",
      browserEngine: "playwright-core",
      production: isProduction
    });
  } catch (error) {
    vfsAdapterLoadError = error;

    logger.error("VFS SITE ADAPTER MODULE LOAD FAILED", {
      error: error?.message || String(error),
      code: error?.code || null
    });

    if (isProduction) {
      throw error;
    }
  }
}

function createSiteAdapter(applicationId) {
  if (adapterName === "vfs" || (!isProduction && adapterName === "puppeteer")) {
    if (!VfsSiteAdapter) {
      const error = new Error(
        `VFS adapter unavailable: ${
          vfsAdapterLoadError?.message || "module failed to load"
        }`
      );

      error.code = "VFS_ADAPTER_LOAD_FAILED";
      throw error;
    }

    logger.info("VFS SITE ADAPTER CREATED", {
      applicationId: String(applicationId),
      provider: "Scrapeless Agent Browser"
    });

    return new VfsSiteAdapter({
      applicationId: String(applicationId)
    });
  }

  if (!isProduction && adapterName === "mock") {
    const MockSiteAdapter = require("./mock-site-adapter");
    const adapter = new MockSiteAdapter();

    adapter.applicationId = String(applicationId);

    logger.warn("DEVELOPMENT MOCK ADAPTER CREATED", {
      applicationId: String(applicationId)
    });

    return adapter;
  }

  throw new Error(
    `Site adapter "${adapterName}" is not permitted in this environment`
  );
}

module.exports = {
  createSiteAdapter
};
