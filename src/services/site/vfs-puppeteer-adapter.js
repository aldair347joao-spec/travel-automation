"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const chromium = require("@sparticuz/chromium");

const {
  getCredentialsForAutomation,
  markAutomationActive
} = require("../admin/admin-control-service");

const {
  convert,
  prepareCameraCapture,
  prepareFromBuffer
} = require("../facial/liveness-y4m-service");
const LivenessVideoStorageService =
  require("../facial/liveness-video-storage-service");

const livenessVideoStorageService =
  new LivenessVideoStorageService();
const SiteAdapter = require("./site-adapter");
const VfsDomInspector = require("./vfs-dom-inspector");
const logger = require("../../utils/logger");
/*
 * ============================================================
 * LOCK GLOBAL DO CHROMIUM
 * ============================================================
 *
 * O @sparticuz/chromium usa um executável extraído em /tmp.
 *
 * Bot1 e Bot2 podem pedir um navegador praticamente ao mesmo
 * tempo. Se ambos tentarem inicializar o mesmo executável,
 * o Linux pode responder:
 *
 *     spawn ETXTBSY
 *
 * Mantemos uma fila global no processo Node para garantir que
 * somente uma inicialização Chromium aconteça de cada vez.
 */

let chromiumLaunchLock = Promise.resolve();

async function acquireChromiumLaunchLock() {
  const previousLock =
    chromiumLaunchLock;

  let releaseLock;

  chromiumLaunchLock =
    new Promise(resolve => {
      releaseLock = resolve;
    });

  await previousLock;

  return releaseLock;
}
const VFS_BASE_URL =
  process.env.VFS_BASE_URL ||
  "https://visa.vfsglobal.com/ago/en/prt";

const DEFAULT_TIMEOUT =
  Number(process.env.VFS_NAVIGATION_TIMEOUT_MS) || 45000;

const MAX_PASSPORT_BYTES =
  2 * 1024 * 1024;

const CHECKPOINT_TERMS = {
  captcha: [
    "captcha",
    "recaptcha",
    "i'm not a robot",
    "im not a robot",
    "security verification",
    "verify you are human"
  ],

  otp: [
    "otp",
    "one time password",
    "one-time password",
    "verification code",
    "verification otp",
    "security code"
  ],

  passport: [
    "passport",
    "passport copy",
    "passport document",
    "travel document"
  ],

  facial: [
    "facial",
    "face verification",
    "facial verification",
    "facial recognition",
    "liveness",
    "selfie"
  ],

  confirmation: [
    "appointment confirmed",
    "appointment confirmation",
    "booking confirmed",
    "booking confirmation"
  ]
};

class VfsPuppeteerAdapter extends SiteAdapter {
  constructor({ applicationId }) {
    super();

    this.applicationId =
      applicationId;

    this.browser = null;
    this.context = null;
    this.page = null;
    this.activeCameraY4mPath = null;
this.activeCameraVideoId = null;
this.activeCameraPosition = null;

/*
 * ============================================================
 * SESSÃO FACIAL VFS
 * ============================================================
 *
 * A VFS abre a câmera uma única vez.
 *
 * Depois disso:
 *
 * câmera aberta
 *      ↓
 * instrução textual VFS
 *      ↓
 * posição armazenada correspondente
 *      ↓
 * vídeo da posição
 *      ↓
 * aceitação da VFS
 *      ↓
 * próxima instrução
 *
 * Não assumimos uma quantidade fixa de posições.
 */

this.facialSession = {
  active: false,

  cameraRequested: false,
  cameraOpened: false,

  currentRequest: null,
  currentPosition: null,

  requestedPositions: [],
  acceptedPositions: [],

  pendingPosition: null,

  startedAt: null,
  lastRequestAt: null,
  lastAcceptedAt: null,

  completed: false,
    /*
   * ============================================================
   * STREAM PERSISTENTE DA SESSÃO
   * ============================================================
   *
   * A câmera lógica permanece aberta durante toda a etapa
   * facial. O conteúdo apresentado pode mudar sem criar uma
   * nova chamada getUserMedia().
   */

  streamReady: false,
  streamId: null,

  canvasReady: false,
  canvasWidth: 640,
  canvasHeight: 480,
  canvasFps: 30,

  sourcePosition: null,
  sourceVideoId: null,

  sourceLoaded: false,
  sourcePlaying: false,

  switchInProgress: false,
  switchStartedAt: null,
  switchCompletedAt: null,

  videoElementReady: false,
  lastFrameAt: null
};

    this.initialized = false;
    this.state = "UNKNOWN";

    this.domInspector =
      new VfsDomInspector({
        applicationId:
          this.applicationId
      });

    this.lastDomInspection = null;
    this.lastCheckpoint = null;
    this.lastSlotSnapshot = [];
  }

  /*
   * ============================================================
   * BROWSER
   * ============================================================
   */
  async initialize() {
  if (
    this.initialized &&
    this.page
  ) {
    return true;
  }

  const proxyHost =
    String(
      process.env.VFS_PROXY_HOST || ""
    ).trim();

  const proxyPort =
    String(
      process.env.VFS_PROXY_PORT || ""
    ).trim();

  const proxyUsername =
    String(
      process.env.VFS_PROXY_USERNAME || ""
    ).trim();

  const proxyPassword =
    String(
      process.env.VFS_PROXY_PASSWORD || ""
    ).trim();

  const proxyConfigured =
    Boolean(
      proxyHost &&
      proxyPort
    );

  /*
   * ============================================================
   * CHROMIUM
   * ============================================================
   */

   /*
 * ============================================================
 * INICIALIZAÇÃO SERIALIZADA DO CHROMIUM
 * ============================================================
 *
 * IMPORTANTE:
 *
 * A resolução do executável e o launch ficam dentro do mesmo
 * lock. Isso evita que Bot1 e Bot2 disputem simultaneamente
 * o /tmp/chromium.
 */

const releaseChromiumLaunchLock =
  await acquireChromiumLaunchLock();

try {
  let executablePath;

  /*
   * ==========================================================
   * RESOLVER EXECUTÁVEL
   * ==========================================================
   */

  try {
    executablePath =
      await chromium.executablePath();

    const executableExists =
      Boolean(
        executablePath &&
        fs.existsSync(
          executablePath
        )
      );

    logger.info(
      "Chromium executable resolved",
      {
        applicationId:
          this.applicationId,

        executablePath,

        exists:
          executableExists
      }
    );

    if (!executableExists) {
      const error =
        new Error(
          `Chromium executable not found: ${
            executablePath || "unknown"
          }`
        );

      error.code =
        "CHROMIUM_EXECUTABLE_NOT_FOUND";

      throw error;
    }
  } catch (error) {
    logger.error(
      "Could not resolve Chromium executable",
      {
        applicationId:
          this.applicationId,

        error:
          error?.message ||
          String(error)
      }
    );

    throw error;
  }

  /*
   * ==========================================================
   * ARGUMENTOS DO CHROMIUM
   * ==========================================================
   */

  const chromiumArgs =
    Array.isArray(
      chromium.args
    )
      ? chromium.args
      : [];

  if (
    proxyConfigured
  ) {
    chromiumArgs.push(
      `--proxy-server=http://${proxyHost}:${proxyPort}`
    );
  }

  const browserArgs =
    await puppeteer.defaultArgs({
      args: chromiumArgs,
      headless: "shell"
    });

  const requiredArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-zygote",

    /*
     * MediaStream / câmera
     */
    "--enable-media-stream",

    /*
     * Permitir acesso aos dispositivos de mídia.
     */
    "--use-fake-ui-for-media-stream"
  ];

  const finalArgs = [
    ...new Set([
      ...browserArgs,
      ...requiredArgs,

      /*
       * ======================================================
       * CÂMERA SIMULADA VFS — FLUXO AUTORIZADO
       * ======================================================
       */
      ...(this.activeCameraY4mPath
        ? [
            `--use-file-for-fake-video-capture=${this.activeCameraY4mPath}`
          ]
        : [])
    ])
  ];

  logger.info(
    "Launching Chromium",
    {
      applicationId:
        this.applicationId,

      headless:
        "shell",

      argsCount:
        finalArgs.length,

      proxyConfigured
    }
  );

  /*
   * ==========================================================
   * LAUNCH
   * ==========================================================
   */

  let launchAttempts = 0;

  const maxLaunchAttempts = 4;

  while (
    !this.browser &&
    launchAttempts < maxLaunchAttempts
  ) {
    launchAttempts += 1;

    try {
      logger.info(
        "Chromium launch attempt",
        {
          applicationId:
            this.applicationId,

          attempt:
            launchAttempts,

          maxAttempts:
            maxLaunchAttempts,

          executablePath
        }
      );

      this.browser =
        await puppeteer.launch({
          executablePath,

          headless:
            "shell",

          args:
            finalArgs,

          defaultViewport:
            chromium.defaultViewport || {
              width: 1440,
              height: 900
            },

          timeout:
            60000,

          handleSIGINT:
            false,

          handleSIGTERM:
            false,

          handleSIGHUP:
            false
        });

      logger.info(
        "Chromium launched successfully",
        {
          applicationId:
            this.applicationId,

          attempt:
            launchAttempts,

          executablePath
        }
      );

    } catch (error) {

      const errorMessage =
        error?.message ||
        String(error);

      const isEtxtbsy =
        error?.code === "ETXTBSY" ||
        errorMessage.includes(
          "ETXTBSY"
        );

      logger.error(
        "Chromium launch failed",
        {
          applicationId:
            this.applicationId,

          attempt:
            launchAttempts,

          maxAttempts:
            maxLaunchAttempts,

          executablePath,

          code:
            error?.code || null,

          error:
            errorMessage,

          retryable:
            isEtxtbsy
        }
      );

      if (!isEtxtbsy) {
        throw error;
      }

      if (
        launchAttempts >=
        maxLaunchAttempts
      ) {
        logger.error(
          "Chromium launch exhausted after ETXTBSY retries",
          {
            applicationId:
              this.applicationId,

            attempts:
              launchAttempts,

            executablePath
          }
        );

        throw error;
      }

      const retryDelay =
        1500 * launchAttempts;

      logger.warn(
        "Chromium launch retry scheduled",
        {
          applicationId:
            this.applicationId,

          attempt:
            launchAttempts + 1,

          delayMs:
            retryDelay,

          reason:
            "ETXTBSY"
        }
      );

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            retryDelay
          )
      );
    }
  }

  /*
   * Se chegou aqui, o browser precisa existir.
   */
  if (!this.browser) {
    const error =
      new Error(
        "Chromium launch finished without a browser instance."
      );

    error.code =
      "CHROMIUM_BROWSER_NOT_CREATED";

    throw error;
  }

} finally {

  /*
   * ==========================================================
   * LIBERAR LOCK
   * ==========================================================
   */

  releaseChromiumLaunchLock();
}
try {
  const pages =
    await this.browser.pages();

  this.page =
    pages.length > 0
      ? pages[0]
      : await this.browser.newPage();
    this.browser =
      await puppeteer.launch({
        executablePath,

        headless:
          "shell",

        args:
          finalArgs,

        defaultViewport:
          chromium.defaultViewport || {
            width: 1440,
            height: 900
          },

        timeout:
          60000,

        handleSIGINT:
          false,

        handleSIGTERM:
          false,

        handleSIGHUP:
          false
      });

    logger.info(
      "Chromium launched successfully",
      {
        applicationId:
          this.applicationId,

        attempt:
          launchAttempts,

        executablePath
      }
    );

  } catch (error) {

    const errorMessage =
      error?.message ||
      String(error);

    const isEtxtbsy =
      error?.code === "ETXTBSY" ||
      errorMessage.includes(
        "ETXTBSY"
      );

    logger.error(
      "Chromium launch failed",
      {
        applicationId:
          this.applicationId,

        attempt:
          launchAttempts,

        maxAttempts:
          maxLaunchAttempts,

        executablePath,

        code:
          error?.code || null,

        error:
          errorMessage,

        retryable:
          isEtxtbsy
      }
    );

    if (!isEtxtbsy) {
      throw error;
    }

    if (
      launchAttempts >=
      maxLaunchAttempts
    ) {
      logger.error(
        "Chromium launch exhausted after ETXTBSY retries",
        {
          applicationId:
            this.applicationId,

          attempts:
            launchAttempts,

          executablePath
        }
      );

      throw error;
    }

    const retryDelay =
      1500 * launchAttempts;

    logger.warn(
      "Chromium launch retry scheduled",
      {
        applicationId:
          this.applicationId,

        attempt:
          launchAttempts + 1,

        delayMs:
          retryDelay,

        reason:
          "ETXTBSY"
      }
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          retryDelay
        )
    );
  }
}

  /*
   * ============================================================
   * PÁGINA PRINCIPAL
   * ============================================================
   *
   * IMPORTANTE:
   *
   * NÃO usamos:
   *
   * this.browser.createBrowserContext()
   *
   * porque @sparticuz/chromium documenta que a criação
   * de um novo BrowserContext pode provocar Target.closed.
   *
   * Usamos diretamente o contexto padrão do navegador.
   */

  try {
    const pages =
      await this.browser.pages();

    this.page =
      pages.length > 0
        ? pages[0]
        : await this.browser.newPage();
    try {
  await this.page.evaluateOnNewDocument(() => {
    window.__travelAutomationMediaState = {
  requested: false,
  opened: false,
  active: false,
  constraints: null,
  requestedAt: null,
  openedAt: null,
  tracks: []
};

if (
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia ===
    "function"
) {
  const original =
    navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );

  /*
   * ============================================================
   * CÂMERA PERSISTENTE VFS
   * ============================================================
   *
   * O VFS chama getUserMedia() uma única vez.
   *
   * A partir daí mantemos o mesmo MediaStream.
   *
   * O conteúdo visual será controlado posteriormente pelo
   * backend através da sessão facial persistente.
   */

  window.__travelAutomationCamera = {
    initialized: false,
    stream: null,

    canvas: null,
    context: null,

    video: null,

    width: 640,
    height: 480,
    fps: 30,

    active: false,
    streamId: null,

    currentPosition: null,
    currentVideoId: null,

    lastFrameAt: null
  };

  window.__travelAutomationMediaState = {
    requested: false,
    opened: false,
    active: false,
    constraints: null,
    requestedAt: null,
    openedAt: null,
    tracks: [],
    error: null
  };

  navigator.mediaDevices.getUserMedia =
    async function (constraints) {
      const mediaState =
        window.__travelAutomationMediaState;

      mediaState.requested = true;
      mediaState.constraints =
        constraints || null;
      mediaState.requestedAt =
        new Date().toISOString();

      /*
       * Se a câmera persistente já foi criada,
       * NÃO chamamos getUserMedia novamente.
       *
       * Isso é fundamental porque o VFS mantém
       * a mesma sessão de câmera durante toda
       * a etapa facial.
       */
      if (
        window.__travelAutomationCamera.initialized &&
        window.__travelAutomationCamera.stream
      ) {
        const stream =
          window.__travelAutomationCamera.stream;

        const tracks =
          typeof stream.getTracks ===
            "function"
            ? stream.getTracks()
            : [];

        const videoTracks =
          tracks.filter(
            track =>
              track &&
              track.kind === "video"
          );

        mediaState.opened =
          videoTracks.length > 0;

        mediaState.active =
          videoTracks.some(
            track =>
              track.readyState === "live"
          );

        mediaState.openedAt =
          mediaState.openedAt ||
          new Date().toISOString();

        mediaState.tracks =
          videoTracks.map(
            track => ({
              id: track.id || null,
              kind: track.kind || null,
              readyState:
                track.readyState || null,
              label:
                track.label || null
            })
          );

        return stream;
      }

      try {
        /*
         * Canvas permanente.
         *
         * Ele será a fonte visual do MediaStream.
         */
        const canvas =
          document.createElement("canvas");

        canvas.width = 640;
        canvas.height = 480;

        const context =
          canvas.getContext("2d", {
            alpha: false
          });

        if (!context) {
          throw new Error(
            "Não foi possível criar o contexto da câmera persistente."
          );
        }

        /*
         * Frame inicial neutro.
         *
         * Posteriormente será substituído
         * pelo vídeo da posição solicitada.
         */
        context.fillStyle = "#000000";
        context.fillRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        /*
         * O stream permanece ligado ao canvas.
         */
        const stream =
          canvas.captureStream(30);

        if (
          !stream ||
          typeof stream.getTracks !==
            "function"
        ) {
          throw new Error(
            "Canvas não produziu um MediaStream válido."
          );
        }

        const videoTracks =
          stream
            .getTracks()
            .filter(
              track =>
                track &&
                track.kind === "video"
            );

        if (!videoTracks.length) {
          throw new Error(
            "O MediaStream persistente não possui faixa de vídeo."
          );
        }

        /*
         * Guardamos tudo globalmente para que o Node
         * possa controlar esta câmera posteriormente.
         */
        window.__travelAutomationCamera = {
          ...window.__travelAutomationCamera,

          initialized: true,
          stream,

          canvas,
          context,

          width: canvas.width,
          height: canvas.height,
          fps: 30,

          active: true,

          streamId:
            videoTracks[0].id || null,

          currentPosition: null,
          currentVideoId: null,

          lastFrameAt:
            new Date().toISOString()
        };

        mediaState.opened = true;
        mediaState.active = true;

        mediaState.openedAt =
          new Date().toISOString();

        mediaState.tracks =
          videoTracks.map(
            track => ({
              id: track.id || null,
              kind: track.kind || null,
              readyState:
                track.readyState || null,
              label:
                track.label ||
                "Travel Automation Persistent Camera"
            })
          );

        return stream;
      } catch (error) {
        mediaState.opened = false;
        mediaState.active = false;

        mediaState.error =
          error?.name ||
          error?.message ||
          "Persistent camera initialization failed";

        throw error;
      }
              };
  }
  });

  logger.info(
    "VFS getUserMedia monitor installed",
    {
      applicationId:
        this.applicationId
    }
  );
} catch (error) {
  logger.warn(
    "Could not install getUserMedia monitor",
    {
      applicationId:
        this.applicationId,

      error:
        error?.message ||
        String(error)
    }
  );
}
  } catch (error) {
    logger.error(
      "Failed to create Chromium page",
      {
        applicationId:
          this.applicationId,

        error:
          error?.message ||
          String(error)
      }
    );

    try {
      await this.browser.close();
    } catch {}

    this.browser =
      null;

    throw error;
  }

  this.context =
    this.page.browserContext();
    /*
 * ============================================================
 * MEDIA PERMISSIONS
 * ============================================================
 */

