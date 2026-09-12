const MockSiteAdapter =
  require("./mock-site-adapter");

function createSiteAdapter(applicationId) {
  const adapterName =
    (
      process.env.SITE_ADAPTER ||
      "mock"
    ).toLowerCase();

  if (adapterName === "mock") {
    const adapter =
      new MockSiteAdapter();

    adapter.applicationId =
      applicationId;

    return adapter;
  }

  throw new Error(
    `Site adapter "${adapterName}" is not configured`
  );
}

module.exports = {
  createSiteAdapter
};
