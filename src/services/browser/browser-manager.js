const puppeteer = require("puppeteer");
const crypto = require("crypto");

const logger = require("../../utils/logger");

const DEFAULT_TIMEOUT =
  Math.max(
    10000,
    Number(
      process.env.VFS_NAVIGATION_TIMEOUT_MS
    ) || 45000
  );

const HEADLESS =
  String(
    process.env.PUPPETEER_HEADLESS || "true"
  ).toLowerCase() !== "false";

class BrowserManager {
  constructor() {
    this.sessions = new Map();
  }

  async createSession(applicationId) {
    const id = String(applicationId);

    const existing = this.sessions.get(id);

    if (existing) {
      return existing;
    }

    const browser = await puppeteer.launch({
      headless: HEADLESS ? "new" : false,

      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding"
      ]
    });

    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(
      DEFAULT_TIMEOUT
    );

    page.setDefaultTimeout(
      DEFAULT_TIMEOUT
    );

    const session = {
      id: crypto.randomUUID(),
      applicationId: id,
      browser,
      page,
      createdAt: new Date(),
      lastActivityAt: new Date()
    };

    this.sessions.set(id, session);

    logger.info(
      "Browser session created",
      {
        applicationId: id,
        sessionId: session.id
      }
    );

    return session;
  }

  async getSession(applicationId) {
    const id = String(applicationId);

    const existing =
      this.sessions.get(id);

    if (
      existing &&
      existing.browser &&
      existing.browser.connected
    ) {
      existing.lastActivityAt =
        new Date();

      return existing;
    }

    if (existing) {
      await this.closeSession(id);
    }

    return this.createSession(id);
  }

  async closeSession(applicationId) {
    const id = String(applicationId);

    const session =
      this.sessions.get(id);

    if (!session) {
      return;
    }

    this.sessions.delete(id);

    try {
      if (
        session.browser &&
        session.browser.connected
      ) {
        await session.browser.close();
      }
    } catch (error) {
      logger.warn(
        "Failed to close browser session",
        {
          applicationId: id,
          error: error.message
        }
      );
    }
  }

  async closeAll() {
    const ids = [
      ...this.sessions.keys()
    ];

    for (const id of ids) {
      await this.closeSession(id);
    }
  }

  async navigate(
    applicationId,
    url,
    options = {}
  ) {
    const session =
      await this.getSession(
        applicationId
      );

    const page =
      session.page;

    session.lastActivityAt =
      new Date();

    const response =
      await page.goto(
        url,
        {
          waitUntil:
            options.waitUntil ||
            "domcontentloaded",

          timeout:
            options.timeout ||
            DEFAULT_TIMEOUT
        }
      );

    session.lastActivityAt =
      new Date();

    return {
      status:
        response?.status?.() ||
        null,

      url:
        page.url(),

      sessionId:
        session.id
    };
  }

  async screenshot(
    applicationId,
    options = {}
  ) {
    const session =
      await this.getSession(
        applicationId
      );

    const buffer =
      await session.page.screenshot(
        {
          type:
            options.type ||
            "png",

          fullPage:
            options.fullPage !== false
        }
      );

    session.lastActivityAt =
      new Date();

    return buffer;
  }

  async getPage(applicationId) {
    const session =
      await this.getSession(
        applicationId
      );

    session.lastActivityAt =
      new Date();

    return session.page;
  }

  status() {
    return {
      sessions:
        [...this.sessions.values()]
          .map(session => ({
            applicationId:
              session.applicationId,

            sessionId:
              session.id,

            createdAt:
              session.createdAt,

            lastActivityAt:
              session.lastActivityAt,

            connected:
              Boolean(
                session.browser?.connected
              )
          }))
    };
  }
}

module.exports =
  BrowserManager;