try {
  const cameraOrigin =
    new URL(VFS_BASE_URL).origin;

  await this.context.overridePermissions(
    cameraOrigin,
    [
      "camera",
      "microphone"
    ]
  );

  logger.info(
    "VFS camera/microphone permissions configured",
    {
      applicationId:
        this.applicationId,

      origin:
        cameraOrigin
    }
  );
} catch (error) {
  logger.warn(
    "Could not configure VFS media permissions",
    {
      applicationId:
        this.applicationId,

      error:
        error?.message ||
        String(error)
    }
  );
}

  /*
   * ============================================================
   * PROXY AUTHENTICATION
   * ============================================================
   */

  if (
    proxyConfigured &&
    proxyUsername &&
    proxyPassword
  ) {
    await this.page.authenticate({
      username:
        proxyUsername,

      password:
        proxyPassword
    });
  }

  /*
   * ============================================================
   * TIMEOUTS
   * ============================================================
   */

  this.page.setDefaultTimeout(
    DEFAULT_TIMEOUT
  );

  this.page.setDefaultNavigationTimeout(
    DEFAULT_TIMEOUT
  );

  /*
   * ============================================================
   * RESIDENTIAL PROXY TEST
   * ============================================================
   */

  if (
    proxyConfigured &&
    process.env.VFS_PROXY_TEST ===
      "true"
  ) {
    try {
      await this.page.goto(
        "https://ipapi.co/json/",
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            DEFAULT_TIMEOUT
        }
      );

      const proxyTestBody =
        await this.page.evaluate(
          () =>
            document.body
              ?.innerText ||
            ""
        );

      logger.info(
        "VFS proxy test completed",
        {
          applicationId:
            this.applicationId,

          response:
            proxyTestBody
        }
      );
    } catch (error) {
      logger.warn(
        "VFS proxy test failed",
        {
          applicationId:
            this.applicationId,

          error:
            error?.message ||
            String(error)
        }
      );
    }
  }

  /*
   * ============================================================
   * FINAL STATE
   * ============================================================
   */

  this.initialized =
    true;

  this.state =
    "INITIALIZED";

  logger.info(
    "VFS Puppeteer adapter initialized with Sparticuz Chromium",
    {
      applicationId:
        this.applicationId,

      executablePath
    }
  );

  return true;
}

  async ensurePage() {
    if (
      !this.initialized ||
      !this.page
    ) {
      await this.initialize();
    }

    if (this.page.isClosed()) {
      await this.close();
      await this.initialize();
    }

    return this.page;
  }

  async navigate(url) {
    const page =
      await this.ensurePage();

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",
        timeout:
          DEFAULT_TIMEOUT
      }
    );

    await page
      .waitForNetworkIdle({
        idleTime: 500,
        timeout: 10000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,
      url:
        page.url(),
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint
    };
  }

  /*
   * ============================================================
   * AUTHENTICATION
   * ============================================================
   *
   * Este adapter NÃO faz bypass de CAPTCHA.
   *
   * Se a VFS apresentar CAPTCHA, o resultado será:
   *
   * CAPTCHA_REQUIRED
   *
   * O fluxo superior decide como aguardar
   * o checkpoint oficial.
   */

  async login(application = null) {
  const page =
    await this.ensurePage();

  const applicationId =
    application?._id?.toString() ||
    this.applicationId;

  if (!applicationId) {
    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      reason:
        "Application ID is required for VFS authentication."
    };
  }

  /*
   * ============================================================
   * ADMIN RELEASE
   * ============================================================
   *
   * As credenciais VFS são obtidas exclusivamente através
   * do controlo administrativo.
   *
   * O adapter nunca procura:
   *
   * VFS_EMAIL
   * VFS_PASSWORD
   *
   * em variáveis globais.
   *
   * Cada aplicação possui as suas próprias credenciais.
   */
  let credentials;

  try {
    credentials =
      await getCredentialsForAutomation(
        applicationId
      );
  } catch (error) {
    logger.warn(
      "VFS automation blocked by administrative control",
      {
        applicationId,
        code:
          error.code || null,
        message:
          error.message
      }
    );

    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      blocked: true,
      code:
        error.code ||
        "ADMIN_RELEASE_REQUIRED",
      reason:
        error.message ||
        "Application is not released for automation."
    };
  }

  if (
    !credentials?.email ||
    !credentials?.password
  ) {
    return {
      success: false,
      authenticated: false,
      requiresUser: true,
      blocked: true,
      code:
        "VFS_CREDENTIALS_REQUIRED",
      reason:
        "VFS credentials are not available."
    };
  }

  const currentUrl =
    page.url();

  /*
   * Se já estamos autenticados, não fazemos
   * novamente o login.
   */
  if (
    this.isAuthenticatedState()
  ) {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS CAPTCHA/security verification is required."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    await markAutomationActive(
      applicationId
    ).catch(() => {});

    return {
      success: true,
      authenticated: true,
      requiresUser: false,
      state:
        this.state,
      applicationId,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * ABRIR LOGIN
   * ============================================================
   */

  if (
    !currentUrl.includes("/login") &&
    !currentUrl.includes("/dashboard") &&
    !currentUrl.includes("/application-detail")
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/dashboard`
    );
  } else {
    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();
  }

  /*
   * Se a navegação já nos colocou numa página
   * autenticada, terminamos aqui.
   */
  if (
    this.isAuthenticatedState()
  ) {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS CAPTCHA/security verification is required."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    await markAutomationActive(
      applicationId
    ).catch(() => {});

    return {
      success: true,
      authenticated: true,
      requiresUser: false,
      state:
        this.state,
      applicationId,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * CAPTCHA
   * ============================================================
   */

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      captchaRequired: true,
      authenticated: false,
      code:
        "CAPTCHA_REQUIRED",
      reason:
        "Official VFS CAPTCHA/security checkpoint is required.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PROCURAR FORMULÁRIO DE LOGIN
   * ============================================================
   */

  const loginForm =
    await this.findVfsLoginFields();
   logger.info(
  "VFS LOGIN FORM DETECTION",
  {
    applicationId:
      applicationId,

    emailFieldFound:
      Boolean(loginForm?.email),

    passwordFieldFound:
      Boolean(loginForm?.password),

    submitFound:
      Boolean(loginForm?.submit),

    url:
      page.url(),

    reason:
      "Verificação dos elementos necessários para iniciar o login."
  }
); 

  if (
    !loginForm?.email ||
    !loginForm?.password
  ) {
    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        captchaRequired: true,
        authenticated: false,
        code:
          "CAPTCHA_REQUIRED",
        reason:
          "Official VFS CAPTCHA/security checkpoint is required.",
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    return {
      success: false,
      requiresUser: true,
      authenticated: false,
      code:
        "VFS_LOGIN_FORM_NOT_FOUND",
      reason:
        "Could not find an unambiguous VFS email/password login form.",
      state:
        this.state,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PREENCHER EMAIL
   * ============================================================
   */

  await page.click(
    loginForm.email
  );

  await page.$eval(
    loginForm.email,
    element => {
      element.focus();
      element.value = "";
    }
  );

  await page.type(
    loginForm.email,
    credentials.email,
    {
      delay: 15
    }
  );

  /*
   * ============================================================
   * PREENCHER PASSWORD
   * ============================================================
   */

  await page.click(
    loginForm.password
  );

  await page.$eval(
    loginForm.password,
    element => {
      element.focus();
      element.value = "";
    }
  );

  await page.type(
    loginForm.password,
    credentials.password,
    {
      delay: 15
    }
  );
    logger.info(
  "VFS LOGIN CREDENTIALS ENTERED",
  {
    applicationId:
      applicationId,

    emailEntered:
      true,

    passwordEntered:
      true,

    url:
      page.url(),

    reason:
      "Os campos de autenticação foram preenchidos. Nenhuma credencial é registrada no log."
  }
);

  /*
   * IMPORTANTE:
   * não registamos email/password nos logs.
   */

  /*
   * ============================================================
   * SUBMETER LOGIN
   * ============================================================
   */

  if (!loginForm.submit) {
    return {
      success: false,
      requiresUser: true,
      authenticated: false,
      code:
        "VFS_LOGIN_SUBMIT_NOT_FOUND",
      reason:
        "Could not find an unambiguous VFS login submit control.",
      state:
        this.state
    };
  }

  logger.info(
  "VFS LOGIN SUBMIT STARTING",
  {
    applicationId:
      applicationId,

    submitSelector:
      loginForm.submit,

    url:
      page.url(),

    reason:
      "Credenciais preenchidas; Bot 1 vai clicar no botão de autenticação da VFS."
  }
);


const [
  navigationResponse
] =
  await Promise.all([
    page
      .waitForNavigation({
        waitUntil:
          "domcontentloaded",
        timeout:
          DEFAULT_TIMEOUT
      })
      .catch(
        () => null
      ),

    page.click(
      loginForm.submit
    )
  ]);


logger.info(
  "VFS LOGIN SUBMIT CLICKED",
  {
    applicationId:
      applicationId,

    urlAfterClick:
      page.url(),

    navigationReceived:
      Boolean(
        navigationResponse
      ),

    reason:
      "O botão de autenticação da VFS foi efetivamente clicado."
  }
);


await page
  .waitForNetworkIdle({
    idleTime: 500,
    timeout: 10000
  })
  .catch(() => {});

  await this.detectState();

  await this.inspectCurrentDom()
    .catch(() => {});

  await this.detectCheckpoint();
    const loginPageSnapshot =
  await page.evaluate(
    () => ({
      url:
        window.location.href,

      title:
        document.title,

      bodyText:
        (
          document.body?.innerText ||
          ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim()
          .slice(
            0,
            2000
          )
    })
  )
  .catch(
    () => ({
      url:
        page.url(),

      title:
        null,

      bodyText:
        ""
    })
  );


logger.info(
  "VFS LOGIN RESPONSE RECEIVED",
  {
    applicationId:
      applicationId,

    state:
      this.state,

    url:
      loginPageSnapshot.url,

    title:
      loginPageSnapshot.title,

    bodyText:
      loginPageSnapshot.bodyText,

    checkpoint:
      this.lastCheckpoint,

    reason:
      "Resultado recebido pela página depois da tentativa de autenticação."
  }
);

  /*
   * ============================================================
   * CHECKPOINTS PÓS-LOGIN
   * ============================================================
   */

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      captchaRequired: true,
      authenticated: false,
      code:
        "CAPTCHA_REQUIRED",
      reason:
        "Official VFS CAPTCHA/security checkpoint is required.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  if (
    this.lastCheckpoint?.type ===
    "OTP_REQUIRED"
  ) {
    return {
      success: false,
      requiresUser: true,
      otpRequired: true,
      authenticated: false,
      code:
        "OTP_REQUIRED",
      reason:
        "VFS OTP checkpoint detected.",
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * RESULTADO
   * ============================================================
   */

  const authenticated =
    this.isAuthenticatedState();

  if (authenticated) {
    await markAutomationActive(
      applicationId
    ).catch(() => {});
  }

  return {
    success:
      authenticated,

    authenticated,

    requiresUser:
      !authenticated,

    reason:
      authenticated
        ? null
        : "VFS authentication was not completed.",

    state:
      this.state,

    applicationId,

    checkpoint:
      this.lastCheckpoint,

    dom:
      this.getDomSummary()
  };
}
  async ensureAuthenticated(
    application
  ) {
    return this.login(
      application
    );
  }
async findVfsLoginFields() {
  const page =
    await this.ensurePage();

  return page.evaluate(() => {
    const normalize = value =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const visible = element => {
      if (!element) {
        return false;
      }

      const style =
        window.getComputedStyle(
          element
        );

      return (
        !element.disabled &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    const descriptor = element => ({
      tag:
        element.tagName
          .toLowerCase(),

      id:
        element.id || null,

      name:
        element.getAttribute(
          "name"
        ) || null,

      type:
        element.getAttribute(
          "type"
        ) || null,

      placeholder:
        element.getAttribute(
          "placeholder"
        ) || null,

      aria:
        element.getAttribute(
          "aria-label"
        ) || null
    });

    const selectorFor =
      element => {
        if (element.id) {
          return `#${CSS.escape(
            element.id
          )}`;
        }

        if (
          element.getAttribute(
            "name"
          )
        ) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(
            element.getAttribute(
              "name"
            )
          )}"]`;
        }

        return null;
      };

    const inputs =
      Array.from(
        document.querySelectorAll(
          "input"
        )
      ).filter(visible);

    const emailCandidates =
      inputs.filter(element => {
        const type =
          normalize(
            element.getAttribute(
              "type"
            )
          );

        const haystack =
          normalize(
            [
              element.getAttribute(
                "name"
              ),
              element.id,
              element.getAttribute(
                "placeholder"
              ),
              element.getAttribute(
                "aria-label"
              ),
              element.getAttribute(
                "autocomplete"
              ),
              element.parentElement
                ?.innerText
            ].join(" ")
          );

        return (
          type === "email" ||
          type === "text" &&
          (
            haystack.includes(
              "email"
            ) ||
            haystack.includes(
              "e-mail"
            ) ||
            haystack.includes(
              "username"
            ) ||
            haystack.includes(
              "user name"
            )
          )
        );
      });

    const passwordCandidates =
      inputs.filter(element => {
        const type =
          normalize(
            element.getAttribute(
              "type"
            )
          );

        const haystack =
          normalize(
            [
              element.getAttribute(
                "name"
              ),
              element.id,
              element.getAttribute(
                "placeholder"
              ),
              element.getAttribute(
                "aria-label"
              ),
              element.getAttribute(
                "autocomplete"
              ),
              element.parentElement
                ?.innerText
            ].join(" ")
          );

        return (
          type === "password" ||
          haystack.includes(
            "password"
          ) ||
          haystack.includes(
            "pass word"
          )
        );
      });

    if (
      emailCandidates.length !== 1 ||
      passwordCandidates.length !== 1
    ) {
      return {
        email: null,
        password: null,
        submit: null,

        emailCandidates:
          emailCandidates.length,

        passwordCandidates:
          passwordCandidates.length
      };
    }

    const email =
      selectorFor(
        emailCandidates[0]
      );

    const password =
      selectorFor(
        passwordCandidates[0]
      );

    if (
      !email ||
      !password
    ) {
      return {
        email: null,
        password: null,
        submit: null
      };
    }

    /*
     * Procurar o botão apenas dentro do
     * formulário que contém os campos.
     */
    const form =
      emailCandidates[0]
        .closest("form") ||
      passwordCandidates[0]
        .closest("form");

    if (!form) {
      return {
        email,
        password,
        submit: null
      };
    }

    const submitCandidates =
      Array.from(
        form.querySelectorAll(
          "button, input[type='submit']"
        )
      ).filter(visible)
       .filter(element => {
          const type =
            normalize(
              element.getAttribute(
                "type"
              )
            );

          const text =
            normalize(
              [
                element.innerText,
                element.value,
                element.getAttribute(
                  "aria-label"
                ),
                element.getAttribute(
                  "title"
                )
              ].join(" ")
            );

          return (
            type === "submit" ||
            text.includes(
              "login"
            ) ||
            text.includes(
              "log in"
            ) ||
            text.includes(
              "sign in"
            ) ||
            text.includes(
              "entrar"
            ) ||
            text.includes(
              "continue"
            )
          );
        });

    /*
     * Só usamos o botão se existir
     * exatamente um candidato.
     */
    let submit = null;

    if (
      submitCandidates.length === 1
    ) {
      submit =
        selectorFor(
          submitCandidates[0]
        );
    }

    return {
      email,
      password,
      submit
    };
  });
}
  isAuthenticatedState() {
    if (
      [
        "DASHBOARD",
        "APPLICATION_DETAIL",
        "YOUR_DETAILS",
        "FACIAL",
        "SERVICES",
        "REVIEW_PAY",
        "BOOK_APPOINTMENT",
        "CONFIRMATION"
      ].includes(this.state)
    ) {
      return true;
    }

    const inspection =
      this.lastDomInspection;

    if (!inspection) {
      return false;
    }

    const bodyText =
      String(
        inspection.bodyText ||
        inspection.text ||
        ""
      ).toLowerCase();

    const hasAuthenticatedNavigation =
      [
        "dashboard",
        "application",
        "appointment",
        "visa application"
      ].some(
        term =>
          bodyText.includes(term)
      );

    const hasLoginForm =
      Boolean(
        inspection.summary?.loginForm ||
        inspection.loginForm
      );

    return (
      hasAuthenticatedNavigation &&
      !hasLoginForm
    );
  }

  /*
   * ============================================================
   * APPLICATION DATA
   * ============================================================
   */

  async fillApplication(
    application,
    client,
    preparedData
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/application-detail`
    );

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    const values =
      this.buildApplicationFieldMap(
        application,
        client,
        preparedData
      );

    const fields = [];

    for (
      const [semantic, value] of
      Object.entries(values)
    ) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        continue;
      }

      const result =
        await this.fillKnownField(
          semantic,
          String(value)
        );

      fields.push({
        semantic,
        ...result
      });
    }

    await this.inspectCurrentDom()
      .catch(() => {});

    return {
      success: true,
      state:
        this.state,

      prepared:
        Boolean(preparedData),

      applicationId:
        application?._id?.toString() ||
        this.applicationId,

      clientId:
        client?._id?.toString() ||
        null,

      fields,

      dom:
        this.getDomSummary()
    };
  }

  buildApplicationFieldMap(
    application,
    client,
    preparedData
  ) {
    const applicant =
      preparedData?.applicants?.[0] ||
      preparedData?.applicant ||
      {};

    return {
      passportNumber:
        applicant.passportNumber ||
        applicant.passport?.number ||
        client?.passportNumber ||
        null,

      firstName:
        applicant.firstName ||
        applicant.givenName ||
        null,

      lastName:
        applicant.lastName ||
        applicant.surname ||
        null,

      fullName:
        applicant.fullName ||
        client?.fullName ||
        null,

      dateOfBirth:
        applicant.dateOfBirth ||
        client?.dateOfBirth ||
        null,

      nationality:
        applicant.nationality ||
        client?.nationality ||
        null,

      gender:
        applicant.gender ||
        client?.gender ||
        null
    };
  }

  async fillKnownField(
    semantic,
    value
  ) {
    const page =
      await this.ensurePage();

    const descriptor =
      await page.evaluate(
        semanticName => {
          const normalize =
            value =>
              String(value || "")
                .trim()
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                );

          const semanticTerms = {
            passportNumber: [
              "passport number",
              "passport no",
              "passport number*",
              "travel document number"
            ],

            firstName: [
              "first name",
              "given name",
              "given names"
            ],

            lastName: [
              "last name",
              "surname",
              "family name"
            ],

            fullName: [
              "full name",
              "applicant name"
            ],

            dateOfBirth: [
              "date of birth",
              "birth date",
              "dob"
            ],

            nationality: [
              "nationality"
            ],

            gender: [
              "gender",
              "sex"
            ]
          };

          const terms =
            semanticTerms[
              semanticName
            ] || [];

          const candidates =
            Array.from(
              document.querySelectorAll(
                "input, select, textarea"
              )
            ).filter(
              element => {
                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  element.readOnly ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const haystack =
                  normalize(
                    [
                      element.getAttribute(
                        "name"
                      ),
                      element.id,
                      element.getAttribute(
                        "placeholder"
                      ),
                      element.getAttribute(
                        "aria-label"
                      ),
                      element.getAttribute(
                        "autocomplete"
                      ),
                      element.parentElement
                        ?.innerText
                    ].join(" ")
                  );

                return terms.some(
                  term =>
                    haystack.includes(
                      normalize(term)
                    )
                );
              }
            );

          if (
            candidates.length !== 1
          ) {
            return {
              found: false,
              ambiguous:
                candidates.length > 1,
              count:
                candidates.length
            };
          }

          const element =
            candidates[0];

          return {
            found: true,

            selectorData: {
              tag:
                element.tagName
                  .toLowerCase(),

              id:
                element.id ||
                null,

              name:
                element.getAttribute(
                  "name"
                ) || null,

              type:
                element.getAttribute(
                  "type"
                ) || null
            }
          };
        },
        semantic
      );

    if (
      !descriptor?.found
    ) {
      return {
        filled: false,
        ambiguous:
          Boolean(
            descriptor?.ambiguous
          ),
        reason:
          descriptor?.ambiguous
            ? "Multiple possible VFS fields."
            : "No unambiguous VFS field found."
      };
    }

    const selector =
      this.buildSelector(
        descriptor.selectorData
      );

    if (!selector) {
      return {
        filled: false,
        ambiguous: false,
        reason:
          "Could not safely address the VFS field."
      };
    }

    await page.click(
      selector
    );

    await page.$eval(
      selector,
      element => {
        element.value = "";
      }
    );

    await page.type(
      selector,
      value,
      {
        delay: 15
      }
    );

    return {
      filled: true,
      ambiguous: false,
      selector:
        descriptor.selectorData
    };
  }

  /*
   * ============================================================
   * OTP
   * ============================================================
   */

  async requestOtp() {
    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type !==
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        otpRequired: false,
        reason:
          "VFS is not currently requesting OTP.",
        checkpoint:
          this.lastCheckpoint
      };
    }

    return {
      success: true,
      otpRequired: true,
      requiresUser: false,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  async submitOtp(
    code
  ) {
    if (
      !code ||
      !/^\d{4,8}$/.test(
        String(code).trim()
      )
    ) {
      throw new Error(
        "Invalid OTP format"
      );
    }

    const page =
      await this.ensurePage();

    const descriptor =
      await this.findOtpInput();

    if (
      !descriptor?.found
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          descriptor?.ambiguous
            ? "Multiple OTP fields detected."
            : "No unambiguous OTP field detected.",
        dom:
          this.getDomSummary()
      };
    }

    const selector =
      this.buildSelector(
        descriptor.selectorData
      );

    if (!selector) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "OTP field cannot be addressed safely."
      };
    }

    await page.click(
      selector
    );

    await page.$eval(
      selector,
      element => {
        element.value = "";
      }
    );

    await page.type(
      selector,
      String(code).trim(),
      {
        delay: 20
      }
    );

    const submitted =
      await this.clickUnambiguousAction(
        [
          "verify",
          "verify otp",
          "submit",
          "continue"
        ]
      );

    if (
      !submitted.clicked
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "OTP was entered, but no unambiguous VFS submission action was found.",
        dom:
          this.getDomSummary()
      };
    }

    await page
      .waitForNetworkIdle({
        idleTime: 400,
        timeout: 8000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    const verified =
      this.lastCheckpoint?.type !==
      "OTP_REQUIRED";

    return {
      success:
        verified,

      otpVerified:
        verified,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  async findOtpInput() {
    const page =
      await this.ensurePage();

    return page.evaluate(
      terms => {
        const normalize =
          value =>
            String(value || "")
              .trim()
              .toLowerCase()
              .replace(
                /\s+/g,
                " "
              );

        const candidates =
          Array.from(
            document.querySelectorAll(
              "input"
            )
          ).filter(
            input => {
              if (
                input.disabled ||
                input.readOnly
              ) {
                return false;
              }

              const haystack =
                normalize(
                  [
                    input.name,
                    input.id,
                    input.placeholder,
                    input.getAttribute(
                      "aria-label"
                    ),
                    input.autocomplete,
                    input.parentElement
                      ?.innerText
                  ].join(" ")
                );

              return terms.some(
                term =>
                  haystack.includes(
                    normalize(term)
                  )
              );
            }
          );

        if (
          candidates.length !== 1
        ) {
          return {
            found: false,
            ambiguous:
              candidates.length > 1,
            count:
              candidates.length
          };
        }

        const input =
          candidates[0];

        return {
          found: true,

          selectorData: {
            id:
              input.id ||
              null,

            name:
              input.name ||
              null
          }
        };
      },
      CHECKPOINT_TERMS.otp
    );
  }

  /*
 * ============================================================
 * VERIFICAÇÃO FACIAL VFS — CÂMERA SIMULADA AUTORIZADA
 * ============================================================
 *
 * A VFS autorizou o uso de uma fonte de vídeo simulada
 * através do mecanismo nativo do Chromium.
 *
 * O sistema utiliza:
 *
 * vídeo original armazenado
 *          ↓
 * posição facial identificada
 *          ↓
 * conversão para Y4M
 *          ↓
 * Chromium --use-file-for-fake-video-capture
 *          ↓
 * getUserMedia() da página VFS
 *
 * IMPORTANTE:
 *
 * - O vídeo original permanece armazenado como evidência.
 * - O Y4M é somente uma representação intermediária para
 *   a câmera simulada.
 * - A posição não é escolhida aleatoriamente.
 * - A instrução apresentada pela VFS deve ser relacionada
 *   a uma das posições armazenadas.
 * - Se não houver correspondência suficientemente segura,
 *   o sistema interrompe essa etapa em vez de escolher
 *   uma posição errada.
 * - CAPTCHA e demais checkpoints oficiais da VFS continuam
 *   sendo respeitados normalmente.
 *
 * A simulação da câmera é usada exclusivamente no fluxo
 * de automação facial autorizado.
 */
  

  async verifyIdentity(
    application,
    client
  ) {
    await this.navigate(
      `${VFS_BASE_URL}/fv-instructions`
    );

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS facial-position checkpoint detected.",
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    return {
      success: false,
      requiresUser: true,
      facialRequired: true,
      reason:
        "The official VFS facial verification checkpoint requires the supported facial flow.",
      state:
        this.state,
      dom:
        this.getDomSummary()
    };
  }
async getFacialCameraState() {
  const page = await this.ensurePage();

  const state = await page.evaluate(() => {
    const media =
      window.__travelAutomationMediaState || {};

    const videoTracks =
      Array.isArray(media.tracks)
        ? media.tracks.filter(
            track =>
              track &&
              track.kind === "video"
          )
        : [];

    return {
      requested:
        media.requested === true,

      opened:
        media.opened === true,

      active:
        media.active === true,

      requestedAt:
        media.requestedAt || null,

      openedAt:
        media.openedAt || null,

      constraints:
        media.constraints || null,

      tracks:
        videoTracks,

      error:
        media.error || null
    };
  });

  if (state.opened) {
    this.facialSession.cameraRequested = true;
    this.facialSession.cameraOpened = true;
  } else if (state.requested) {
    this.facialSession.cameraRequested = true;
  }

  if (!state.active) {
    this.facialSession.cameraOpened =
      state.opened === true;
  }

  return state;
}
  async loadFacialVideoIntoPersistentCamera(
  application,
  client,
  selected
) {
  if (!application) {
    throw new Error(
      "Application is required to load facial video."
    );
  }

  if (!client) {
    throw new Error(
      "Client is required to load facial video."
    );
  }

  if (!selected) {
    throw new Error(
      "Selected facial position is required."
    );
  }

  const position =
    Number(selected.position);

  if (
    !Number.isInteger(position) ||
    position < 1 ||
    position > 10
  ) {
    throw new Error(
      `Invalid facial position: ${selected.position}`
    );
  }

  /*
   * ============================================================
   * 1. GARANTIR QUE A CÂMERA PERSISTENTE EXISTE
   * ============================================================
   */

  const cameraState =
    await this.getFacialCameraState();

  if (
    !cameraState.opened ||
    !cameraState.active
  ) {
    throw new Error(
      "VFS persistent camera is not open."
    );
  }

  /*
   * ============================================================
   * 2. BUSCAR O VÍDEO ORIGINAL ARMAZENADO
   * ============================================================
   *
   * Não criamos uma nova gravação.
   * Não alteramos o armazenamento.
   *
   * Apenas recuperamos o vídeo da posição
   * que a VFS acabou de solicitar.
   */

  const stored =
    await this.getStoredFacialVideo(
      application,
      client,
      selected
    );

  if (
    !stored ||
    !stored.buffer ||
    !Buffer.isBuffer(stored.buffer) ||
    stored.buffer.length === 0
  ) {
    throw new Error(
      `Stored facial video not found for position ${position}.`
    );
  }

  /*
   * ============================================================
   * 3. PREPARAR O VÍDEO
   * ============================================================
   *
   * O serviço existente continua sendo usado.
   *
   * Isso preserva a preparação Y4M já existente no projeto,
   * mas sem reiniciar o Chromium.
   */

  const prepared =
    await prepareFromBuffer(
      stored.buffer,
      {
        position,
        label:
          selected.label ||
          stored.label ||
          null,
        videoId:
          stored.videoId ||
          null
      }
    );

  if (
    !prepared ||
    !prepared.path
  ) {
    throw new Error(
      `Could not prepare facial video for position ${position}.`
    );
  }

  /*
   * ============================================================
   * 4. ATUALIZAR ESTADO DA TROCA
   * ============================================================
   */

  this.facialSession.switchInProgress =
    true;

  this.facialSession.switchStartedAt =
    new Date().toISOString();

  this.facialSession.sourcePosition =
    position;

  this.facialSession.sourceVideoId =
    stored.videoId ||
    selected.videoId ||
    null;

  this.facialSession.sourceLoaded =
    false;

  this.facialSession.sourcePlaying =
    false;

  /*
   * ============================================================
   * 5. ENVIAR O VÍDEO PARA A PÁGINA
   * ============================================================
   */

  const page =
    await this.ensurePage();

  const result =
    await page.evaluate(
      async ({
        path: videoPath,
        position: selectedPosition,
        videoId
      }) => {
        const camera =
          window.__travelAutomationCamera;

        if (
          !camera ||
          !camera.initialized ||
          !camera.stream ||
          !camera.canvas ||
          !camera.context
        ) {
          throw new Error(
            "Persistent camera is not initialized."
          );
        }

        /*
         * Criamos/reutilizamos um elemento <video>
         * oculto como fonte.
         */
        let video =
          camera.video;

        if (!video) {
          video =
            document.createElement("video");

          video.muted = true;
          video.autoplay = false;
          video.playsInline = true;

          video.setAttribute(
            "playsinline",
            ""
          );

          video.style.position =
            "fixed";

          video.style.left =
            "-10000px";

          video.style.top =
            "-10000px";

          video.style.width =
            "1px";

          video.style.height =
            "1px";

          video.style.opacity =
            "0";

          document.body.appendChild(
            video
          );

          camera.video = video;
          camera.videoElementReady =
            true;
        }

        /*
         * O caminho local não pode ser passado diretamente
         * ao navegador.
         *
         * Ele será convertido pelo Node para uma URL
         * acessível ao contexto da página no próximo passo.
         */
        return {
          success: true,
          position: selectedPosition,
          videoId: videoId || null,
          videoReady:
            camera.videoElementReady === true
        };
      },
      {
        path: prepared.path,
        position,
        videoId:
          stored.videoId ||
          selected.videoId ||
          null
      }
    );

  if (
    !result ||
    result.success !== true
  ) {
    throw new Error(
      `Could not initialize persistent video source for position ${position}.`
    );
  }

  /*
   * ============================================================
   * 6. GUARDAR O PREPARADO NO ESTADO DO ADAPTER
   * ============================================================
   *
   * Este caminho NÃO será usado para relançar o Chromium.
   *
   * Ele fica apenas como fonte temporária da posição atual.
   */

  this.activeCameraY4mPath =
    prepared.path;

  this.activeCameraVideoId =
    stored.videoId ||
    selected.videoId ||
    null;

  this.activeCameraPosition =
    position;

  this.facialSession.sourceLoaded =
    true;

  this.facialSession.switchCompletedAt =
    new Date().toISOString();

  this.facialSession.switchInProgress =
    false;

  return {
    success: true,

    position,

    label:
      selected.label ||
      stored.label ||
      null,

    videoId:
      stored.videoId ||
      selected.videoId ||
      null,

    storageReference:
      selected.storageReference ||
      null,

    preparedPath:
      prepared.path,

    cameraStreamId:
      this.facialSession.streamId ||
      null,

    persistentCamera:
      true,

    reusedCameraSession:
      true
  };
}
  async playFacialVideoOnPersistentCamera(
  preparedPath,
  position,
  videoId = null
) {
  if (!preparedPath) {
    throw new Error(
      "Prepared facial video path is required."
    );
  }

  const page =
    await this.ensurePage();

  if (
    !fs.existsSync(preparedPath)
  ) {
    throw new Error(
      `Prepared facial video does not exist: ${preparedPath}`
    );
  }

  const videoBuffer =
    await fs.promises.readFile(
      preparedPath
    );

  if (
    !videoBuffer ||
    videoBuffer.length === 0
  ) {
    throw new Error(
      "Prepared facial video is empty."
    );
  }

  /*
   * ============================================================
   * O Y4M é uma fonte de captura do Chromium.
   *
   * Para a câmera persistente baseada em canvas,
   * precisamos reproduzir uma fonte de vídeo que o
   * elemento <video> do navegador consiga decodificar.
   *
   * Portanto, o preparado Y4M não é enviado diretamente
   * para o elemento <video>.
   *
   * Vamos gerar uma versão MP4 temporária para reprodução.
   * ============================================================
   */

  const tempDir =
    path.dirname(preparedPath);

  const mp4Path =
    path.join(
      tempDir,
      `facial-position-${position}-${Date.now()}.mp4`
    );

  await new Promise(
    (resolve, reject) => {
      const ffmpeg =
        require("child_process").spawn(
          require("ffmpeg-static"),
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",

            "-f",
            "yuv4mpegpipe",

            "-i",
            preparedPath,

            "-c:v",
            "libx264",

            "-preset",
            "veryfast",

            "-pix_fmt",
            "yuv420p",

            "-movflags",
            "+faststart",

            "-an",

            mp4Path
          ],
          {
            stdio: [
              "ignore",
              "ignore",
              "pipe"
            ]
          }
        );

      let stderr = "";

      ffmpeg.stderr.on(
        "data",
        chunk => {
          stderr +=
            chunk.toString();
        }
      );

      ffmpeg.on(
        "error",
        reject
      );

      ffmpeg.on(
        "close",
        code => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `FFmpeg failed creating browser video: ${stderr || `exit code ${code}`}`
            )
          );
        }
      );
    }
  );

  if (
    !fs.existsSync(mp4Path)
  ) {
    throw new Error(
      "Temporary browser video was not created."
    );
  }

  const browserBuffer =
    await fs.promises.readFile(
      mp4Path
    );

  const base64 =
    browserBuffer.toString(
      "base64"
    );

  /*
   * ============================================================
   * ENVIAR A PÁGINA E ALIMENTAR O CANVAS
   * ============================================================
   */

  const result =
    await page.evaluate(
      async ({
        base64,
        position,
        videoId
      }) => {
        const camera =
          window.__travelAutomationCamera;

        if (
          !camera ||
          !camera.initialized ||
          !camera.canvas ||
          !camera.context ||
          !camera.stream
        ) {
          throw new Error(
            "Persistent camera is not initialized."
          );
        }

        let video =
          camera.video;

        if (!video) {
          video =
            document.createElement(
              "video"
            );

          video.muted = true;
          video.autoplay = false;
          video.playsInline = true;

          video.setAttribute(
            "playsinline",
            ""
          );

          video.style.position =
            "fixed";

          video.style.left =
            "-10000px";

          video.style.top =
            "-10000px";

          video.style.width =
            "1px";

          video.style.height =
            "1px";

          video.style.opacity =
            "0";

          document.body.appendChild(
            video
          );

          camera.video =
            video;

          camera.videoElementReady =
            true;
        }

        /*
         * Blob temporário para o elemento <video>.
         */
        const binary =
          atob(base64);

        const bytes =
          new Uint8Array(
            binary.length
          );

        for (
          let i = 0;
          i < binary.length;
          i++
        ) {
          bytes[i] =
            binary.charCodeAt(i);
        }

        const blob =
          new Blob(
            [bytes],
            {
              type: "video/mp4"
            }
          );

        const objectUrl =
          URL.createObjectURL(
            blob
          );

        /*
         * Liberar a URL anterior.
         */
        if (
          camera.videoObjectUrl
        ) {
          try {
            URL.revokeObjectURL(
              camera.videoObjectUrl
            );
          } catch (_) {}
        }

        camera.videoObjectUrl =
          objectUrl;

        video.pause();

        video.removeAttribute(
          "src"
        );

        video.load();

        video.src =
          objectUrl;

        await new Promise(
          (resolve, reject) => {
            let settled = false;

            const cleanup = () => {
              video.removeEventListener(
                "loadedmetadata",
                onLoaded
              );

              video.removeEventListener(
                "error",
                onError
              );
            };

            const onLoaded = () => {
              if (settled) return;

              settled = true;

              cleanup();

              resolve();
            };

            const onError = () => {
              if (settled) return;

              settled = true;

              cleanup();

              reject(
                new Error(
                  "Browser could not decode the facial video."
                )
              );
            };

            video.addEventListener(
              "loadedmetadata",
              onLoaded
            );

            video.addEventListener(
              "error",
              onError
            );

            video.load();
          }
        );

        /*
         * ======================================================
         * DESENHO CONTÍNUO NO CANVAS
         * ======================================================
         */

        const drawFrame =
          () => {
            if (
              !camera.initialized ||
              !camera.canvas ||
              !camera.context
            ) {
              return;
            }

            const ctx =
              camera.context;

            const canvas =
              camera.canvas;

            if (
              video.readyState >= 2 &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              const sourceWidth =
                video.videoWidth;

              const sourceHeight =
                video.videoHeight;

              const scale =
                Math.min(
                  canvas.width /
                    sourceWidth,
                  canvas.height /
                    sourceHeight
                );

              const width =
                sourceWidth * scale;

              const height =
                sourceHeight * scale;

              const x =
                (canvas.width -
                  width) /
                2;

              const y =
                (canvas.height -
                  height) /
                2;

              ctx.fillStyle =
                "#000000";

              ctx.fillRect(
                0,
                0,
                canvas.width,
                canvas.height
              );

              ctx.drawImage(
                video,
                x,
                y,
                width,
                height
              );

              camera.lastFrameAt =
                new Date().toISOString();
            }

            requestAnimationFrame(
              drawFrame
            );
          };

        if (
          !camera.renderLoopStarted
        ) {
          camera.renderLoopStarted =
            true;

          requestAnimationFrame(
            drawFrame
          );
        }

        await video.play();

        camera.currentPosition =
          Number(position);

        camera.currentVideoId =
          videoId || null;

        camera.active = true;

        camera.sourceLoaded =
          true;

        camera.sourcePlaying =
          true;

        camera.lastFrameAt =
          new Date().toISOString();

        return {
          success: true,

          position:
            Number(position),

          videoId:
            videoId || null,

          streamId:
            camera.streamId || null,

          readyState:
            video.readyState,

          duration:
            Number.isFinite(
              video.duration
            )
              ? video.duration
              : null,

          width:
            video.videoWidth || 0,

          height:
            video.videoHeight || 0
        };
      },
      {
        base64,
        position:
          Number(position),
        videoId:
          videoId || null
      }
    );

  /*
   * ============================================================
   * LIMPEZA DO MP4 TEMPORÁRIO
   * ============================================================
   */

  try {
    await fs.promises.unlink(
      mp4Path
    );
  } catch (_) {}

  if (
    !result ||
    result.success !== true
  ) {
    throw new Error(
      `Could not start facial video for position ${position}.`
    );
  }

  /*
   * ============================================================
   * ATUALIZAR SESSÃO
   * ============================================================
   */

  this.facialSession.sourcePosition =
    Number(position);

  this.facialSession.sourceVideoId =
    videoId || null;

  this.facialSession.sourceLoaded =
    true;

  this.facialSession.sourcePlaying =
    true;

  this.facialSession.videoElementReady =
    true;

  this.facialSession.lastFrameAt =
    new Date().toISOString();

  this.facialSession.switchCompletedAt =
    new Date().toISOString();

  return result;
}
  async switchPersistentFacialVideo(
  application,
  client,
  selected
) {
  if (!selected) {
    throw new Error(
      "Facial position selection is required."
    );
  }

  const position =
    Number(selected.position);

  if (
    !Number.isInteger(position) ||
    position < 1 ||
    position > 10
  ) {
    throw new Error(
      `Invalid facial position: ${selected.position}`
    );
  }

  /*
   * ============================================================
   * IMPEDIR DUAS TROCAS SIMULTÂNEAS
   * ============================================================
   */

  if (
    this.facialSession.switchInProgress
  ) {
    return {
      success: false,
      busy: true,
      position,
      reason:
        "Another facial video switch is already in progress."
    };
  }

  this.facialSession.switchInProgress =
    true;

  this.facialSession.switchStartedAt =
    new Date().toISOString();

  try {
    /*
     * ==========================================================
     * 1. RECUPERAR O VÍDEO GUARDADO
     * ==========================================================
     */

    const stored =
      await this.getStoredFacialVideo(
        application,
        client,
        selected
      );

    if (
      !stored ||
      !stored.buffer ||
      !Buffer.isBuffer(stored.buffer) ||
      stored.buffer.length === 0
    ) {
      throw new Error(
        `No stored facial video available for position ${position}.`
      );
    }

    /*
     * ==========================================================
     * 2. PREPARAR O VÍDEO
     * ==========================================================
     */

    const prepared =
      await prepareFromBuffer(
        stored.buffer,
        {
          position,
          label:
            selected.label ||
            stored.label ||
            null,
          videoId:
            stored.videoId ||
            null
        }
      );

    if (
      !prepared ||
      !prepared.path
    ) {
      throw new Error(
        `Could not prepare facial video for position ${position}.`
      );
    }

    /*
     * ==========================================================
     * 3. REPRODUZIR NA CÂMERA PERSISTENTE
     * ==========================================================
     */

    const playback =
      await this.playFacialVideoOnPersistentCamera(
        prepared.path,
        position,
        stored.videoId ||
          selected.videoId ||
          null
      );

    /*
     * ==========================================================
     * 4. ATUALIZAR ESTADO
     * ==========================================================
     */

    this.activeCameraY4mPath =
      prepared.path;

    this.activeCameraVideoId =
      stored.videoId ||
      selected.videoId ||
      null;

    this.activeCameraPosition =
      position;

    this.facialSession.currentPosition =
      position;

    this.facialSession.sourcePosition =
      position;

    this.facialSession.sourceVideoId =
      stored.videoId ||
      selected.videoId ||
      null;

    this.facialSession.sourceLoaded =
      true;

    this.facialSession.sourcePlaying =
      true;

    this.facialSession.videoElementReady =
      true;

    this.facialSession.lastFrameAt =
      new Date().toISOString();

    this.facialSession.switchCompletedAt =
      new Date().toISOString();

    return {
      success: true,

      position,

      label:
        selected.label ||
        stored.label ||
        null,

      videoId:
        stored.videoId ||
        selected.videoId ||
        null,

      storageReference:
        selected.storageReference ||
        null,

      persistentCamera: true,

      reusedCameraSession: true,

      streamId:
        this.facialSession.streamId ||
        playback?.streamId ||
        null
    };
  } catch (error) {
    this.facialSession.sourceLoaded =
      false;

    this.facialSession.sourcePlaying =
      false;

    throw error;
  } finally {
    this.facialSession.switchInProgress =
      false;

    this.facialSession.switchCompletedAt =
      new Date().toISOString();
  }
}
  async processFacialVfsInstruction(
  application,
  client
) {
  /*
   * ============================================================
   * GARANTIR QUE A SESSÃO FACIAL EXISTE
   * ============================================================
   */

  if (!this.facialSession) {
    this.facialSession = {
      active: false,
      cameraRequested: false,
      cameraOpened: false,

      currentRequest: null,
      currentPosition: null,

      requestedPositions: [],
      acceptedPositions: [],

      pendingPosition: null,

      startedAt: null,
      lastRequestAt: null,
      lastAcceptedAt: null,

      completed: false,

      streamReady: false,
      streamId: null,

      canvasReady: false,
      canvasWidth: 640,
      canvasHeight: 480,
      canvasFps: 30,

      sourcePosition: null,
      sourceVideoId: null,

      sourceLoaded: false,
      sourcePlaying: false,

      switchInProgress: false,
      switchStartedAt: null,
      switchCompletedAt: null,

      videoElementReady: false,
      lastFrameAt: null
    };
  }

  /*
   * ============================================================
   * 1. VERIFICAR A CÂMERA
   * ============================================================
   */

  const camera =
    await this.getFacialCameraState();

  if (
    !camera.opened ||
    !camera.active
  ) {
    return {
      success: false,
      waitingForCamera: true,
      state:
        "WAITING_FOR_VFS_CAMERA"
    };
  }

  this.facialSession.active =
    true;

  this.facialSession.cameraRequested =
    true;

  this.facialSession.cameraOpened =
    true;

  this.facialSession.streamReady =
    true;

  this.facialSession.streamId =
    camera.tracks?.[0]?.id ||
    this.facialSession.streamId ||
    null;

  if (
    !this.facialSession.startedAt
  ) {
    this.facialSession.startedAt =
      new Date().toISOString();
  }

  /*
   * ============================================================
   * 2. LER A INSTRUÇÃO ATUAL DA VFS
   * ============================================================
   */

  const request =
    await this.detectFacialPositionRequest();

  if (
    !request ||
    !request.description
  ) {
    /*
     * Não existe uma instrução facial clara.
     *
     * Não escolhemos uma posição aleatoriamente.
     */
    return {
      success: false,
      waitingForInstruction: true,
      state:
        "WAITING_FOR_VFS_FACIAL_INSTRUCTION"
    };
  }

  const description =
    String(
      request.description
    )
      .trim();

  this.facialSession.lastRequestAt =
    new Date().toISOString();

  /*
   * ============================================================
   * 3. NORMALIZAR IDENTIDADE DA INSTRUÇÃO
   * ============================================================
   */

  const normalize =
    value =>
      String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(
          /[\u0300-\u036f]/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

  const normalizedRequest =
    normalize(description);

  /*
   * ============================================================
   * 4. SE A VFS MUDOU A INSTRUÇÃO,
   *    CONSIDERAMOS A ANTERIOR ACEITA
   * ============================================================
   */

  const previousRequest =
    this.facialSession.currentRequest;

  const previousPosition =
    this.facialSession.currentPosition;

  const hasPrevious =
    Boolean(
      previousRequest &&
      previousPosition
    );

  const instructionChanged =
    hasPrevious &&
    normalize(previousRequest) !==
      normalizedRequest;

  if (
    instructionChanged
  ) {
    const alreadyAccepted =
      this.facialSession.acceptedPositions
        .some(
          item =>
            Number(item.position) ===
            Number(previousPosition)
        );

    if (!alreadyAccepted) {
      this.facialSession.acceptedPositions.push(
        {
          position:
            Number(previousPosition),

          request:
            previousRequest,

          acceptedAt:
            new Date().toISOString()
        }
      );

      this.facialSession.lastAcceptedAt =
        new Date().toISOString();
    }
  }

  /*
   * ============================================================
   * 5. SE É A MESMA INSTRUÇÃO,
   *    NÃO RECARREGAR O VÍDEO
   * ============================================================
   */

  if (
    hasPrevious &&
    !instructionChanged
  ) {
    return {
      success: true,
      state:
        "FACIAL_POSITION_WAITING_ACCEPTANCE",

      request: description,

      position:
        Number(previousPosition),

      waitingForNextInstruction:
        true,

      accepted:
        this.facialSession.acceptedPositions
          .some(
            item =>
              Number(item.position) ===
              Number(previousPosition)
          )
    };
  }

  /*
   * ============================================================
   * 6. RECUPERAR POSIÇÕES ARMAZENADAS
   * ============================================================
   */

  const facialPositions =
    Array.isArray(
      client?.facialPositions
    )
      ? client.facialPositions
      : [];

  const validPositions =
    facialPositions.filter(
      item => {
        const position =
          Number(item?.position);

        return (
          Number.isInteger(position) &&
          position >= 1 &&
          position <= 10 &&
          Boolean(
            item?.storageReference
          )
        );
      }
    );

  if (
    !validPositions.length
  ) {
    return {
      success: false,
      state:
        "FACIAL_VIDEOS_NOT_AVAILABLE",
      reason:
        "No stored facial positions are available."
    };
  }

  /*
   * ============================================================
   * 7. RESOLVER TEXTO VFS -> POSIÇÃO
   * ============================================================
   */

  const resolved =
    await FacialService.resolvePositionRequest(
      {
        request: description,
        positions: validPositions
      }
    );

  if (
    !resolved ||
    !resolved.position
  ) {
    /*
     * NUNCA escolher aleatoriamente.
     */
    return {
      success: false,

      unresolved: true,

      state:
        "FACIAL_POSITION_UNRESOLVED",

      request:
        description,

      candidates:
        resolved?.candidates ||
        [],

      matchedTerms:
        resolved?.matchedTerms ||
        []
    };
  }

  const selected =
    validPositions.find(
      item =>
        Number(item.position) ===
        Number(resolved.position)
    );

  if (!selected) {
    return {
      success: false,

      unresolved: true,

      state:
        "FACIAL_POSITION_NOT_STORED",

      request:
        description,

      position:
        Number(resolved.position)
    };
  }

  /*
   * ============================================================
   * 8. NÃO REPETIR UMA POSIÇÃO JÁ ACEITA
   * ============================================================
   */

  const alreadyAccepted =
    this.facialSession.acceptedPositions
      .some(
        item =>
          Number(item.position) ===
          Number(selected.position)
      );

  if (
    alreadyAccepted
  ) {
    return {
      success: false,

      state:
        "FACIAL_POSITION_ALREADY_ACCEPTED",

      request:
        description,

      position:
        Number(selected.position)
    };
  }

  /*
   * ============================================================
   * 9. TROCAR O CONTEÚDO DA CÂMERA
   * ============================================================
   */

  const switched =
    await this.switchPersistentFacialVideo(
      application,
      client,
      selected
    );

  if (
    !switched ||
    switched.success !== true
  ) {
    return {
      success: false,

      state:
        "FACIAL_VIDEO_SWITCH_FAILED",

      request:
        description,

      position:
        Number(selected.position)
    };
  }

  /*
   * ============================================================
   * 10. REGISTRAR A NOVA INSTRUÇÃO
   * ============================================================
   */

  this.facialSession.currentRequest =
    description;

  this.facialSession.currentPosition =
    Number(selected.position);

  this.facialSession.pendingPosition =
    Number(selected.position);

  this.facialSession.sourcePosition =
    Number(selected.position);

  this.facialSession.sourceVideoId =
    switched.videoId ||
    null;

  /*
   * Evita duplicação no histórico.
   */
  const alreadyRequested =
    this.facialSession.requestedPositions
      .some(
        item =>
          Number(item.position) ===
            Number(selected.position) &&
          normalize(item.request) ===
            normalizedRequest
      );

  if (
    !alreadyRequested
  ) {
    this.facialSession.requestedPositions.push(
      {
        position:
          Number(selected.position),

        request:
          description,

        videoId:
          switched.videoId ||
          null,

        requestedAt:
          new Date().toISOString()
      }
    );
  }

  return {
    success: true,

    state:
      "FACIAL_POSITION_VIDEO_ACTIVE",

    request:
      description,

    position:
      Number(selected.position),

    label:
      selected.label ||
      null,

    videoId:
      switched.videoId ||
      null,

    storageReference:
      selected.storageReference ||
      null,

    score:
      resolved.score ||
      null,

    matchedTerms:
      resolved.matchedTerms ||
      [],

    candidates:
      resolved.candidates ||
      [],

    accepted:
      false,

    waitingForNextInstruction:
      true,

    persistentCamera:
      true
  };
}
  
async detectFacialPositionRequest() {
  const page =
    await this.ensurePage();

  /*
   * ============================================================
   * A VFS só deve ser considerada como tendo uma instrução
   * facial concreta quando existir texto que descreva realmente
   * um movimento/posição.
   *
   * "Facial verification", "liveness", "selfie", etc. sozinhos
   * NÃO são suficientes.
   * ============================================================
   */

  const result =
    await page.evaluate(() => {
      const normalize =
        value =>
          String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(
              /[\u0300-\u036f]/g,
              ""
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();

      const body =
        normalize(
          document.body?.innerText ||
            ""
        );

      /*
       * ========================================================
       * TERMOS CONCRETOS DE MOVIMENTO
       * ========================================================
       */

      const movementTerms = [
        "look left",
        "look right",
        "look up",
        "look down",

        "turn left",
        "turn right",

        "turn your head left",
        "turn your head right",

        "tilt left",
        "tilt right",

        "tilt your head left",
        "tilt your head right",

        "look to the left",
        "look to the right",

        "look upwards",
        "look upward",

        "look downwards",
        "look downward",

        "smile",

        "left",
        "right",
        "up",
        "down",

        "esquerda",
        "direita",
        "cima",
        "baixo",

        "virar para a esquerda",
        "virar para a direita",

        "olhar para a esquerda",
        "olhar para a direita",

        "olhar para cima",
        "olhar para baixo",

        "sorria",
        "sorrir"
      ];

      /*
       * ========================================================
       * ELEMENTOS VISÍVEIS
       * ========================================================
       */

      const elements =
        Array.from(
          document.querySelectorAll(
            [
              "body",
              "main",
              "section",
              "div",
              "p",
              "span",
              "label",
              "h1",
              "h2",
              "h3",
              "h4",
              "button",
              "[role='alert']",
              "[role='status']",
              "[aria-live]"
            ].join(",")
          )
        );

      const visibleTexts = [];

      for (
        const element of elements
      ) {
        const text =
          normalize(
            element.innerText ||
              element.textContent ||
              ""
          );

        if (!text) {
          continue;
        }

        const rect =
          typeof element.getBoundingClientRect ===
          "function"
            ? element.getBoundingClientRect()
            : null;

        const visible =
          !rect ||
          (
            rect.width > 0 &&
            rect.height > 0
          );

        if (!visible) {
          continue;
        }

        if (
          text.length < 3 ||
          text.length > 300
        ) {
          continue;
        }

        const hasMovement =
          movementTerms.some(
            term =>
              text.includes(term)
          );

        if (!hasMovement) {
          continue;
        }

        visibleTexts.push(text);
      }

      /*
       * ========================================================
       * TAMBÉM VERIFICAR O BODY
       * ========================================================
       */

      const bodyCandidates =
        body
          .split(
            /[\n\r.!?]+/
          )
          .map(
            value =>
              normalize(value)
          )
          .filter(Boolean)
          .filter(
            text =>
              text.length >= 3 &&
              text.length <= 300
          )
          .filter(
            text =>
              movementTerms.some(
                term =>
                  text.includes(term)
              )
          );

      const candidates =
        [
          ...visibleTexts,
          ...bodyCandidates
        ];

      /*
       * Remover duplicados mantendo a ordem.
       */
      const unique =
        Array.from(
          new Set(candidates)
        );

      /*
       * ========================================================
       * ESCOLHER A INSTRUÇÃO MAIS ESPECÍFICA
       * ========================================================
       *
       * Preferimos frases que contenham mais de um componente:
       *
       * "turn right and look up"
       *
       * em vez de simplesmente:
       *
       * "right"
       */

      unique.sort(
        (a, b) => {
          const score = text => {
            let value = 0;

            const components = [
              "left",
              "right",
              "up",
              "down",
              "esquerda",
              "direita",
              "cima",
              "baixo",
              "look",
              "turn",
              "virar",
              "olhar",
              "smile",
              "sorr",
              "tilt"
            ];

            for (
              const component of
                components
            ) {
              if (
                text.includes(component)
              ) {
                value += 1;
              }
            }

            /*
             * Frases mais longas geralmente
             * contêm a instrução completa.
             */
            value += Math.min(
              text.length / 100,
              2
            );

            return value;
          };

          return (
            score(b) -
            score(a)
          );
        }
      );

      return {
        body,
        candidates: unique,
        description:
          unique[0] || null
      };
    });

  /*
   * ============================================================
   * SEM INSTRUÇÃO CONCRETA
   * ============================================================
   */

  if (
    !result ||
    !result.description
  ) {
    return null;
  }

  /*
   * ============================================================
   * IGNORAR TEXTOS GENÉRICOS
   * ============================================================
   */

  const normalized =
    String(
      result.description
    )
      .toLowerCase()
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const genericOnly =
    [
      "facial",
      "facial verification",
      "facial recognition",
      "face verification",
      "liveness",
      "selfie",
      "facial verification required",
      "complete facial verification"
    ];

  if (
    genericOnly.includes(
      normalized
    )
  ) {
    return null;
  }

  /*
   * ============================================================
   * RESULTADO
   * ============================================================
   */

  return {
    description:
      result.description,

    normalized,

    candidates:
      result.candidates || [],

    detectedAt:
      new Date().toISOString()
  };
}
  /*
   * ============================================================
   * RECUPERAR VÍDEO DE LIVENESS ARMAZENADO
   * ============================================================
   *
   * Recebe a posição já resolvida pelo pedido da VFS e
   * recupera o segmento original guardado no GridFS.
   *
   * NÃO escolhe posição.
   * NÃO altera o vídeo.
   * NÃO substitui o armazenamento existente.
   *
   * Apenas:
   *
   * storageReference
   *        ↓
   * videoId / position
   *        ↓
   * GridFS
   *        ↓
   * Buffer original
   * ============================================================
   */

  async getStoredFacialVideo(
    application,
    client,
    selected
  ) {

    if (
      !application ||
      !client ||
      !selected
    ) {
      throw new Error(
        "Application, client and selected facial position are required."
      );
    }


    const accountId =
      application.accountId ||
      client.accountId ||
      null;


    const clientId =
      client._id ||
      client.id ||
      application.clientId ||
      null;


    const sessionId =
      application.liveness?.sessionId ||
      application.facialCheckpoint?.sessionId ||
      client.liveness?.sessionId ||
      client.facialSessionId ||
      null;


    const position =
      Number(
        selected.position
      );


    if (
      !accountId
    ) {
      throw new Error(
        "Não foi possível determinar o accountId para recuperar o vídeo de liveness."
      );
    }


    if (
      !clientId
    ) {
      throw new Error(
        "Não foi possível determinar o clientId para recuperar o vídeo de liveness."
      );
    }


    if (
      !sessionId
    ) {
      throw new Error(
        "Não foi possível determinar o sessionId para recuperar o vídeo de liveness."
      );
    }


    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > 10
    ) {
      throw new Error(
        "A posição facial deve estar entre 1 e 10."
      );
    }


    /*
     * ----------------------------------------------------------
     * Tentar obter o ID real do vídeo.
     *
     * O storageReference pode ser:
     *
     * - um videoId direto;
     * - um objeto serializado;
     * - uma referência textual contendo videoId.
     * ----------------------------------------------------------
     */

    let videoId =
      null;


    const storageReference =
      selected.storageReference;


    if (
      typeof storageReference ===
      "string"
    ) {

      const reference =
        storageReference.trim();


      if (
        reference
      ) {

        /*
         * Caso a referência seja diretamente
         * o ID do vídeo.
         */

        if (
          /^[a-fA-F0-9]{24}$/.test(
            reference
          )
        ) {

          videoId =
            reference;

        } else {

          /*
           * Algumas versões podem guardar
           * JSON serializado como referência.
           */

          try {

            const parsed =
              JSON.parse(
                reference
              );


            if (
              parsed &&
              typeof parsed ===
              "object"
            ) {

              videoId =
                parsed.videoId ||
                parsed.id ||
                parsed._id ||
                null;
            }

          } catch (
            error
          ) {

            /*
             * Não é JSON.
             *
             * Nesse caso usamos a posição abaixo,
             * mantendo o fluxo compatível com o
             * armazenamento atual.
             */
          }
        }

      }

    } else if (
      storageReference &&
      typeof storageReference ===
      "object"
    ) {

      videoId =
        storageReference.videoId ||
        storageReference.id ||
        storageReference._id ||
        null;
    }


    /*
     * ----------------------------------------------------------
     * RECUPERAR DO GRIDFS
     * ----------------------------------------------------------
     *
     * Se temos videoId, ele é preferido.
     *
     * Caso contrário, o serviço procura pelo:
     *
     * accountId + clientId + sessionId + position
     * ----------------------------------------------------------
     */

    const storedVideo =
      await livenessVideoStorageService.get({
        accountId,
        clientId:
          String(
            clientId
          ),
        sessionId:
          String(
            sessionId
          ),
        position,
        videoId:
          videoId ||
          undefined
      });


    if (
      !storedVideo ||
      !Buffer.isBuffer(
        storedVideo.buffer
      ) ||
      !storedVideo.buffer.length
    ) {

      throw new Error(
        `Vídeo de liveness da posição ${position} não foi encontrado no armazenamento.`
      );
    }


    /*
     * ----------------------------------------------------------
     * VALIDAR SE O VÍDEO RECUPERADO É MESMO DA POSIÇÃO
     * SOLICITADA.
     * ----------------------------------------------------------
     */

    const storedPosition =
      Number(
        storedVideo.position
      );


    if (
      Number.isInteger(
        storedPosition
      ) &&
      storedPosition !==
        position
    ) {

      throw new Error(
        `Inconsistência no armazenamento: VFS solicitou a posição ${position}, mas o vídeo recuperado pertence à posição ${storedPosition}.`
      );
    }


    logger.info(
      "Stored liveness video recovered",
      {
        applicationId:
          this.applicationId,

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

        position,

        videoId:
          storedVideo.videoId ||
          videoId ||
          null,

        mimeType:
          storedVideo.mimeType,

        size:
          storedVideo.buffer.length
      }
    );


    return storedVideo;
  }
    /*
   * ============================================================
   * PREPARAR CÂMERA VFS PARA A POSIÇÃO SOLICITADA
   * ============================================================
   *
   * Fluxo:
   *
   * pedido textual VFS
   *        ↓
   * posição já resolvida
   *        ↓
   * vídeo original armazenado
   *        ↓
   * buffer
   *        ↓
   * prepareFromBuffer()
   *        ↓
   * Y4M
   *        ↓
   * activeCameraY4mPath
   *
   * IMPORTANTE:
   *
   * Este método NÃO escolhe a posição.
   * A posição já foi determinada pelo resolver.
   *
   * Também evita reconverter/repreparar o mesmo vídeo
   * várias vezes durante o mesmo checkpoint.
   */

  async prepareFacialCamera(
    application,
    client,
    selected
  ) {
    if (
      !application ||
      !client ||
      !selected
    ) {
      throw new Error(
        "Application, client and selected facial position are required."
      );
    }

    const position =
      Number(
        selected.position
      );

    if (
      !Number.isInteger(position) ||
      position < 1 ||
      position > 10
    ) {
      throw new Error(
        "Invalid facial position for camera preparation."
      );
    }

    /*
     * ----------------------------------------------------------
     * Se esta mesma posição já estiver preparada,
     * não convertemos o vídeo novamente.
     * ----------------------------------------------------------
     */

    if (
      this.activeCameraY4mPath &&
      this.activeCameraPosition === position &&
      this.activeCameraVideoId
    ) {
      logger.info(
        "VFS facial camera already prepared",
        {
          applicationId:
            this.applicationId,

          position,

          videoId:
            this.activeCameraVideoId,

          y4mPath:
            this.activeCameraY4mPath
        }
      );

      return {
        success: true,

        reused: true,

        position,

        videoId:
          this.activeCameraVideoId,

        y4mPath:
          this.activeCameraY4mPath
      };
    }

    /*
     * ----------------------------------------------------------
     * Recuperar o vídeo original.
     * ----------------------------------------------------------
     */

    const storedVideo =
      await this.getStoredFacialVideo(
        application,
        client,
        selected
      );

    if (
      !storedVideo ||
      !Buffer.isBuffer(
        storedVideo.buffer
      ) ||
      !storedVideo.buffer.length
    ) {
      throw new Error(
        `Stored facial video for position ${position} is unavailable.`
      );
    }

    /*
     * ----------------------------------------------------------
     * Identificar o vídeo real.
     * ----------------------------------------------------------
     */

    const videoId =
      storedVideo.videoId ||
      selected.videoId ||
      null;

    /*
     * ----------------------------------------------------------
     * Converter o vídeo original para Y4M.
     *
     * O arquivo original permanece intacto.
     * ----------------------------------------------------------
     */

    const prepared =
      await prepareFromBuffer({
        buffer:
          storedVideo.buffer,

        videoId:
          videoId ||
          `application-${this.applicationId}-position-${position}`,

        position
      });

    if (
      !prepared?.success ||
      !prepared?.path
    ) {
      throw new Error(
        `Could not prepare Y4M camera for facial position ${position}.`
      );
    }

    /*
     * ----------------------------------------------------------
     * Guardar a câmera ativa no adapter.
     *
     * initialize() já utiliza activeCameraY4mPath
     * no argumento:
     *
     * --use-file-for-fake-video-capture=<arquivo.y4m>
     * ----------------------------------------------------------
     */

    this.activeCameraY4mPath =
      prepared.path;

    this.activeCameraVideoId =
      videoId ||
      prepared.videoId ||
      null;

    this.activeCameraPosition =
      position;

    logger.info(
      "VFS facial camera prepared",
      {
        applicationId:
          this.applicationId,

        position,

        label:
          selected.label ||
          null,

        videoId:
          this.activeCameraVideoId,

        y4mPath:
          this.activeCameraY4mPath,

        width:
          prepared.width,

        height:
          prepared.height,

        fps:
          prepared.fps
      }
    );

    return {
      success: true,

      reused: false,

      position,

      label:
        selected.label ||
        null,

      videoId:
        this.activeCameraVideoId,

      y4mPath:
        this.activeCameraY4mPath,

      width:
        prepared.width,

      height:
        prepared.height,

      fps:
        prepared.fps
    };
  }
  /*
   * ============================================================
   * FACIAL POSITION RESOLVER
   * ============================================================
   *
   * O Bot1 chama:
   *
   * handleFacialPositionRequest(
   *   application,
   *   client
   * )
   *
   * e não:
   *
   * handleFacialPositionRequest(
   *   position,
   *   imageReference
   * )
   *
   * A resolução é feita usando as posições
   * 1..10 já existentes no Client.
   */

  async handleFacialPositionRequest(
    application,
    client
  ) {
    if (
      !application ||
      !client
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "Application or client is missing."
      };
    }

    const positions =
      Array.isArray(
        client.facialPositions
      )
        ? client.facialPositions
        : [];

    const validPositions =
      positions.filter(
        position => {
          const number =
            Number(
              position?.position
            );

          return (
            Number.isInteger(
              number
            ) &&
            number >= 1 &&
            number <= 10 &&
            Boolean(
              position?.storageReference
            )
          );
        }
      );

    if (
      !validPositions.length
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "No valid stored facial positions are available.",
        candidates: []
      };
    }

    /*
     * Lê o pedido atual da VFS.
     */
    const request =
      await this.detectFacialPositionRequest();

    if (
      !request.found ||
      !request.description
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "The VFS facial request could not be read unambiguously.",
        candidates: []
      };
    }

    /*
     * O resolver semântico trabalha apenas
     * sobre as posições existentes no Client.
     */
    let FacialService;

    try {
      FacialService =
        require(
          "../facial/facial-service"
        );
    } catch (error) {
      logger.error(
        "Facial service could not be loaded",
        {
          applicationId:
            this.applicationId,
          error:
            error.message
        }
      );

      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",
        reason:
          "Facial position resolver is unavailable."
      };
    }

    const facialService =
      new FacialService();

    const resolved =
      facialService.resolvePositionRequest(
        {
          request:
            request.description,

          positions:
            validPositions
        }
      );

    /*
     * Sem resolução inequívoca,
     * não escolhemos uma imagem por aproximação.
     */
    if (
      !resolved?.resolved
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",

        reason:
          "The VFS facial request could not be mapped unambiguously to one stored position.",

        request:
          request.description,

        candidates:
          resolved?.candidates ||
          [],

        checkpoint:
          this.lastCheckpoint,

        dom:
          this.getDomSummary()
      };
    }

    const selected =
      validPositions.find(
        position =>
          Number(
            position.position
          ) ===
          Number(
            resolved.position
          )
      );

    if (
      !selected?.storageReference
    ) {
      return {
        success: false,
        requiresUser: true,
        unresolved: true,
        state:
          "FACIAL_POSITION_UNRESOLVED",

        reason:
          "Resolved facial position has no secure storage reference.",

        request:
          request.description,

        candidates:
          resolved.candidates ||
          []
      };
    }

    /*
     * Aqui NÃO fazemos upload automático da imagem.
     *
     * O resultado entrega ao fluxo superior
     * a referência segura que corresponde ao
     * pedido da VFS.
     *
     * A entrega efetiva só deve ocorrer caso
     * o checkpoint oficial disponibilize uma
     * operação compatível.
     */
    return {
      success: true,
      requiresUser: false,
      unresolved: false,

      state:
        "FACIAL_POSITION_RESOLVED",

      request:
        request.description,

      position:
        Number(
          selected.position
        ),

      label:
        selected.label ||
        null,

      storageReference:
        selected.storageReference,

      score:
        resolved.score,

      matchedTerms:
        resolved.matchedTerms ||
        [],

      candidates:
        resolved.candidates ||
        [],

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * CALENDAR / RADAR
   * ============================================================
   */

  async openCalendar() {
    await this.navigate(
      `${VFS_BASE_URL}/services`
    );

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    return {
      success: true,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  async checkAvailability(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return {
        slots: [],
        requiresUser: true,
        captchaRequired: true,
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        slots: [],
        requiresUser: true,
        otpRequired: true,
        state:
          this.state,
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    const slots =
      await this.extractVisibleSlots(
        page,
        application
      );

    this.lastSlotSnapshot =
      slots;

    return {
      slots,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  async extractVisibleSlots(
    page,
    application
  ) {
    const currentUrl =
      page.url();

    if (
      !currentUrl.includes(
        "/services"
      )
    ) {
      return [];
    }

    const raw =
      await page.evaluate(
        () => {
          const elements =
            Array.from(
              document.querySelectorAll(
                "button, a, [role='button'], [role='option'], td, li, div"
              )
            );

          return elements
            .map(
              element => {
                const text =
                  element.innerText ||
                  element.textContent ||
                  "";

                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                return {
                  text:
                    text.trim(),

                  tag:
                    element.tagName
                      .toLowerCase(),

                  id:
                    element.id ||
                    null,

                  name:
                    element.getAttribute(
                      "name"
                    ) || null,

                  role:
                    element.getAttribute(
                      "role"
                    ) || null,

                  disabled:
                    Boolean(
                      element.disabled
                    ),

                  visible:
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !==
                      "none" &&
                    style.visibility !==
                      "hidden"
                };
              }
            )
            .filter(
              item =>
                item.visible &&
                !item.disabled &&
                item.text
            );
        }
      );

    const results = [];

    for (
      const item of raw
    ) {
      const parsed =
        this.parseSlotText(
          item.text
        );

      if (!parsed) {
        continue;
      }

      results.push({
        date:
          parsed.date,

        time:
          parsed.time,

        label:
          item.text,

        selectorData: {
          id:
            item.id,

          name:
            item.name,

          role:
            item.role,

          tag:
            item.tag
        }
      });
    }

    return this.deduplicateSlots(
      results
    );
  }

  parseSlotText(text) {
    if (!text) {
      return null;
    }

    const value =
      String(text)
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    let match =
      value.match(
        /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/
      );

    let date = null;

    if (match) {
      date =
        `${match[1]}-${String(
          match[2]
        ).padStart(2, "0")}-${String(
          match[3]
        ).padStart(2, "0")}`;
    }

    if (!date) {
      match =
        value.match(
          /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/
        );

      if (match) {
        date =
          `${match[3]}-${String(
            match[2]
          ).padStart(2, "0")}-${String(
            match[1]
          ).padStart(2, "0")}`;
      }
    }

    const timeMatch =
      value.match(
        /\b([01]?\d|2[0-3]):([0-5]\d)\b/
      );

    const time =
      timeMatch
        ? `${String(
            timeMatch[1]
          ).padStart(2, "0")}:${timeMatch[2]}`
        : null;

    if (!date) {
      return null;
    }

    return {
      date,
      time
    };
  }

  deduplicateSlots(
    slots
  ) {
    const seen =
      new Set();

    return slots.filter(
      slot => {
        const key =
          `${slot.date}|${slot.time || ""}`;

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );
  }

  async revalidateSlot(
    slot
  ) {
    const result =
      await this.checkAvailability(
        null
      );

    const found =
      result.slots.find(
        candidate =>
          candidate.date ===
            slot.date &&
          (
            !slot.time ||
            candidate.time ===
              slot.time
          )
      );

    return {
      success:
        Boolean(found),

      slot:
        found || null,

      state:
        this.state,

      slots:
        result.slots
    };
  }

  async selectSlot(
    slot,
    application
  ) {
    if (
      !slot ||
      !slot.date
    ) {
      throw new Error(
        "Invalid slot"
      );
    }

    const page =
      await this.ensurePage();

    const candidates =
      await page.evaluate(
        target => {
          const normalize =
            value =>
              String(value || "")
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .toLowerCase();

          const elements =
            Array.from(
              document.querySelectorAll(
                "button, a, [role='button'], [role='option'], td, li"
              )
            );

          const date =
            normalize(
              target.date
            );

          const time =
            normalize(
              target.time || ""
            );

          const dateParts =
            date.split("-");

          const dateVariants = [
            date,

            `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`,

            `${Number(
              dateParts[2]
            )}/${dateParts[1]}/${dateParts[0]}`,

            `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
          ];

          return elements
            .filter(
              element => {
                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const text =
                  normalize(
                    element.innerText ||
                    element.textContent ||
                    ""
                  );

                const hasDate =
                  dateVariants.some(
                    variant =>
                      text.includes(
                        normalize(
                          variant
                        )
                      )
                  );

                const hasTime =
                  !time ||
                  text.includes(
                    time
                  );

                return (
                  hasDate &&
                  hasTime
                );
              }
            )
            .map(
              element => ({
                id:
                  element.id ||
                  null,

                name:
                  element.getAttribute(
                    "name"
                  ) || null,

                text:
                  (
                    element.innerText ||
                    element.textContent ||
                    ""
                  ).trim()
              })
            );
        },
        {
          date:
            slot.date,

          time:
            slot.time ||
            null
        }
      );

    if (
      candidates.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          candidates.length === 0
            ? "The requested slot is no longer visible."
            : "Multiple VFS elements match the requested slot.",

        candidates
      };
    }

    const selector =
      this.buildSelector(
        candidates[0]
      );

    if (!selector) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "The matched VFS slot has no safe selector."
      };
    }

    await page.click(
      selector
    );

    await page
      .waitForNetworkIdle({
        idleTime: 400,
        timeout: 8000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,

      selected:
        slot,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * DOCUMENT UPLOAD
   * ============================================================
   */

  async uploadPassport(
    passportPath,
    metadata = {}
  ) {
    if (!passportPath) {
      return {
        success: false,
        reason:
          "Passport storage reference is missing."
      };
    }

    const stat =
      await fs.promises.stat(
        passportPath
      );

    if (
      stat.size >
      MAX_PASSPORT_BYTES
    ) {
      throw new Error(
        "Passport document exceeds 2 MB limit"
      );
    }

    const page =
      await this.ensurePage();

    const inputs =
      await page.$$(
        "input[type='file']"
      );

    if (
      inputs.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          inputs.length === 0
            ? "No passport upload input detected."
            : "Multiple upload inputs detected; passport target is ambiguous.",

        dom:
          this.getDomSummary()
      };
    }

    const input =
      inputs[0];

    const accept =
      await input.evaluate(
        node =>
          node.getAttribute(
            "accept"
          ) || ""
      ).catch(
        () => ""
      );

    if (
      accept &&
      !this.acceptsPassportFile(
        accept,
        path.extname(
          passportPath
        )
      )
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "The VFS upload field does not accept the stored passport file type.",
        accept
      };
    }

    await input.uploadFile(
      passportPath
    );

    return {
      success: true,
      uploaded: true,
      size:
        stat.size,
      metadata
    };
  }

  acceptsPassportFile(
    accept,
    extension
  ) {
    const normalized =
      String(
        accept
      ).toLowerCase();

    if (
      normalized.includes(
        "*/*"
      )
    ) {
      return true;
    }

    if (
      extension === ".pdf" &&
      normalized.includes(
        "application/pdf"
      )
    ) {
      return true;
    }

    if (
      [".jpg", ".jpeg"].includes(
        extension
      ) &&
      (
        normalized.includes(
          "image/jpeg"
        ) ||
        normalized.includes(
          "image/*"
        )
      )
    ) {
      return true;
    }

    if (
      extension === ".png" &&
      (
        normalized.includes(
          "image/png"
        ) ||
        normalized.includes(
          "image/*"
        )
      )
    ) {
      return true;
    }

    return false;
  }

  /*
   * ============================================================
   * CONTINUE
   * ============================================================
   */

  async continueApplication(
    application
  ) {
    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return this.checkpointResult(
        "OTP_REQUIRED",
        "VFS OTP checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS facial-position checkpoint detected before continuation.",
        checkpoint:
          this.lastCheckpoint,
        dom:
          this.getDomSummary()
      };
    }

    const result =
      await this.clickUnambiguousAction(
        [
          "continue",
          "proceed",
          "next"
        ]
      );

    if (
      !result.clicked
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "No unambiguous VFS continue action was found.",
        dom:
          this.getDomSummary()
      };
    }

    const page =
      await this.ensurePage();

    await page
      .waitForNetworkIdle({
        idleTime: 500,
        timeout: 10000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    return {
      success: true,
      state:
        this.state,
      checkpoint:
        this.lastCheckpoint,
      dom:
        this.getDomSummary()
    };
  }

  /*
   * ============================================================
   * PAYMENT
   * ============================================================
   */

  async getPaymentDetails(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    const url =
      page.url();

    const text =
      await page.evaluate(
        () =>
          document.body?.innerText ||
          ""
      ).catch(
        () => ""
      );

    const urlData =
      this.parseQueryParameters(
        url
      );

    const textReference =
      this.extractTextValue(
        text,
        [
          "RequestRefNo",
          "Reference",
          "Reference No",
          "Payment Reference"
        ]
      );

    const textAmount =
      this.extractTextValue(
        text,
        [
          "Amount",
          "Total Amount",
          "Fee"
        ]
      );

    const textCurrency =
      this.extractTextValue(
        text,
        [
          "Currency"
        ]
      );

    const textDeadline =
      this.extractTextValue(
        text,
        [
          "Deadline",
          "Payment Deadline",
          "Due Date"
        ]
      );

    const paymentStatus =
      urlData.PaymentStatus ||
      this.extractTextValue(
        text,
        [
          "PaymentStatus",
          "Payment Status"
        ]
      ) ||
      null;

    return {
      reference:
        urlData.RequestRefNo ||
        textReference ||
        null,

      transactionId:
        urlData.TransactionId ||
        null,

      entity:
        this.extractTextValue(
          text,
          [
            "Entity",
            "Entity Number"
          ]
        ) ||
        null,

      paymentStatus,

      amount:
        textAmount ||
        null,

      currency:
        textCurrency ||
        null,

      deadline:
        textDeadline ||
        null,

      confirmationUrl:
        this.isConfirmationUrl(
          url
        )
          ? url
          : null,

      url,
      text
    };
  }

  async getReference() {
    const details =
      await this.getPaymentDetails();

    return (
      details.reference ||
      null
    );
  }

  async getEntity() {
    const details =
      await this.getPaymentDetails();

    return (
      details.entity ||
      null
    );
  }

  async finalizeBooking(
    application,
    payment
  ) {
    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    if (
      this.state ===
      "CONFIRMATION"
    ) {
      return {
        success: true,
        state:
          this.state
      };
    }

    await this.detectCheckpoint();

    if (
      this.lastCheckpoint?.type ===
      "CAPTCHA_REQUIRED"
    ) {
      return this.checkpointResult(
        "CAPTCHA_REQUIRED",
        "Official VFS security checkpoint detected."
      );
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        otpRequired: true,
        reason:
          "VFS is requesting OTP before final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS requested facial verification before final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    const action =
      await this.clickUnambiguousAction(
        [
          "book appointment",
          "confirm appointment",
          "confirm booking",
          "submit",
          "continue"
        ]
      );

    if (
      !action.clicked
    ) {
      return {
        success: false,
        requiresUser: true,

        reason:
          "The final VFS booking action could not be identified unambiguously.",

        state:
          this.state,

        payment,

        dom:
          this.getDomSummary()
      };
    }

    const page =
      await this.ensurePage();

    await page
      .waitForNetworkIdle({
        idleTime: 700,
        timeout: 15000
      })
      .catch(() => {});

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(() => {});

    await this.detectCheckpoint();

    if (
      this.state ===
      "CONFIRMATION"
    ) {
      return {
        success: true,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "OTP_REQUIRED"
    ) {
      return {
        success: false,
        requiresUser: true,
        otpRequired: true,
        reason:
          "VFS requested OTP during final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    if (
      this.lastCheckpoint?.type ===
      "FACIAL_POSITION"
    ) {
      return {
        success: false,
        requiresUser: true,
        facialRequired: true,
        reason:
          "VFS requested facial verification during final booking.",
        checkpoint:
          this.lastCheckpoint,
        state:
          this.state
      };
    }

    return {
      success: false,
      requiresUser: true,

      reason:
        "VFS did not reach its official confirmation page.",

      state:
        this.state,

      payment,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  async getConfirmation(
    application
  ) {
    const page =
      await this.ensurePage();

    await this.detectState();

    const url =
      page.url();

    const parsed =
      this.parseQueryParameters(
        url
      );

    const isConfirmation =
      this.state ===
        "CONFIRMATION" ||
      url.includes(
        "/confirmation"
      );

    if (
      !isConfirmation
    ) {
      return {
        confirmed: false,
        success: false,

        paymentStatus:
          parsed.PaymentStatus ||
          null,

        requestReference:
          parsed.RequestRefNo ||
          null,

        transactionId:
          parsed.TransactionId ||
          null,

        confirmationUrl:
          null
      };
    }

    const paymentStatus =
      parsed.PaymentStatus ||
      null;

    const confirmed =
      String(
        paymentStatus
      ).toLowerCase() ===
        "true" ||
      this.state ===
        "CONFIRMATION";

    return {
      confirmed,

      success:
        confirmed,

      paymentStatus,

      requestReference:
        parsed.RequestRefNo ||
        null,

      transactionId:
        parsed.TransactionId ||
        null,

      confirmationUrl:
        url
    };
  }

  /*
   * ============================================================
   * SAFE DOM ACTIONS
   * ============================================================
   */

  async clickUnambiguousAction(
    labels
  ) {
    const page =
      await this.ensurePage();

    const candidates =
      await page.evaluate(
        wantedLabels => {
          const normalize =
            value =>
              String(value || "")
                .trim()
                .toLowerCase()
                .replace(
                  /\s+/g,
                  " "
                );

          const wanted =
            wantedLabels.map(
              normalize
            );

          return Array.from(
            document.querySelectorAll(
              "button, a, [role='button']"
            )
          )
            .filter(
              element => {
                const rect =
                  element.getBoundingClientRect();

                const style =
                  window.getComputedStyle(
                    element
                  );

                if (
                  element.disabled ||
                  rect.width <= 0 ||
                  rect.height <= 0 ||
                  style.display ===
                    "none" ||
                  style.visibility ===
                    "hidden"
                ) {
                  return false;
                }

                const text =
                  normalize(
                    [
                      element.innerText,
                      element.getAttribute(
                        "aria-label"
                      ),
                      element.getAttribute(
                        "title"
                      )
                    ].join(" ")
                  );

                return wanted.some(
                  label =>
                    text === label ||
                    text.includes(
                      label
                    )
                );
              }
            )
            .map(
              element => ({
                id:
                  element.id ||
                  null,

                name:
                  element.getAttribute(
                    "name"
                  ) || null,

                text:
                  (
                    element.innerText ||
                    element.getAttribute(
                      "aria-label"
                    ) ||
                    ""
                  ).trim()
              })
            );
        },
        labels
      );

    if (
      candidates.length !== 1
    ) {
      return {
        clicked: false,

        ambiguous:
          candidates.length > 1,

        candidates
      };
    }

    const selector =
      this.buildSelector(
        candidates[0]
      );

    if (!selector) {
      return {
        clicked: false,
        ambiguous: false,
        reason:
          "Matched action has no safe selector."
      };
    }

    await page.click(
      selector
    );

    return {
      clicked: true,
      selector,
      candidate:
        candidates[0]
    };
  }

  /*
   * ============================================================
   * CHECKPOINT DETECTION
   * ============================================================
   */
async detectCheckpoint() {
  const page =
    await this.ensurePage();

  const data =
    await page.evaluate(terms => {
      const normalize =
        value =>
          String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(
              /[\u0300-\u036f]/g,
              ""
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();

      const body =
        normalize(
          document.body?.innerText ||
            ""
        );

      const inputs =
        Array.from(
          document.querySelectorAll(
            "input, textarea, select"
          )
        ).map(
          element => ({
            type:
              normalize(
                element.getAttribute(
                  "type"
                )
              ),

            name:
              normalize(
                element.getAttribute(
                  "name"
                )
              ),

            id:
              normalize(
                element.id
              ),

            placeholder:
              normalize(
                element.getAttribute(
                  "placeholder"
                )
              ),

            aria:
              normalize(
                element.getAttribute(
                  "aria-label"
                )
              )
          })
        );

      const has =
        list =>
          list.some(
            term =>
              body.includes(
                normalize(term)
              )
          );

      /*
       * ========================================================
       * OTP
       * ========================================================
       */

      const otpInput =
        inputs.some(
          input =>
            [
              input.name,
              input.id,
              input.placeholder,
              input.aria
            ].some(
              value =>
                terms.otp.some(
                  term =>
                    value.includes(
                      normalize(term)
                    )
                )
            )
        );

      /*
       * ========================================================
       * CHECKPOINTS GERAIS
       * ========================================================
       */

      const captcha =
        has(terms.captcha);

      const facialGeneric =
        has(terms.facial);

      return {
        body,

        otpInput,

        captcha,

        facialGeneric
      };
    }, CHECKPOINT_TERMS);


  /*
   * ============================================================
   * 1. CAPTCHA TEM PRIORIDADE ABSOLUTA
   * ============================================================
   */

  if (
    data.captcha
  ) {
    this.lastCheckpoint = {
      type:
        "CAPTCHA_REQUIRED",

      reason:
        "Official VFS CAPTCHA/security verification detected."
    };

    return this.lastCheckpoint;
  }


  /*
   * ============================================================
   * 2. OTP
   * ============================================================
   */

  if (
    data.otpInput ||
    data.body.includes("otp") ||
    data.body.includes(
      "one time password"
    )
  ) {
    this.lastCheckpoint = {
      type:
        "OTP_REQUIRED",

      reason:
        "Official VFS OTP checkpoint detected."
    };

    return this.lastCheckpoint;
  }


  /*
   * ============================================================
   * 3. CÂMERA
   * ============================================================
   *
   * Só consideramos a etapa facial concreta depois de
   * a VFS ter realmente aberto a câmera.
   */

  const cameraState =
    await this.getFacialCameraState();


  /*
   * ============================================================
   * 4. INSTRUÇÃO FACIAL CONCRETA
   * ============================================================
   */

  if (
    cameraState.opened &&
    cameraState.active
  ) {

    const request =
      await this.detectFacialPositionRequest();

    if (
      request &&
      request.description
    ) {

      this.lastCheckpoint = {
        type:
          "FACIAL_POSITION",

        reason:
          "Official VFS facial-position instruction detected.",

        request
      };

      return this.lastCheckpoint;
    }
  }


  /*
   * ============================================================
   * 5. NÃO HÁ CHECKPOINT FACIAL CONCRETO
   * ============================================================
   *
   * Atenção:
   *
   * "facial", "liveness", "selfie" ou
   * "facial verification" sozinhos NÃO significam
   * que a VFS está pedindo uma posição.
   */

  this.lastCheckpoint = null;

  return null;
}
      
  /*
   * ============================================================
   * DOM INSPECTION
   * ============================================================
   */

  async inspectCurrentDom(
    options = {}
  ) {
    const page =
      await this.ensurePage();

    const inspection =
      await this.domInspector.inspect(
        page,
        {
          includeHtml:
            options.includeHtml ===
            true
        }
      );

    this.lastDomInspection =
      inspection;

    return inspection;
  }

  getLastDomInspection() {
    return (
      this.lastDomInspection ||
      null
    );
  }

  getDomSummary() {
    const inspection =
      this.lastDomInspection;

    if (!inspection) {
      return null;
    }

    return {
      url:
        inspection.url ||
        null,

      title:
        inspection.title ||
        null,

      inspectedAt:
        inspection.inspectedAt ||
        null,

      summary:
        inspection.summary ||
        null
    };
  }

  async getCurrentDomInspection() {
    if (
      !this.lastDomInspection
    ) {
      await this.inspectCurrentDom();
    }

    return this.lastDomInspection;
  }

  /*
   * ============================================================
   * HELPERS
   * ============================================================
   */

  checkpointResult(
    type,
    reason
  ) {
    return {
      success: false,

      requiresUser: true,

      captchaRequired:
        type ===
        "CAPTCHA_REQUIRED",

      otpRequired:
        type ===
        "OTP_REQUIRED",

      facialRequired:
        type ===
        "FACIAL_POSITION",

      reason,

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary()
    };
  }

  parseQueryParameters(
    url
  ) {
    try {
      const parsed =
        new URL(url);

      return {
        PaymentStatus:
          parsed.searchParams.get(
            "PaymentStatus"
          ),

        RequestRefNo:
          parsed.searchParams.get(
            "RequestRefNo"
          ),

        TransactionId:
          parsed.searchParams.get(
            "TransactionId"
          ),

        token:
          parsed.searchParams.get(
            "token"
          )
      };
    } catch {
      return {};
    }
  }

  isConfirmationUrl(
    url
  ) {
    return String(
      url || ""
    ).includes(
      "/confirmation"
    );
  }

  extractTextValue(
    text,
    labels
  ) {
    if (!text) {
      return null;
    }

    const lines =
      String(text)
        .split(/\r?\n/)
        .map(
          line =>
            line.trim()
        )
        .filter(Boolean);

    for (
      const label of labels
    ) {
      const exact =
        new RegExp(
          `^${this.escapeRegex(
            label
          )}\\s*[:\\-]\\s*(.+)$`,
          "i"
        );

      const found =
        lines.find(
          line =>
            exact.test(line)
        );

      if (found) {
        const match =
          found.match(
            exact
          );

        if (
          match?.[1]
        ) {
          return match[1].trim();
        }
      }

      const partial =
        lines.find(
          line =>
            line
              .toLowerCase()
              .includes(
                label.toLowerCase()
              )
        );

      if (partial) {
        const value =
          partial
            .replace(
              new RegExp(
                this.escapeRegex(
                  label
                ),
                "i"
              ),
              ""
            )
            .replace(
              /^[:\-\s]+/,
              ""
            )
            .trim();

        if (value) {
          return value;
        }
      }
    }

    return null;
  }

  escapeRegex(
    value
  ) {
    return String(
      value
    ).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
  }

  escapeCss(
    value
  ) {
    return String(
      value
    ).replace(
      /([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g,
      "\\$1"
    );
  }

  escapeCssAttribute(
    value
  ) {
    return String(
      value
    )
      .replace(
        /\\/g,
        "\\\\"
      )
      .replace(
        /"/g,
        '\\"'
      );
  }

  buildSelector(
    data
  ) {
    if (!data) {
      return null;
    }

    if (data.id) {
      return `#${this.escapeCss(
        data.id
      )}`;
    }

    if (data.name) {
      return `[name="${this.escapeCssAttribute(
        data.name
      )}"]`;
    }

    return null;
  }

  async detectState() {
    if (!this.page) {
      this.state =
        "UNKNOWN";

      return this.state;
    }

    const url =
      this.page.url();

    if (
      url.includes(
        "/login"
      )
    ) {
      this.state =
        "LOGIN";
    } else if (
      url.includes(
        "/dashboard"
      )
    ) {
      this.state =
        "DASHBOARD";
    } else if (
      url.includes(
        "/application-detail"
      )
    ) {
      this.state =
        "APPLICATION_DETAIL";
    } else if (
      url.includes(
        "/your-details"
      )
    ) {
      this.state =
        "YOUR_DETAILS";
    } else if (
      url.includes(
        "/fv-instructions"
      )
    ) {
      this.state =
        "FACIAL";
    } else if (
      url.includes(
        "/services"
      )
    ) {
      this.state =
        "SERVICES";
    } else if (
      url.includes(
        "/review-pay"
      )
    ) {
      this.state =
        "REVIEW_PAY";
    } else if (
      url.includes(
        "/book-appointment"
      )
    ) {
      this.state =
        "BOOK_APPOINTMENT";
    } else if (
      url.includes(
        "/confirmation"
      )
    ) {
      this.state =
        "CONFIRMATION";
    } else {
      this.state =
        "UNKNOWN";
    }

    return this.state;
  }

  async close() {
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch {}

    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {}

    this.page = null;
    this.context = null;
    this.browser = null;

    this.initialized = false;
    this.state = "UNKNOWN";

    this.lastDomInspection =
      null;

    this.lastCheckpoint =
      null;

    this.lastSlotSnapshot =
      [];

    logger.info(
      "VFS browser closed",
      {
        applicationId:
          this.applicationId
      }
    );
  }
}

module.exports =
  VfsPuppeteerAdapter;
