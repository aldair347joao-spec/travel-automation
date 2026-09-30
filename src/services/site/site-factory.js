"use strict";

const logger =
  require("../../utils/logger");

const MockSiteAdapter =
  require("./mock-site-adapter");

let PuppeteerSiteAdapter = null;
let puppeteerAdapterLoadError = null;

try {
  PuppeteerSiteAdapter =
    require(
      "./vfs-puppeteer-adapter"
    );
} catch (error) {
  puppeteerAdapterLoadError =
    error;

  logger.error(
    "Failed to load VFS Puppeteer adapter",
    {
      error:
        error?.message ||
        String(error),

      code:
        error?.code ||
        null,

      stack:
        error?.stack ||
        null
    }
  );
}


function createSiteAdapter(
  applicationId
) {

  const adapterName =
    (
      process.env.SITE_ADAPTER ||
      "mock"
    )
      .trim()
      .toLowerCase();


  /*
   * ==========================================================
   * MOCK
   * ==========================================================
   *
   * Mantemos o adapter mock exatamente como fallback explícito.
   */

  if (
    adapterName ===
    "mock"
  ) {

    const adapter =
      new MockSiteAdapter();

    adapter.applicationId =
      applicationId;

    return adapter;
  }


  /*
   * ==========================================================
   * VFS / PUPPETEER
   * ==========================================================
   */

  if (
    adapterName === "vfs" ||
    adapterName === "puppeteer"
  ) {

    if (
      !PuppeteerSiteAdapter
    ) {

      const originalError =
        puppeteerAdapterLoadError;

      const message =
        originalError?.message ||
        String(
          originalError ||
          "unknown adapter loading error"
        );

      const error =
        new Error(
          `VFS Puppeteer adapter could not be loaded: ${message}`
        );

      error.code =
        "VFS_PUPPETEER_ADAPTER_LOAD_FAILED";

      error.cause =
        originalError ||
        null;

      logger.error(
        "VFS Puppeteer adapter unavailable",
        {
          applicationId,

          error:
            message,

          code:
            originalError?.code ||
            null
        }
      );

      throw error;
    }


    return new PuppeteerSiteAdapter({
      applicationId
    });
  }


  /*
   * ==========================================================
   * INVALID CONFIGURATION
   * ==========================================================
   */

  throw new Error(
    `Site adapter "${adapterName}" is not configured`
  );
}


module.exports = {
  createSiteAdapter
};
