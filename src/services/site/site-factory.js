const MockSiteAdapter =
  require("./mock-site-adapter");

let PuppeteerSiteAdapter = null;

try {
  PuppeteerSiteAdapter =
    require(
      "./vfs-puppeteer-adapter"
    );
} catch {
  PuppeteerSiteAdapter =
    null;
}

function createSiteAdapter(
  applicationId
) {
  const adapterName =
    (
      process.env.SITE_ADAPTER ||
      "mock"
    ).toLowerCase();

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

  if (
    adapterName ===
      "vfs" ||
    adapterName ===
      "puppeteer"
  ) {
    if (
      !PuppeteerSiteAdapter
    ) {
      throw new Error(
        "VFS Puppeteer adapter is not available. Run npm install first."
      );
    }

    return new PuppeteerSiteAdapter({
      applicationId
    });
  }

  throw new Error(
    `Site adapter "${adapterName}" is not configured`
  );
}

module.exports = {
  createSiteAdapter
};
