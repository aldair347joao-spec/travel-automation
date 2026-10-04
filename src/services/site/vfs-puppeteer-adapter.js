"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
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

const VFS_BASE_URL =
  process.env.VFS_BASE_URL ||
  "https://visa.vfsglobal.com/ago/en/prt";

const DEFAULT_TIMEOUT =
  Number(process.env.VFS_NAVIGATION_TIMEOUT_MS) || 120000;

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
    this.frameDiagnosticsAttached = false;
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
        /*
     * ============================================================
     * KEEP-ALIVE DO RADAR
     * ============================================================
     *
     * O Bot2 pode permanecer vários minutos aguardando uma vaga.
     *
     * Não fazemos cliques nem navegação artificial.
     * Apenas movimentamos o mouse periodicamente dentro da
     * janela do navegador para manter a sessão ativa.
     */

    this.radarKeepAliveTimer = null;

    this.radarKeepAliveActive = false;

    this.radarKeepAliveBusy = false;

    this.radarKeepAliveLastAt = null;
    this.radarSessionHealthy = true;
this.radarSessionHealthCheckedAt = null;
this.radarSessionRecoveryRequired = false;
  }

  /*
   * ============================================================
   * BROWSER
   * ============================================================
   */

  async initialize() {
  if (
    this.initialized &&
    this.page &&
    !this.page.isClosed()
  ) {
    return true;
  }

    /*
   * ============================================================
   * SCRAPELESS AGENT BROWSER — PRODUÇÃO
   * ============================================================
   *
   * Render
   *   ↓
   * Bot 1
   *   ↓
   * Puppeteer
   *   ↓
   * Scrapeless Agent Browser
   *   ↓
   * VFS
   *
   * O Chromium é executado remotamente pelo Scrapeless.
   */

  const scrapelessApiKey =
    String(
      process.env.SCRAPELESS_API_KEY || ""
    ).trim();

  if (!scrapelessApiKey) {
    const error =
      new Error(
        "SCRAPELESS_API_KEY is required for VFS production automation."
      );

    error.code =
      "SCRAPELESS_API_KEY_REQUIRED";

    logger.error(
      "Scrapeless API key is missing",
      {
        applicationId:
          this.applicationId
      }
    );

    throw error;
  }

  const sessionTTL =
    Math.max(
      60,
      Math.min(
        Number(
          process.env.SCRAPELESS_SESSION_TTL
        ) || 900,
        900
      )
    );

  const proxyCountry =
    String(
      process.env.SCRAPELESS_PROXY_COUNTRY ||
        "ANY"
    )
      .trim()
      .toUpperCase();

  const sessionPrefix =
    String(
      process.env.SCRAPELESS_SESSION_PREFIX ||
        "travel-automation"
    )
      .trim()
      .replace(
        /[^a-zA-Z0-9_-]/g,
        "-"
      );

  const randomPart =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;

  const sessionName =
    `${sessionPrefix}-${this.applicationId || "unknown"}-${randomPart}`;

  const sessionRecording =
    String(
      process.env.SCRAPELESS_SESSION_RECORDING ||
        "false"
    )
      .trim()
      .toLowerCase() === "true";

  /*
   * Fingerprint é opcional.
   *
   * Se não for configurado, o Agent Browser
   * gera automaticamente um fingerprint para a sessão.
   */
  const fingerprint =
    String(
      process.env.SCRAPELESS_FINGERPRINT || ""
    ).trim();

  const query =
    new URLSearchParams({
      token:
        scrapelessApiKey,

      sessionTTL:
        String(sessionTTL),

      sessionName,

      proxyCountry,

      sessionRecording:
        String(sessionRecording)
    });

  if (fingerprint) {
    query.set(
      "fingerprint",
      fingerprint
    );
  }

  const browserWSEndpoint =
    `wss://browser.scrapeless.com/api/v2/browser?${query.toString()}`;

  /*
   * Nunca registrar a API key nem a URL completa do WebSocket.
   */
  logger.info(
    "Connecting to Scrapeless Agent Browser",
    {
      applicationId:
        this.applicationId,

      sessionName,

      sessionTTL,

      proxyCountry,

      sessionRecording,

      remoteBrowser:
        true
    }
  );

  let connectAttempts = 0;

  const maxConnectAttempts = 3;

  while (
    !this.browser &&
    connectAttempts < maxConnectAttempts
  ) {
    connectAttempts += 1;

    try {
      logger.info(
        "Scrapeless Agent Browser connection attempt",
        {
          applicationId:
            this.applicationId,

          attempt:
            connectAttempts,

          maxAttempts:
            maxConnectAttempts
        }
      );

      this.browser =
        await puppeteer.connect({
          browserWSEndpoint,

          defaultViewport: {
            width: 1440,
            height: 900
          },

          protocolTimeout:
            120000
        });

      logger.info(
        "Scrapeless Agent Browser connected successfully",
        {
          applicationId:
            this.applicationId,

          attempt:
            connectAttempts,

          sessionName
        }
      );

    } catch (error) {
      const errorMessage =
        error?.message ||
        String(error);

      logger.error(
        "Scrapeless Agent Browser connection failed",
        {
          applicationId:
            this.applicationId,

          attempt:
            connectAttempts,

          maxAttempts:
            maxConnectAttempts,

          code:
            error?.code || null,

          error:
            errorMessage
        }
      );

      this.browser =
        null;

      if (
        connectAttempts >=
        maxConnectAttempts
      ) {
        throw error;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            2000 * connectAttempts
          )
      );
    }
  }

  if (!this.browser) {
    const error =
      new Error(
        "Scrapeless Agent Browser connection finished without a browser instance."
      );

    error.code =
      "SCRAPELESS_BROWSER_NOT_CONNECTED";

    throw error;
  }

  /*
   * ============================================================
   * PÁGINA PRINCIPAL
   * ============================================================
   *
   * Reutilizamos uma página existente da sessão quando houver.
   */

    try {
    const pages =
      await this.browser.pages();

    const blankPage =
      pages.find(
        candidate => {
          try {
            return (
              candidate &&
              !candidate.isClosed() &&
              candidate.url() ===
                "about:blank"
            );
          } catch {
            return false;
          }
        }
      );

    this.page =
      blankPage ||
      await this.browser.newPage();
    /*
 * ============================================================
 * DIAGNÓSTICO DO CICLO DE VIDA DOS FRAMES
 * ============================================================
 *
 * O VFS pode criar, navegar ou remover iframes durante
 * autenticação, CAPTCHA, Cloudflare e carregamento dinâmico.
 *
 * O erro:
 *
 *   Attempted to use detached Frame
 *
 * significa que algum código tentou utilizar um Frame depois
 * de ele ter sido removido/navegado.
 *
 * Estes listeners servem para identificar exatamente qual
 * frame foi removido antes da operação que falha.
 */

if (
  !this.frameDiagnosticsAttached &&
  this.page
) {
  this.frameDiagnosticsAttached =
    true;

  this.page.on(
    "frameattached",
    frame => {
      try {
        logger.info(
          "VFS FRAME ATTACHED",
          {
            applicationId:
              this.applicationId,

            frameId:
              frame?._id ||
              null,

            url:
              frame.url(),

            isMainFrame:
              frame.isMainFrame(),

            parentUrl:
              frame.parentFrame()?.url() ||
              null
          }
        );
      } catch (
        error
      ) {
        logger.warn(
          "VFS FRAME ATTACHED LOG FAILED",
          {
            applicationId:
              this.applicationId,

            message:
              error?.message ||
              String(error)
          }
        );
      }
    }
  );

  this.page.on(
    "framenavigated",
    frame => {
      try {
        logger.info(
          "VFS FRAME NAVIGATED",
          {
            applicationId:
              this.applicationId,

            frameId:
              frame?._id ||
              null,

            url:
              frame.url(),

            isMainFrame:
              frame.isMainFrame(),

            parentUrl:
              frame.parentFrame()?.url() ||
              null
          }
        );
      } catch (
        error
      ) {
        logger.warn(
          "VFS FRAME NAVIGATION LOG FAILED",
          {
            applicationId:
              this.applicationId,

            message:
              error?.message ||
              String(error)
          }
        );
      }
    }
  );

  this.page.on(
    "framedetached",
    frame => {
      try {
        logger.warn(
          "VFS FRAME DETACHED",
          {
            applicationId:
              this.applicationId,

            frameId:
              frame?._id ||
              null,

            url:
              frame.url(),

            isMainFrame:
              frame.isMainFrame(),

            parentUrl:
              frame.parentFrame()?.url() ||
              null
          }
        );
      } catch (
        error
      ) {
        logger.warn(
          "VFS FRAME DETACHED LOG FAILED",
          {
            applicationId:
              this.applicationId,

            message:
              error?.message ||
              String(error)
          }
        );
      }
    }
  );

  this.page.on(
    "pageerror",
    error => {
      try {
        logger.warn(
          "VFS PAGE ERROR",
          {
            applicationId:
              this.applicationId,

            message:
              error?.message ||
              String(error)
          }
        );
      } catch (
        logError
      ) {
        logger.warn(
          "VFS PAGE ERROR LOG FAILED",
          {
            applicationId:
              this.applicationId,

            message:
              logError?.message ||
              String(logError)
          }
        );
      }
    }
  );

  logger.info(
    "VFS FRAME DIAGNOSTICS ATTACHED",
    {
      applicationId:
        this.applicationId
    }
  );
}

    /*
     * ==========================================================
     * ESTADO DA CÂMERA / MEDIA
     * ==========================================================
     *
     * O navegador agora está remoto.
     *
     * Portanto não usamos:
     *
     * --use-file-for-fake-video-capture
     *
     * O fluxo facial persistente existente continua utilizando
     * o MediaStream criado dentro da própria página.
     */

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

        /*
         * ======================================================
         * CÂMERA PERSISTENTE
         * ======================================================
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

        if (
          navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia ===
            "function"
        ) {
          const originalGetUserMedia =
            navigator.mediaDevices.getUserMedia.bind(
              navigator.mediaDevices
            );

          navigator.mediaDevices.getUserMedia =
            async function (constraints) {
              const mediaState =
                window.__travelAutomationMediaState;

              mediaState.requested =
                true;

              mediaState.constraints =
                constraints || null;

              mediaState.requestedAt =
                new Date().toISOString();

              /*
               * =================================================
               * REUTILIZAR STREAM EXISTENTE
               * =================================================
               */

              if (
                window.__travelAutomationCamera.initialized &&
                window.__travelAutomationCamera.stream
              ) {
                const existingStream =
                  window.__travelAutomationCamera.stream;

                const tracks =
                  typeof existingStream.getTracks ===
                    "function"
                    ? existingStream.getTracks()
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
                      track.readyState ===
                      "live"
                  );

                mediaState.openedAt =
                  mediaState.openedAt ||
                  new Date().toISOString();

                mediaState.tracks =
                  videoTracks.map(
                    track => ({
                      id:
                        track.id ||
                        null,

                      kind:
                        track.kind ||
                        null,

                      readyState:
                        track.readyState ||
                        null,

                      label:
                        track.label ||
                        null
                    })
                  );

                return existingStream;
              }

              /*
               * =================================================
               * CRIAR STREAM PERSISTENTE
               * =================================================
               */

              try {
                const canvas =
                  document.createElement(
                    "canvas"
                  );

                canvas.width =
                  640;

                canvas.height =
                  480;

                const context =
                  canvas.getContext(
                    "2d",
                    {
                      alpha: false
                    }
                  );

                if (!context) {
                  throw new Error(
                    "Could not create persistent camera canvas context."
                  );
                }

                /*
                 * Frame inicial.
                 */

                context.fillStyle =
                  "#000000";

                context.fillRect(
                  0,
                  0,
                  canvas.width,
                  canvas.height
                );

                /*
                 * Stream persistente.
                 */

                const stream =
                  canvas.captureStream(
                    30
                  );

                if (
                  !stream ||
                  typeof stream.getTracks !==
                    "function"
                ) {
                  throw new Error(
                    "Canvas did not produce a valid MediaStream."
                  );
                }

                const videoTracks =
                  stream
                    .getTracks()
                    .filter(
                      track =>
                        track &&
                        track.kind ===
                          "video"
                    );

                if (
                  !videoTracks.length
                ) {
                  throw new Error(
                    "Persistent MediaStream does not contain a video track."
                  );
                }

                const streamId =
                  videoTracks[0].id ||
                  null;

                window.__travelAutomationCamera = {
                  initialized:
                    true,

                  stream,

                  canvas,
                  context,

                  video:
                    null,

                  width:
                    canvas.width,

                  height:
                    canvas.height,

                  fps:
                    30,

                  active:
                    true,

                  streamId,

                  currentPosition:
                    null,

                  currentVideoId:
                    null,

                  lastFrameAt:
                    new Date().toISOString()
                };

                mediaState.opened =
                  true;

                mediaState.active =
                  true;

                mediaState.openedAt =
                  new Date().toISOString();

                mediaState.tracks =
                  videoTracks.map(
                    track => ({
                      id:
                        track.id ||
                        null,

                      kind:
                        track.kind ||
                        null,

                      readyState:
                        track.readyState ||
                        null,

                      label:
                        track.label ||
                        "Travel Automation Persistent Camera"
                    })
                  );

                return stream;

              } catch (error) {
                /*
                 * Mantemos a função original como último recurso.
                 *
                 * Isto evita que uma falha de inicialização
                 * silenciosa quebre completamente o VFS.
                 */

                mediaState.opened =
                  false;

                mediaState.active =
                  false;

                mediaState.error =
                  error?.message ||
                  "Persistent camera initialization failed";

                try {
                  return await originalGetUserMedia(
                    constraints
                  );
                } catch {
                  throw error;
                }
              }
            };
        }
      });

      logger.info(
        "Scrapeless VFS persistent camera layer installed",
        {
          applicationId:
            this.applicationId
        }
      );

    } catch (error) {
      logger.warn(
        "Could not install Scrapeless camera layer",
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
      "Failed to create Scrapeless browser page",
      {
        applicationId:
          this.applicationId,

        error:
          error?.message ||
          String(error)
      }
    );

    try {
      await this.browser.disconnect();
    } catch {}

    this.browser =
      null;

    this.page =
      null;

    throw error;
  }

  /*
   * ============================================================
   * CONTEXTO
   * ============================================================
   */

  this.context =
    this.page.browserContext();

  /*
   * ============================================================
   * PERMISSÕES DE CÂMERA / MICROFONE
   * ============================================================
   */

  try {
    const cameraOrigin =
      new URL(
        VFS_BASE_URL
      ).origin;

    await this.context.overridePermissions(
      cameraOrigin,
      [
        "camera",
        "microphone"
      ]
    );

    logger.info(
      "VFS camera/microphone permissions configured on Scrapeless Browser",
      {
        applicationId:
          this.applicationId,

        origin:
          cameraOrigin
      }
    );

  } catch (error) {
    logger.warn(
      "Could not configure VFS media permissions on Scrapeless Browser",
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
   * ESTADO FINAL
   * ============================================================
   */

  this.initialized =
    true;

  this.state =
    "INITIALIZED";

    logger.info(
    "VFS Puppeteer adapter initialized with Scrapeless Agent Browser",
    {
      applicationId:
        this.applicationId,

      remoteBrowser:
        true
    }
  );

  return true;
}
      
  async solveScrapelessCaptcha() {
    const page =
      await this.ensurePage();

    if (!page) {
      return {
        attempted: false,
        solved: false,
        status: "NO_PAGE"
      };
    }

    const captchaTimeout =
      Number(
        process.env.SCRAPELESS_CAPTCHA_TIMEOUT_MS
      ) || 120000;

    let captchaDetected =
      false;

    let captchaFinished =
      false;

    let captchaFailed =
      false;

    let client =
  null;

let onDetected =
  null;

let onFinished =
  null;

let onFailed =
  null;

const sleep =
  milliseconds =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          milliseconds
        )
    );

try {
      client =
        await page
          .target()
          .createCDPSession();

      /*
       * ========================================================
       * EVENTO: CAPTCHA DETECTADO
       * ========================================================
       */

      onDetected =
      message => {
          captchaDetected =
            true;

          logger.info(
            "Scrapeless CAPTCHA detected",
            {
              applicationId:
                this.applicationId,

              message:
                message || null
            }
          );
        };

      /*
       * ========================================================
       * EVENTO: CAPTCHA RESOLVIDO
       * ========================================================
       */

      onFinished =
        message => {
          captchaFinished =
            true;

          logger.info(
            "Scrapeless CAPTCHA solve finished",
            {
              applicationId:
                this.applicationId,

              message:
                message || null
            }
          );
        };

      /*
       * ========================================================
       * EVENTO: CAPTCHA FALHOU
       * ========================================================
       */

      onFailed =
        message => {
          captchaFailed =
            true;

          logger.warn(
            "Scrapeless CAPTCHA solve failed",
            {
              applicationId:
                this.applicationId,

              message:
                message || null
            }
          );
        };

      client.on(
        "Captcha.detected",
        onDetected
      );

      client.on(
        "Captcha.solveFinished",
        onFinished
      );

      client.on(
        "Captcha.solveFailed",
        onFailed
      );

      /*
       * ========================================================
       * SOLICITAR RESOLUÇÃO OFICIAL
       * ========================================================
       *
       * O Agent Browser já possui o solver integrado.
       *
       * Não implementamos bypass próprio do Cloudflare.
       */

      try {
        await client.send(
          "Captcha.solve"
        );
      } catch (error) {
        logger.warn(
          "Scrapeless Captcha.solve request failed",
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
       * ========================================================
       * AGUARDAR RESULTADO
       * ========================================================
       *
       * Não dependemos somente do evento.
       *
       * Para Cloudflare Challenge, verificamos também
       * se a página de segurança desapareceu e se o
       * formulário VFS apareceu.
       */

      const startedAt =
        Date.now();

      while (
        Date.now() -
          startedAt <
        captchaTimeout
      ) {

        /*
         * Se o solver confirmou sucesso,
         * damos uma pequena janela para a VFS
         * atualizar o DOM.
         */
        if (
          captchaFinished
        ) {
          await sleep(1200);
        }

        /*
         * ======================================================
         * ESTADO ATUAL DA PÁGINA
         * ======================================================
         */

        const pageSnapshot =
          await page
            .evaluate(
              () => {
                const bodyText =
                  String(
                    document.body?.innerText ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();

                return {
                  url:
                    window.location.href,

                  title:
                    document.title || "",

                  bodyText:
                    bodyText.slice(
                      0,
                      2500
                    )
                };
              }
            )
            .catch(
              () => ({
                url:
                  page.url(),

                title:
                  "",

                bodyText:
                  ""
              })
            );

        const normalizedText =
          `${pageSnapshot.title} ${pageSnapshot.bodyText}`
            .toLowerCase();

        /*
         * ======================================================
         * VERIFICAR SE A PÁGINA DE SEGURANÇA AINDA EXISTE
         * ======================================================
         */

        const securityPage =
          normalizedText.includes(
            "just a moment"
          ) ||
          normalizedText.includes(
            "performing security verification"
          ) ||
          normalizedText.includes(
            "checking your browser"
          ) ||
          normalizedText.includes(
            "verify you are human"
          ) ||
          normalizedText.includes(
            "security verification"
          );

        /*
         * ======================================================
         * FORMULÁRIO VFS DISPONÍVEL
         * ======================================================
         */

        const loginForm =
          await this
            .findVfsLoginFields()
            .catch(
              () => null
            );

        const loginReady =
          Boolean(
            loginForm?.email &&
            loginForm?.password
          );

        /*
         * ======================================================
         * SESSÃO JÁ AUTENTICADA
         * ======================================================
         */

        const authenticated =
          this.isAuthenticatedState();

        /*
         * ======================================================
         * SUCESSO
         * ======================================================
         */

        if (
          loginReady
        ) {
          logger.info(
            "Scrapeless VFS challenge cleared — login form available",
            {
              applicationId:
                this.applicationId,

              captchaDetected,

              captchaFinished,

              url:
                pageSnapshot.url
            }
          );

          return {
            attempted:
              true,

            solved:
              true,

            status:
              "LOGIN_FORM_READY"
          };
        }

        if (
          authenticated
        ) {
          logger.info(
            "Scrapeless VFS challenge cleared — authenticated state detected",
            {
              applicationId:
                this.applicationId,

              captchaDetected,

              captchaFinished,

              url:
                pageSnapshot.url
            }
          );

          return {
            attempted:
              true,

            solved:
              true,

            status:
              "AUTHENTICATED"
          };
        }

        /*
         * O desafio terminou, mas a página ainda está
         * a renderizar. Se não há mais sinais de página
         * de segurança, consideramos o desafio limpo.
         */
        if (
          !securityPage &&
          (
            captchaFinished ||
            captchaDetected
          )
        ) {
          logger.info(
            "Scrapeless VFS security challenge cleared",
            {
              applicationId:
                this.applicationId,

              captchaDetected,

              captchaFinished,

              url:
                pageSnapshot.url
            }
          );

          return {
            attempted:
              true,

            solved:
              true,

            status:
              "CHALLENGE_CLEARED"
          };
        }

        if (
          captchaFailed &&
          !securityPage
        ) {
          return {
            attempted:
              true,

            solved:
              true,

            status:
              "CHALLENGE_CLEARED_AFTER_EVENT"
          };
        }

        await sleep(
          1000
        );
      }

      logger.warn(
        "Scrapeless VFS security challenge timeout",
        {
          applicationId:
            this.applicationId,

          captchaDetected,

          captchaFinished,

          captchaFailed,

          timeout:
            captchaTimeout,

          url:
            page.url()
        }
      );

      return {
        attempted:
          true,

        solved:
          false,

        status:
          "TIMEOUT"
      };

    } catch (error) {
      logger.warn(
        "Scrapeless CAPTCHA handling failed",
        {
          applicationId:
            this.applicationId,

          error:
            error?.message ||
            String(error)
        }
      );

      return {
        attempted:
          true,

        solved:
          false,

        status:
          "ERROR",

        error:
          error?.message ||
          String(error)
      };

      } finally {
      if (client) {
        client.off(
          "Captcha.detected",
          onDetected
        );

        client.off(
          "Captcha.solveFinished",
          onFinished
        );

        client.off(
          "Captcha.solveFailed",
          onFailed
        );
      }
    }
  }
  
   /*
   * ============================================================
   * SAÚDE DA SESSÃO VFS DO RADAR
   * ============================================================
   *
   * Esta verificação NÃO fecha o browser.
   *
   * Apenas verifica se a página continua viva e se a VFS
   * aparenta continuar autenticada.
   *
   * Se a sessão tiver expirado, marcamos que é necessária
   * recuperação. O Bot2 fará a recuperação de forma controlada
   * antes da próxima consulta de disponibilidade.
   */

  async checkRadarSessionHealth() {
    const page =
      this.page;

    this.radarSessionHealthCheckedAt =
      new Date();

    if (
      !page ||
      page.isClosed()
    ) {
      this.radarSessionHealthy =
        false;

      this.radarSessionRecoveryRequired =
        true;

      return {
        healthy: false,
        recoveryRequired: true,
        reason: "PAGE_UNAVAILABLE"
      };
    }

    try {
      const snapshot =
        await page.evaluate(
          () => {
            const bodyText =
              (
                document.body?.innerText ||
                ""
              )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .toLowerCase();

            const loginForm =
              Boolean(
                document.querySelector(
                  "input[type='password']"
                )
              ) &&
              Boolean(
                document.querySelector(
                  "input[type='email'], input[name*='email' i], input[name*='username' i]"
                )
              );

            const sessionExpiredTerms = [
              "session expired",
              "session has expired",
              "your session has expired",
              "session timeout",
              "session timed out",
              "login again",
              "please login again",
              "please log in again",
              "sign in again",
              "authentication expired",
              "authentication required"
            ];

            const expired =
              sessionExpiredTerms.some(
                term =>
                  bodyText.includes(term)
              );

            return {
              url:
                window.location.href,

              bodyText:
                bodyText.slice(
                  0,
                  4000
                ),

              loginForm,

              expired
            };
          }
        );

      const url =
        String(
          snapshot?.url ||
          ""
        ).toLowerCase();

      const atLogin =
        url.includes(
          "/login"
        );

      const sessionExpired =
        Boolean(
          snapshot?.expired
        );

      const loginForm =
        Boolean(
          snapshot?.loginForm
        );

      /*
       * A URL /login ou um formulário de login acompanhado
       * de uma mensagem de sessão expirada significa que
       * precisamos recuperar.
       */
      if (
        atLogin ||
        sessionExpired
      ) {
        this.radarSessionHealthy =
          false;

        this.radarSessionRecoveryRequired =
          true;

        logger.warn(
          "VFS radar session requires recovery",
          {
            applicationId:
              this.applicationId,

            url:
              snapshot?.url ||
              null,

            reason:
              atLogin
                ? "LOGIN_PAGE"
                : "SESSION_EXPIRED"
          }
        );

        return {
          healthy: false,
          recoveryRequired: true,
          reason:
            atLogin
              ? "LOGIN_PAGE"
              : "SESSION_EXPIRED"
        };
      }

      this.radarSessionHealthy =
        true;

      this.radarSessionRecoveryRequired =
        false;

      return {
        healthy: true,
        recoveryRequired: false,
        reason: "SESSION_ACTIVE"
      };

    } catch (error) {
      /*
       * Uma falha temporária de avaliação não significa
       * automaticamente que a sessão VFS morreu.
       *
       * Marcamos recuperação apenas se a própria página
       * estiver indisponível.
       */
      const pageUnavailable =
        !this.page ||
        this.page.isClosed();

      this.radarSessionHealthy =
        !pageUnavailable;

      this.radarSessionRecoveryRequired =
        pageUnavailable;

      logger.warn(
        "VFS radar session health check failed",
        {
          applicationId:
            this.applicationId,

          error:
            error?.message ||
            String(error),

          recoveryRequired:
            pageUnavailable
        }
      );

      return {
        healthy:
          !pageUnavailable,

        recoveryRequired:
          pageUnavailable,

        reason:
          pageUnavailable
            ? "PAGE_UNAVAILABLE"
            : "HEALTH_CHECK_ERROR"
      };
    }
  } 
    /*
   * ============================================================
   * RADAR KEEP-ALIVE
   * ============================================================
   */

  async performRadarKeepAlive() {
    if (
      !this.radarKeepAliveActive ||
      this.radarKeepAliveBusy
    ) {
      return false;
    }

    const page =
      this.page;

    if (
      !page ||
      page.isClosed()
    ) {
      this.stopRadarKeepAlive();

      return false;
    }

    this.radarKeepAliveBusy =
      true;

    try {
      const viewport =
        await page.evaluate(() => ({
          width:
            window.innerWidth ||
            1440,

          height:
            window.innerHeight ||
            900
        }));

      const width =
        Math.max(
          200,
          Number(
            viewport?.width
          ) || 1440
        );

      const height =
        Math.max(
          200,
          Number(
            viewport?.height
          ) || 900
        );

      /*
       * Usamos uma pequena área próxima ao canto inferior
       * direito para evitar menus e campos do VFS.
       */

      const x =
        Math.max(
          5,
          width - 8
        );

      const y =
        Math.max(
          5,
          height - 8
        );

      await page.mouse.move(
        x,
        y,
        {
          steps: 4
        }
      );

      /*
       * Pequeno movimento de retorno.
       */

      await page.mouse.move(
        Math.max(
          5,
          x - 4
        ),
        Math.max(
          5,
          y - 4
        ),
        {
          steps: 3
        }
      );
            /*
       * Depois da atividade física, verificamos a sessão.
       *
       * O mouse mantém a atividade.
       * Esta verificação confirma se a autenticação continua
       * válida.
       */

      const health =
        await this.checkRadarSessionHealth();

      if (
        !health.healthy &&
        health.recoveryRequired
      ) {
        logger.warn(
          "VFS radar keep-alive detected session recovery requirement",
          {
            applicationId:
              this.applicationId,

            reason:
              health.reason
          }
        );

        return false;
      }

      this.radarKeepAliveLastAt =
        new Date();

      logger.debug?.(
        "VFS radar keep-alive mouse movement",
        {
          applicationId:
            this.applicationId
        }
      );

      return true;

    } catch (error) {
      logger.warn(
        "VFS radar keep-alive failed",
        {
          applicationId:
            this.applicationId,

          error:
            error?.message ||
            String(error)
        }
      );

      return false;

    } finally {
      this.radarKeepAliveBusy =
        false;
    }
  }


  startRadarKeepAlive() {
    if (
      this.radarKeepAliveActive
    ) {
      return;
    }

    this.radarKeepAliveActive =
      true;

    /*
     * Primeira atividade imediatamente.
     */

    this.performRadarKeepAlive()
      .catch(() => {});

    /*
     * Muito abaixo dos 5 minutos.
     *
     * O intervalo pode ser ajustado pelo Render:
     *
     * VFS_RADAR_KEEPALIVE_MS
     *
     * Padrão: 60 segundos.
     */

    const intervalMs =
      Math.max(
        15000,
        Number(
          process.env.VFS_RADAR_KEEPALIVE_MS
        ) || 60000
      );

    this.radarKeepAliveTimer =
      setInterval(
        () => {
          this.performRadarKeepAlive()
            .catch(() => {});
        },
        intervalMs
      );

    logger.info(
      "VFS radar keep-alive started",
      {
        applicationId:
          this.applicationId,

        intervalMs
      }
    );
  }


  stopRadarKeepAlive() {
    this.radarKeepAliveActive =
      false;

    if (
      this.radarKeepAliveTimer
    ) {
      clearInterval(
        this.radarKeepAliveTimer
      );

      this.radarKeepAliveTimer =
        null;
    }

    this.radarKeepAliveBusy =
      false;

    logger.info(
      "VFS radar keep-alive stopped",
      {
        applicationId:
          this.applicationId
      }
    );
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
  !currentUrl.includes("/login")
) {
  await this.navigate(
    `${VFS_BASE_URL}/login`
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

    logger.info(
    "VFS CAPTCHA detected — requesting Scrapeless official solver",
    {
      applicationId:
        applicationId
    }
  );

  const captchaResult =
    await this.solveScrapelessCaptcha();

  /*
   * Se o Browser API resolveu o desafio,
   * damos tempo para a VFS atualizar a página.
   */
  if (
    captchaResult.solved ===
    true
  ) {

    await page
      .waitForNetworkIdle({
        idleTime:
          700,

        timeout:
          15000
      })
      .catch(
        () => {}
      );

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(
        () => {}
      );

    await this.detectCheckpoint();

    /*
     * CAPTCHA desapareceu:
     * continuamos normalmente.
     */
    if (
      this.lastCheckpoint?.type !==
      "CAPTCHA_REQUIRED"
    ) {

      logger.info(
        "VFS CAPTCHA resolved by Scrapeless",
        {
          applicationId:
            applicationId
        }
      );

    } else {

      /*
       * O solver terminou, mas a VFS
       * ainda apresenta o checkpoint.
       */
      logger.warn(
        "Scrapeless reported CAPTCHA solved but VFS still shows CAPTCHA",
        {
          applicationId:
            applicationId
        }
      );
    }
  }

  /*
   * Se ainda existe CAPTCHA depois da tentativa,
   * mantemos o checkpoint oficial.
   */
  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {

    return {
      success:
        false,

      requiresUser:
        true,

      captchaRequired:
        true,

      authenticated:
        false,

      code:
        "CAPTCHA_REQUIRED",

      reason:
        "Scrapeless could not complete the VFS CAPTCHA automatically.",

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary(),

      captchaSolveAttempted:
        captchaResult.attempted,

      captchaSolveStatus:
        captchaResult.status
    };
  }
}
  
  /*
   * ============================================================
   * PROCURAR FORMULÁRIO DE LOGIN
   * ============================================================
   */

      
logger.info(
  "VFS LOGIN PAGE DIAGNOSTIC",
  {
    applicationId,

    url:
      (() => {
        try {
          return page.url();
        } catch {
          return null;
        }
      })(),

    title:
      await page
        .title()
        .catch(
          () => null
        ),

    htmlLength:
      await page
        .content()
        .then(
          html =>
            html?.length ||
            0
        )
        .catch(
          () => 0
        ),

    inputCount:
      await page
        .evaluate(
          () =>
            document.querySelectorAll(
              "input"
            ).length
        )
        .catch(
          () => -1
        ),

    iframeCount:
      await page
        .evaluate(
          () =>
            document.querySelectorAll(
              "iframe"
            ).length
        )
        .catch(
          () => -1
        ),

    buttonCount:
      await page
        .evaluate(
          () =>
            document.querySelectorAll(
              "button"
            ).length
        )
        .catch(
          () => -1
        ),

    bodyText:
      await page
        .evaluate(
          () =>
            String(
              document.body?.innerText ||
              ""
            )
              .replace(
                /\s+/g,
                " "
              )
              .slice(
                0,
                1500
              )
        )
        .catch(
          () => ""
        )
  }
);

/*
 * ============================================================
 * REVERIFICAR CHECKPOINT APÓS A RENDERIZAÇÃO DA PÁGINA
 * ============================================================
 *
 * A VFS/Cloudflare pode terminar a renderização depois
 * da primeira chamada de detectCheckpoint().
 *
 * Por isso verificamos novamente antes de procurar
 * o formulário de login.
 */
await new Promise(
  resolve =>
    setTimeout(
      resolve,
      1000
    )
);

await this.detectCheckpoint();

if (
  this.lastCheckpoint?.type ===
  "CAPTCHA_REQUIRED"
) {

  logger.info(
    "VFS SECURITY VERIFICATION DETECTED AFTER PAGE RENDER",
    {
      applicationId,

      url:
        (() => {
          try {
            return page.url();
          } catch {
            return null;
          }
        })(),

      checkpoint:
        this.lastCheckpoint
    }
  );

  const captchaResult =
    await this.solveScrapelessCaptcha();

  if (
    captchaResult.solved ===
    true
  ) {

    await page
      .waitForNetworkIdle({
        idleTime:
          700,

        timeout:
          15000
      })
      .catch(
        () => {}
      );

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(
        () => {}
      );

    await this.detectCheckpoint();
  }

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {

    return {
      success:
        false,

      requiresUser:
        true,

      captchaRequired:
        true,

      authenticated:
        false,

      code:
        "CAPTCHA_REQUIRED",

      reason:
        "Scrapeless could not complete the VFS CAPTCHA automatically.",

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary(),

      captchaSolveAttempted:
        captchaResult.attempted,

      captchaSolveStatus:
        captchaResult.status
    };
  }
}

let loginForm =
  null;

const loginDetectionAttempts =
  6;
  

for (
  let attempt = 1;
  attempt <=
  loginDetectionAttempts;
  attempt++
) {
  loginForm =
    await this.findVfsLoginFields()
      .catch(
        error => {
          logger.warn(
            "VFS LOGIN FORM DETECTION ATTEMPT FAILED",
            {
              applicationId,
              attempt,
              message:
                error?.message ||
                String(error)
            }
          );

          return null;
        }
      );

  logger.info(
    "VFS LOGIN FORM DETECTION ATTEMPT",
    {
      applicationId,
      attempt,

      emailFieldFound:
        Boolean(
          loginForm?.email
        ),

      passwordFieldFound:
        Boolean(
          loginForm?.password
        ),

      submitFound:
        Boolean(
          loginForm?.submit
        ),

      url:
        page.url(),

      reason:
        "Aguardando a renderização dinâmica do formulário de autenticação VFS."
    }
  );

  if (
    loginForm?.email &&
    loginForm?.password
  ) {
    break;
  }

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        1500
      )
  );
}
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
      checkpoint:
        this.lastCheckpoint,
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

    logger.info(
    "VFS CAPTCHA detected after login submission — requesting Scrapeless official solver",
    {
      applicationId:
        applicationId
    }
  );

  const captchaResult =
    await this.solveScrapelessCaptcha();

  if (
    captchaResult.solved ===
    true
  ) {

    await page
      .waitForNetworkIdle({
        idleTime:
          700,

        timeout:
          15000
      })
      .catch(
        () => {}
      );

    await this.detectState();

    await this.inspectCurrentDom()
      .catch(
        () => {}
      );

    await this.detectCheckpoint();

    logger.info(
      "VFS CAPTCHA solver completed",
      {
        applicationId:
          applicationId,

        status:
          captchaResult.status,

        checkpointAfterSolve:
          this.lastCheckpoint?.type ||
          null
      }
    );
  }

  if (
    this.lastCheckpoint?.type ===
    "CAPTCHA_REQUIRED"
  ) {

    return {
      success:
        false,

      requiresUser:
        true,

      captchaRequired:
        true,

      authenticated:
        false,

      code:
        "CAPTCHA_REQUIRED",

      reason:
  "Scrapeless could not complete the VFS security challenge automatically.",

      state:
        this.state,

      checkpoint:
        this.lastCheckpoint,

      dom:
        this.getDomSummary(),

      captchaSolveAttempted:
        captchaResult.attempted,

      captchaSolveStatus:
        captchaResult.status
    };
  }
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
    const normalize =
      value =>
        String(value || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

    const visible =
      element => {
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

    const selectorFor =
  element => {
    if (!element) {
      return null;
    }

    if (element.id) {
      return `#${CSS.escape(
        element.id
      )}`;
    }

    const name =
      element.getAttribute(
        "name"
      );

    if (name) {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(
        name
      )}"]`;
    }

    /*
     * Alguns elementos da VFS, especialmente o botão
     * Sign In, podem não possuir id nem name.
     *
     * Criamos um seletor temporário único diretamente
     * no elemento para que o Puppeteer consiga encontrá-lo.
     */
    const attribute =
      "data-travel-automation-login-target";

    const existing =
      element.getAttribute(
        attribute
      );

    if (existing) {
      return `[${attribute}="${CSS.escape(
        existing
      )}"]`;
    }

    const value =
      `target-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    element.setAttribute(
      attribute,
      value
    );

    return `[${attribute}="${CSS.escape(
      value
    )}"]`;
  };

    const inputs =
      Array.from(
        document.querySelectorAll(
          "input"
        )
      ).filter(
        visible
      );

    /*
     * ========================================================
     * FORMULÁRIOS
     * ========================================================
     *
     * Primeiro procuramos pares de email/password
     * dentro do MESMO formulário.
     *
     * Isto evita que o texto do container de password
     * seja interpretado como se fosse um campo de email.
     */

    const forms =
      Array.from(
        document.querySelectorAll(
          "form"
        )
      ).filter(
        visible
      );

    const formCandidates = [];

    for (
      const form of forms
    ) {
      const formInputs =
        Array.from(
          form.querySelectorAll(
            "input"
          )
        ).filter(
          visible
        );

      /*
       * ------------------------------------------------------
       * EMAIL
       * ------------------------------------------------------
       *
       * Prioridade:
       *
       * 1. type=email
       * 2. autocomplete=email
       * 3. name/id/placeholder/aria relacionados a email
       * 4. username
       */

      const emailCandidates =
        formInputs.filter(
          element => {
            const type =
              normalize(
                element.getAttribute(
                  "type"
                )
              );

            const autocomplete =
              normalize(
                element.getAttribute(
                  "autocomplete"
                )
              );

            const name =
              normalize(
                element.getAttribute(
                  "name"
                )
              );

            const id =
              normalize(
                element.id
              );

            const placeholder =
              normalize(
                element.getAttribute(
                  "placeholder"
                )
              );

            const aria =
              normalize(
                element.getAttribute(
                  "aria-label"
                )
              );

            /*
             * Um campo password nunca pode ser
             * candidato a email.
             */
            if (
              type === "password"
            ) {
              return false;
            }

            /*
             * type=email é a indicação mais forte.
             */
            if (
              type === "email"
            ) {
              return true;
            }

            if (
              autocomplete ===
              "email"
            ) {
              return true;
            }

            const metadata =
              [
                name,
                id,
                placeholder,
                aria
              ].join(" ");

            return (
              metadata.includes(
                "email"
              ) ||
              metadata.includes(
                "e-mail"
              ) ||
              metadata.includes(
                "username"
              ) ||
              metadata.includes(
                "user name"
              )
            );
          }
        );

      /*
       * ------------------------------------------------------
       * PASSWORD
       * ------------------------------------------------------
       */

      const passwordCandidates =
        formInputs.filter(
          element => {
            const type =
              normalize(
                element.getAttribute(
                  "type"
                )
              );

            const autocomplete =
              normalize(
                element.getAttribute(
                  "autocomplete"
                )
              );

            const name =
              normalize(
                element.getAttribute(
                  "name"
                )
              );

            const id =
              normalize(
                element.id
              );

            const placeholder =
              normalize(
                element.getAttribute(
                  "placeholder"
                )
              );

            const aria =
              normalize(
                element.getAttribute(
                  "aria-label"
                )
              );

            /*
             * type=password é a indicação mais forte.
             */
            if (
              type === "password"
            ) {
              return true;
            }

            if (
              autocomplete ===
              "current-password" ||
              autocomplete ===
              "password"
            ) {
              return true;
            }

            const metadata =
              [
                name,
                id,
                placeholder,
                aria
              ].join(" ");

            return (
              metadata.includes(
                "password"
              ) ||
              metadata.includes(
                "pass word"
              )
            );
          }
        );

      /*
       * Só aceitamos um par inequívoco.
       */
      if (
        emailCandidates.length === 1 &&
        passwordCandidates.length === 1
      ) {
        formCandidates.push({
          form,

          email:
            emailCandidates[0],

          password:
            passwordCandidates[0]
        });
      }
    }

    /*
     * ========================================================
     * ESCOLHER O FORMULÁRIO
     * ========================================================
     */

    let selectedForm = null;

    if (
      formCandidates.length === 1
    ) {
      selectedForm =
        formCandidates[0];
    }

    /*
     * ========================================================
     * FALLBACK
     * ========================================================
     *
     * Algumas versões da VFS podem renderizar os campos sem
     * <form>. Nesse caso procuramos apenas campos fortemente
     * identificados.
     */

    if (
      !selectedForm
    ) {
      const emailByType =
        inputs.filter(
          element =>
            normalize(
              element.getAttribute(
                "type"
              )
            ) === "email"
        );

      const passwordByType =
        inputs.filter(
          element =>
            normalize(
              element.getAttribute(
                "type"
              )
            ) === "password"
        );

      if (
        emailByType.length === 1 &&
        passwordByType.length === 1
      ) {
        selectedForm = {
          form: null,

          email:
            emailByType[0],

          password:
            passwordByType[0]
        };
      }
    }

    /*
     * ========================================================
     * NENHUM LOGIN INEQUÍVOCO
     * ========================================================
     */

    if (
      !selectedForm
    ) {
      return {
        email: null,

        password: null,

        submit: null,

        emailCandidates:
          forms.length
            ? formCandidates.length
            : inputs.filter(
                element =>
                  normalize(
                    element.getAttribute(
                      "type"
                    )
                  ) === "email"
              ).length,

        passwordCandidates:
          forms.length
            ? formCandidates.length
            : inputs.filter(
                element =>
                  normalize(
                    element.getAttribute(
                      "type"
                    )
                  ) === "password"
              ).length,

        reason:
          "No unambiguous email/password pair was found."
      };
    }

    const email =
      selectorFor(
        selectedForm.email
      );

    const password =
      selectorFor(
        selectedForm.password
      );

    if (
      !email ||
      !password
    ) {
      return {
        email: null,

        password: null,

        submit: null,

        reason:
          "Login fields were detected but could not be addressed safely."
      };
    }

    /*
     * ========================================================
     * BOTÃO DE LOGIN
     * ========================================================
     */

    const form =
      selectedForm.form;

    let submitCandidates = [];

    if (form) {
      submitCandidates =
        Array.from(
          form.querySelectorAll(
            "button, input[type='submit']"
          )
        ).filter(
          visible
        );
    } else {
      /*
       * Sem <form>, procuramos botões próximos aos campos.
       */
      const emailParent =
        selectedForm.email
          .parentElement;

      const passwordParent =
        selectedForm.password
          .parentElement;

      const containers =
        [
          emailParent,
          passwordParent,
          emailParent?.parentElement,
          passwordParent?.parentElement
        ].filter(
          Boolean
        );

      const uniqueButtons =
        new Set();

      containers.forEach(
        container => {
          Array.from(
            container.querySelectorAll(
              "button, input[type='submit']"
            )
          )
            .filter(
              visible
            )
            .forEach(
              button =>
                uniqueButtons.add(
                  button
                )
            );
        }
      );

      submitCandidates =
        Array.from(
          uniqueButtons
        );
    }

    const loginButtons =
      submitCandidates.filter(
        element => {
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
        }
      );

    let submit = null;

    if (
      loginButtons.length === 1
    ) {
      submit =
        selectorFor(
          loginButtons[0]
        );
    }

    /*
     * Se não encontramos um botão textual mas existe
     * exatamente um submit no formulário, podemos utilizá-lo.
     */
    if (
      !submit &&
      form
    ) {
      const submitInputs =
        Array.from(
          form.querySelectorAll(
            "button[type='submit'], input[type='submit']"
          )
        ).filter(
          visible
        );

      if (
        submitInputs.length === 1
      ) {
        submit =
          selectorFor(
            submitInputs[0]
          );
      }
    }

    return {
      email,

      password,

      submit,

      emailCandidates:
        1,

      passwordCandidates:
        1
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
            ],

            visaCenter: [
              "visa application centre",
              "visa application center",
              "application centre",
              "application center",
              "visa centre",
              "visa center",
              "centre",
              "center"
            ],

            visaType: [
              "visa type",
              "type of visa",
              "visa category",
              "application type",
              "category"
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

                const labelTexts = [];

                /*
                 * LABEL ligado diretamente ao campo.
                 */
                if (
                  element.id
                ) {
                  const labels =
                    document.querySelectorAll(
                      `label[for="${CSS.escape(
                        element.id
                      )}"]`
                    );

                  labels.forEach(
                    label => {
                      labelTexts.push(
                        label.innerText
                      );
                    }
                  );
                }

                /*
                 * LABEL pai.
                 */
                const parentLabel =
                  element.closest(
                    "label"
                  );

                if (
                  parentLabel
                ) {
                  labelTexts.push(
                    parentLabel.innerText
                  );
                }

                /*
                 * Texto do container imediato.
                 *
                 * Limitamos aos dois níveis mais próximos
                 * para evitar que "Email" faça um campo
                 * de telefone parecer candidato.
                 */
                if (
                  element.parentElement
                ) {
                  labelTexts.push(
                    element.parentElement.innerText
                  );

                  if (
                    element.parentElement
                      .parentElement
                  ) {
                    labelTexts.push(
                      element.parentElement
                        .parentElement
                        .innerText
                    );
                  }
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
                      ...labelTexts
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

          /*
           * Para centro/tipo de visto precisamos de
           * uma única correspondência.
           */
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

    /*
     * ========================================================
     * SELECT
     * ========================================================
     *
     * Centro e tipo de visto normalmente aparecem como
     * dropdowns na VFS.
     */
    if (
      descriptor.selectorData.tag ===
      "select"
    ) {
      const selected =
        await page.$eval(
          selector,
          (
            element,
            requestedValue
          ) => {
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
              normalize(
                requestedValue
              );

            const options =
              Array.from(
                element.options || []
              );

            /*
             * Primeiro tentamos correspondência exata.
             */
            let option =
              options.find(
                item =>
                  normalize(
                    item.value
                  ) === wanted ||
                  normalize(
                    item.textContent
                  ) === wanted
              );

            /*
             * Depois correspondência contendo o valor.
             *
             * Isto permite, por exemplo:
             * SCHENGEN
             * Schengen Visa
             * Schengen Visa Application
             */
            if (!option) {
              option =
                options.find(
                  item => {
                    const optionValue =
                      normalize(
                        item.value
                      );

                    const optionText =
                      normalize(
                        item.textContent
                      );

                    return (
                      optionValue.includes(
                        wanted
                      ) ||
                      optionText.includes(
                        wanted
                      )
                    );
                  }
                );
            }

            if (!option) {
              return {
                selected: false,

                reason:
                  "Requested VFS option was not found."
              };
            }

            element.value =
              option.value;

            element.dispatchEvent(
              new Event(
                "input",
                {
                  bubbles: true
                }
              )
            );

            element.dispatchEvent(
              new Event(
                "change",
                {
                  bubbles: true
                }
              )
            );

            return {
              selected: true,

              value:
                option.value,

              text:
                option.textContent
                  ?.trim() ||
                ""
            };
          },
          String(value)
        );

      if (
        !selected?.selected
      ) {
        return {
          filled: false,

          ambiguous: false,

          reason:
            selected?.reason ||
            "VFS option could not be selected."
        };
      }

      return {
        filled: true,

        ambiguous: false,

        selector:
          descriptor.selectorData,

        selected:
          true,

        value:
          selected.value,

        text:
          selected.text
      };
    }

    /*
     * ========================================================
     * INPUT / TEXTAREA
     * ========================================================
     */

    await page.click(
      selector
    );

    await page.$eval(
      selector,
      element => {
        element.value = "";

        element.dispatchEvent(
          new Event(
            "input",
            {
              bubbles: true
            }
          )
        );

        element.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true
            }
          )
        );
      }
    );

    await page.type(
      selector,
      String(value),
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
    async setVfsVisaCenter(
    application
  ) {
    const center =
      String(
        application?.visaCenter ||
        "Luanda"
      ).trim();

    if (!center) {
      return {
        success: false,
        reason:
          "Visa center is missing from application."
      };
    }

    const result =
      await this.fillKnownField(
        "visaCenter",
        center
      );

    if (
      result?.filled !== true
    ) {
      return {
        success: false,
        reason:
          result?.reason ||
          "VFS visa center could not be selected.",
        ambiguous:
          Boolean(
            result?.ambiguous
          )
      };
    }

    return {
      success: true,
      visaCenter:
        center,
      field:
        result
    };
  }

  async setVfsVisaType(
    application
  ) {
    const visaType =
      String(
        application?.visaType ||
        ""
      )
        .trim()
        .toUpperCase();

    if (
      ![
        "SCHENGEN",
        "NACIONAL"
      ].includes(
        visaType
      )
    ) {
      return {
        success: false,
        reason:
          `Unsupported visa type: ${visaType || "empty"}`
      };
    }

    const result =
      await this.fillKnownField(
        "visaType",
        visaType
      );

    if (
      result?.filled !== true
    ) {
      return {
        success: false,
        reason:
          result?.reason ||
          "VFS visa type could not be selected.",
        ambiguous:
          Boolean(
            result?.ambiguous
          )
      };
    }

    return {
      success: true,
      visaType,
      field:
        result
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
  await prepareFromBuffer({
    buffer:
      stored.buffer,

    videoId:
      stored.videoId ||
      selected.videoId ||
      `application-${this.applicationId}-position-${position}`,

    position,

    filename:
      stored.filename ||
      "liveness.webm",

    mimeType:
      stored.mimeType ||
      "video/webm"
  });

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
          video.loop = true;

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
              const videoTrack =
  camera.stream &&
  typeof camera.stream.getVideoTracks === "function"
    ? camera.stream.getVideoTracks()[0]
    : null;

if (
  videoTrack &&
  typeof videoTrack.requestFrame === "function"
) {
  videoTrack.requestFrame();
}

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
        video.loop = true;

if (
  video.ended
) {
  video.currentTime = 0;
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
      Number(
        selected.position
      );

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
     * ==========================================================
     * IMPEDIR DUAS TROCAS SIMULTÂNEAS
     * ==========================================================
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
       * ========================================================
       * 1. RECUPERAR O VÍDEO CORRETO DO GRIDFS
       * ========================================================
       */

      const stored =
        await this.getStoredFacialVideo(
          application,
          client,
          selected
        );

      if (
        !stored ||
        !Buffer.isBuffer(
          stored.buffer
        ) ||
        stored.buffer.length === 0
      ) {
        throw new Error(
          `No stored facial video available for position ${position}.`
        );
      }

      /*
       * ========================================================
       * 2. PREPARAR O VÍDEO
       * ========================================================
       *
       * IMPORTANTE:
       *
       * prepareFromBuffer() recebe UM ÚNICO OBJETO.
       *
       * A implementação correta no
       * liveness-y4m-service.js é:
       *
       * prepareFromBuffer({
       *   buffer,
       *   videoId,
       *   position
       * })
       *
       * ========================================================
       */

      const prepared =
        await prepareFromBuffer({
          buffer:
            stored.buffer,

          videoId:
            stored.videoId ||
            selected.videoId ||
            `application-${this.applicationId}-position-${position}`,

          position,

          filename:
            stored.filename ||
            "liveness.webm",

          mimeType:
            stored.mimeType ||
            "video/webm"
        });

      if (
        !prepared ||
        !prepared.success ||
        !prepared.path
      ) {
        throw new Error(
          `Could not prepare facial video for position ${position}.`
        );
      }

      /*
       * ========================================================
       * 3. REPRODUZIR NA CÂMERA PERSISTENTE
       * ========================================================
       *
       * NÃO relançamos Chromium.
       *
       * A câmera VFS continua sendo o mesmo MediaStream.
       * Apenas alteramos o conteúdo do canvas.
       */

      const playback =
        await this.playFacialVideoOnPersistentCamera(
          prepared.path,
          position,
          stored.videoId ||
            selected.videoId ||
            prepared.videoId ||
            null
        );

      if (
        !playback ||
        playback.success !== true
      ) {
        throw new Error(
          `Could not activate facial video for position ${position}.`
        );
      }

      /*
       * ========================================================
       * 4. ATUALIZAR ESTADO DO ADAPTER
       * ========================================================
       */

      this.activeCameraY4mPath =
        prepared.path;

      this.activeCameraVideoId =
        stored.videoId ||
        selected.videoId ||
        prepared.videoId ||
        null;

      this.activeCameraPosition =
        position;

      this.facialSession.currentPosition =
        position;

      this.facialSession.sourcePosition =
        position;

      this.facialSession.sourceVideoId =
        this.activeCameraVideoId;

      this.facialSession.sourceLoaded =
        true;

      this.facialSession.sourcePlaying =
        true;

      this.facialSession.videoElementReady =
        true;

      this.facialSession.streamReady =
        true;

      this.facialSession.lastFrameAt =
        new Date().toISOString();

      this.facialSession.switchCompletedAt =
        new Date().toISOString();

      logger.info(
        "VFS facial video switched successfully",
        {
          applicationId:
            this.applicationId,

          position,

          videoId:
            this.activeCameraVideoId,

          y4mPath:
            prepared.path,

          persistentCamera:
            true,

          streamId:
            playback?.streamId ||
            this.facialSession.streamId ||
            null
        }
      );

      return {
        success: true,

        position,

        label:
          selected.label ||
          stored.label ||
          null,

        videoId:
          this.activeCameraVideoId,

        storageReference:
          selected.storageReference ||
          null,

        preparedPath:
          prepared.path,

        persistentCamera:
          true,

        reusedCameraSession:
          true,

        streamId:
          playback?.streamId ||
          this.facialSession.streamId ||
          null,

        readyState:
          playback?.readyState ||
          null,

        duration:
          playback?.duration ||
          null,

        width:
          playback?.width ||
          prepared.width ||
          0,

        height:
          playback?.height ||
          prepared.height ||
          0
      };

    } catch (error) {

      this.facialSession.sourceLoaded =
        false;

      this.facialSession.sourcePlaying =
        false;

      logger.error(
        "VFS persistent facial video switch failed",
        {
          applicationId:
            this.applicationId,

          position,

          error:
            error?.message ||
            String(error)
        }
      );

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
   * PROCESSAR INSTRUÇÃO FACIAL DA VFS
   * ============================================================
   *
   * Fluxo completo:
   *
   * VFS
   *   ↓
   * detectar instrução textual
   *   ↓
   * resolver posição 1..10
   *   ↓
   * recuperar vídeo correto do GridFS
   *   ↓
   * preparar Y4M
   *   ↓
   * disponibilizar câmera simulada
   *
   * IMPORTANTE:
   *
   * Esta função NÃO escolhe uma posição por aproximação.
   * O handleFacialPositionRequest() já faz a resolução
   * semântica e só retorna quando existe correspondência
   * válida.
   *
   * Também NÃO guarda novas tentativas.
   * Os vídeos já foram guardados pelo módulo de liveness.
   * ============================================================
   */

  async processFacialVfsInstruction(
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


    /*
     * ----------------------------------------------------------
     * 1. RESOLVER O PEDIDO ATUAL DA VFS
     * ----------------------------------------------------------
     */

    const resolved =
      await this.handleFacialPositionRequest(
        application,
        client
      );


    /*
     * ----------------------------------------------------------
     * 2. PEDIDO AINDA NÃO PODE SER RESOLVIDO
     * ----------------------------------------------------------
     */

    if (
      !resolved?.success ||
      resolved?.unresolved
    ) {

      return {
        ...resolved,

        success:
          false,

        requiresUser:
          resolved?.requiresUser !== false,

        state:
          resolved?.state ||
          "FACIAL_POSITION_UNRESOLVED"
      };
    }


    const position =
      Number(
        resolved.position
      );


    if (
      !Number.isInteger(
        position
      ) ||
      position < 1 ||
      position > 10
    ) {

      return {
        success: false,

        requiresUser: true,

        unresolved: true,

        state:
          "FACIAL_POSITION_UNRESOLVED",

        reason:
          "Resolved facial position is invalid.",

        request:
          resolved.request ||
          null
      };
    }


    /*
     * ----------------------------------------------------------
     * 3. VERIFICAR SE O MESMO VÍDEO JÁ ESTÁ ATIVO
     * ----------------------------------------------------------
     *
     * Se a VFS continuar perguntando pela mesma posição,
     * não precisamos recuperar nem converter novamente.
     * ----------------------------------------------------------
     */

    if (
      this.activeCameraPosition ===
        position &&
      this.activeCameraY4mPath &&
      this.activeCameraVideoId
    ) {

      logger.info(
        "VFS facial position already active",
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

        requiresUser: false,

        unresolved: false,

        state:
          "FACIAL_POSITION_VIDEO_ACTIVE",

        position,

        label:
          resolved.label ||
          null,

        request:
          resolved.request ||
          null,

        storageReference:
          resolved.storageReference ||
          null,

        videoId:
          this.activeCameraVideoId,

        y4mPath:
          this.activeCameraY4mPath,

        score:
          resolved.score ??
          null,

        matchedTerms:
          resolved.matchedTerms ||
          [],

        reused: true,

        checkpoint:
          this.lastCheckpoint,

        dom:
          this.getDomSummary()
      };
    }


    /*
     * ----------------------------------------------------------
     * 4. PREPARAR O VÍDEO CORRETO
     * ----------------------------------------------------------
     *
     * Aqui acontece:
     *
     * storageReference
     *      ↓
     * GridFS
     *      ↓
     * Buffer
     *      ↓
     * Y4M
     */

    let prepared;

    try {

      prepared =
        await this.prepareFacialCamera(
          application,
          client,
          resolved
        );

    } catch (
      error
    ) {

      logger.error(
        "Failed to prepare VFS facial camera",
        {
          applicationId:
            this.applicationId,

          position,

          request:
            resolved.request ||
            null,

          error:
            error?.message ||
            error
        }
      );

      return {
        success: false,

        requiresUser: true,

        unresolved: false,

        state:
          "FACIAL_POSITION_VIDEO_UNAVAILABLE",

        position,

        label:
          resolved.label ||
          null,

        request:
          resolved.request ||
          null,

        storageReference:
          resolved.storageReference ||
          null,

        reason:
          error?.message ||
          `Could not prepare facial video for position ${position}.`,

        checkpoint:
          this.lastCheckpoint,

        dom:
          this.getDomSummary()
      };
    }


    /*
     * ----------------------------------------------------------
     * 5. CONFIRMAR PREPARAÇÃO
     * ----------------------------------------------------------
     */

    if (
      !prepared?.success ||
      !prepared?.y4mPath
    ) {

      return {
        success: false,

        requiresUser: true,

        unresolved: false,

        state:
          "FACIAL_POSITION_VIDEO_UNAVAILABLE",

        position,

        label:
          resolved.label ||
          null,

        request:
          resolved.request ||
          null,

        storageReference:
          resolved.storageReference ||
          null,

        reason:
          `The facial video for position ${position} could not be prepared for the VFS camera.`,

        checkpoint:
          this.lastCheckpoint,

        dom:
          this.getDomSummary()
      };
    }


    /*
     * ----------------------------------------------------------
     * 6. RESULTADO PARA O BOT 1
     * ----------------------------------------------------------
     *
     * O Bot 1 reconhece FACIAL_POSITION_VIDEO_ACTIVE
     * e mantém a câmera aberta enquanto a VFS processa
     * a posição.
     */

    logger.info(
      "VFS facial position video activated",
      {
        applicationId:
          this.applicationId,

        position,

        label:
          resolved.label ||
          null,

        request:
          resolved.request ||
          null,

        videoId:
          prepared.videoId ||
          this.activeCameraVideoId ||
          null,

        y4mPath:
          prepared.y4mPath,

        reused:
          prepared.reused === true
      }
    );


    return {
      success: true,

      requiresUser: false,

      unresolved: false,

      state:
        "FACIAL_POSITION_VIDEO_ACTIVE",

      position,

      label:
        resolved.label ||
        null,

      request:
        resolved.request ||
        null,

      storageReference:
        resolved.storageReference ||
        null,

      videoId:
        prepared.videoId ||
        this.activeCameraVideoId ||
        null,

      y4mPath:
        prepared.y4mPath,

      score:
        resolved.score ??
        null,

      matchedTerms:
        resolved.matchedTerms ||
        [],

      reused:
        prepared.reused === true,

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
   * DADOS DE CONTACTO DA CANDIDATURA
   * ============================================================
   *
   * IMPORTANTE:
   *
   * A VFS é responsável por extrair os dados do passaporte.
   *
   * O Bot1 NÃO altera esses dados.
   *
   * Depois da extração do passaporte, tratamos somente:
   *
   * 1. Country code -> 244
   * 2. Phone        -> 9 dígitos, começando por 9
   * 3. Email        -> agendamentov001@gmail.com
   *
   * O country code é sempre LIMPO antes de receber 244.
   *
   * O telefone é mantido separado do country code.
   */

  async fillVfsContactDetails(
    application = null
  ) {
    const page =
      await this.ensurePage();

    /*
     * Esperamos a VFS terminar a extração
     * e apresentar os campos de contacto.
     */
    const timeoutMs = 20000;
    const startedAt = Date.now();

    let descriptors = null;

    while (
      Date.now() - startedAt <
      timeoutMs
    ) {
      descriptors =
        await page.evaluate(() => {
          const normalize =
            value =>
              String(value || "")
                .normalize("NFD")
                .replace(
                  /[\u0300-\u036f]/g,
                  ""
                )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .toLowerCase();

          const visible =
            element => {
              if (!element) {
                return false;
              }

              const style =
                window.getComputedStyle(
                  element
                );

              const rect =
                element.getBoundingClientRect();

              return (
                !element.disabled &&
                !element.readOnly &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            };

          const describe =
            element => {
              const labels = [];

              if (element.labels) {
                for (
                  const label of element.labels
                ) {
                  labels.push(
                    label.innerText ||
                    label.textContent ||
                    ""
                  );
                }
              }

              const parentText =
                element.parentElement
                  ?.innerText ||
                "";

              const grandParentText =
                element.parentElement
                  ?.parentElement
                  ?.innerText ||
                "";

              return normalize(
                [
                  element.name,
                  element.id,
                  element.placeholder,
                  element.getAttribute(
                    "aria-label"
                  ),
                  element.getAttribute(
                    "autocomplete"
                  ),
                  ...labels,
                  parentText,
                  grandParentText
                ]
                  .filter(Boolean)
                  .join(" ")
              );
            };

          const elements =
            Array.from(
              document.querySelectorAll(
                "input, select, textarea"
              )
            ).filter(
              visible
            );

          const findCandidates =
            terms =>
              elements
                .map(
                  element => ({
                    element,
                    text:
                      describe(element)
                  })
                )
                .filter(
                  item =>
                    terms.some(
                      term =>
                        item.text.includes(
                          normalize(term)
                        )
                    )
                );

          const countryCodeCandidates =
            findCandidates([
              "country code",
              "country calling code",
              "calling code",
              "dial code",
              "phone country code",
              "codigo do pais",
              "código do país",
              "indicativo"
            ]);

          const phoneCandidates =
            findCandidates([
              "phone number",
              "phone",
              "mobile number",
              "mobile",
              "telephone number",
              "telephone",
              "contact number",
              "contact phone",
              "numero de telefone",
              "número de telefone"
            ])
              .filter(
                item => {
                  const text =
                    item.text;

                  /*
                   * Não aceitar o próprio campo
                   * do country code como telefone.
                   */
                  return !(
                    text.includes(
                      "country code"
                    ) ||
                    text.includes(
                      "calling code"
                    ) ||
                    text.includes(
                      "dial code"
                    ) ||
                    text.includes(
                      "codigo do pais"
                    ) ||
                    text.includes(
                      "indicativo"
                    )
                  );
                }
              );

          const emailCandidates =
            findCandidates([
              "email address",
              "email",
              "e-mail",
              "correo electronico",
              "electronic mail"
            ]);

          const serialize =
            items =>
              items.map(
                item => ({
                  tag:
                    item.element.tagName
                      .toLowerCase(),

                  type:
                    item.element.type ||
                    null,

                  id:
                    item.element.id ||
                    null,

                  name:
                    item.element.name ||
                    null,

                  value:
                    item.element.value ||
                    "",

                  text:
                    item.text
                })
              );

          return {
            countryCode:
              serialize(
                countryCodeCandidates
              ),

            phone:
              serialize(
                phoneCandidates
              ),

            email:
              serialize(
                emailCandidates
              )
          };
        });

      const hasAll =
        descriptors?.countryCode?.length === 1 &&
        descriptors?.phone?.length === 1 &&
        descriptors?.email?.length === 1;

      if (hasAll) {
        break;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            500
          )
      );
    }

    if (
      !descriptors?.countryCode?.length
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "VFS country-code field was not detected after passport extraction.",
        applicationId:
          application?._id?.toString?.() ||
          this.applicationId
      };
    }

    if (
      descriptors.countryCode.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "Multiple VFS country-code fields were detected; refusing ambiguous automation."
      };
    }

    if (
      !descriptors?.phone?.length
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "VFS phone field was not detected after passport extraction."
      };
    }

    if (
      descriptors.phone.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "Multiple VFS phone fields were detected; refusing ambiguous automation."
      };
    }

    if (
      !descriptors?.email?.length
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "VFS email field was not detected after passport extraction."
      };
    }

    if (
      descriptors.email.length !== 1
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "Multiple VFS email fields were detected; refusing ambiguous automation."
      };
    }

    /*
     * ----------------------------------------------------------
     * GERAR TELEFONE ANGOLANO
     * ----------------------------------------------------------
     *
     * Exatamente 9 dígitos.
     * Primeiro dígito obrigatoriamente 9.
     */
    const phoneNumber =
      "9" +
      Array.from(
        { length: 8 },
        () =>
          Math.floor(
            Math.random() * 10
          )
      ).join("");

    /*
     * ----------------------------------------------------------
     * HELPERS PARA SELETORES
     * ----------------------------------------------------------
     */

    const buildSelector =
  descriptor => {
    if (
      descriptor.id
    ) {
      const escapedId =
        String(
          descriptor.id
        )
          .replace(
            /\\/g,
            "\\\\"
          )
          .replace(
            /"/g,
            '\\"'
          );

      return `[id="${escapedId}"]`;
    }

    if (
      descriptor.name
    ) {
      const escapedName =
        String(
          descriptor.name
        )
          .replace(
            /\\/g,
            "\\\\"
          )
          .replace(
            /"/g,
            '\\"'
          );

      return `[name="${escapedName}"]`;
    }

    return null;
  };

    const countrySelector =
      buildSelector(
        descriptors.countryCode[0]
      );

    const phoneSelector =
      buildSelector(
        descriptors.phone[0]
      );

    const emailSelector =
      buildSelector(
        descriptors.email[0]
      );

    if (
      !countrySelector ||
      !phoneSelector ||
      !emailSelector
    ) {
      return {
        success: false,
        requiresUser: true,
        reason:
          "One or more VFS contact fields could not be addressed safely."
      };
    }

    /*
     * ----------------------------------------------------------
     * COUNTRY CODE
     * ----------------------------------------------------------
     *
     * Apagar absolutamente tudo que a VFS colocou
     * e inserir 244.
     */
    await page.click(
      countrySelector
    );

    await page.evaluate(
      selector => {
        const element =
          document.querySelector(
            selector
          );

        if (!element) {
          throw new Error(
            "Country-code field disappeared."
          );
        }

        if (
          element.tagName.toLowerCase() ===
          "select"
        ) {
          const options =
            Array.from(
              element.options
            );

          const match =
            options.find(
              option =>
                String(
                  option.value || ""
                ).replace(
                  /\D/g,
                  ""
                ) === "244" ||
                String(
                  option.textContent || ""
                ).replace(
                  /\D/g,
                  ""
                ) === "244"
            );

          if (!match) {
            throw new Error(
              "VFS country-code select does not contain 244."
            );
          }

          element.value =
            match.value;

          element.dispatchEvent(
            new Event(
              "input",
              {
                bubbles: true
              }
            )
          );

          element.dispatchEvent(
            new Event(
              "change",
              {
                bubbles: true
              }
            )
          );

          return;
        }

        element.focus();

        element.select?.();

        element.value =
          "";

        element.dispatchEvent(
          new Event(
            "input",
            {
              bubbles: true
            }
          )
        );

        element.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true
            }
          )
        );
      },
      countrySelector
    );

    /*
     * Se for input/text:
     * garantir que 244 seja realmente escrito.
     */
    if (
      descriptors.countryCode[0].tag !==
      "select"
    ) {
      await page.type(
        countrySelector,
        "244",
        {
          delay: 20
        }
      );
    }

    /*
     * ----------------------------------------------------------
     * TELEFONE
     * ----------------------------------------------------------
     */
    await page.click(
      phoneSelector
    );

    await page.$eval(
      phoneSelector,
      element => {
        element.focus();

        if (
          typeof element.select ===
          "function"
        ) {
          element.select();
        }

        element.value =
          "";

        element.dispatchEvent(
          new Event(
            "input",
            {
              bubbles: true
            }
          )
        );

        element.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true
            }
          )
        );
      }
    );

    await page.type(
      phoneSelector,
      phoneNumber,
      {
        delay: 20
      }
    );

    /*
     * ----------------------------------------------------------
     * E-MAIL
     * ----------------------------------------------------------
     */
    const applicationEmail =
      "agendamentov001@gmail.com";

    await page.click(
      emailSelector
    );

    await page.$eval(
      emailSelector,
      element => {
        element.focus();

        if (
          typeof element.select ===
          "function"
        ) {
          element.select();
        }

        element.value =
          "";

        element.dispatchEvent(
          new Event(
            "input",
            {
              bubbles: true
            }
          )
        );

        element.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true
            }
          )
        );
      }
    );

    await page.type(
      emailSelector,
      applicationEmail,
      {
        delay: 20
      }
    );

    /*
     * ----------------------------------------------------------
     * VALIDAR O RESULTADO NO DOM
     * ----------------------------------------------------------
     */
    const verification =
      await page.evaluate(
        ({
          countrySelector,
          phoneSelector,
          emailSelector
        }) => {
          const country =
            document.querySelector(
              countrySelector
            );

          const phone =
            document.querySelector(
              phoneSelector
            );

          const email =
            document.querySelector(
              emailSelector
            );

          const countryValue =
            String(
              country?.value || ""
            ).replace(
              /\D/g,
              ""
            );

          const phoneValue =
            String(
              phone?.value || ""
            ).replace(
              /\D/g,
              ""
            );

          const emailValue =
            String(
              email?.value || ""
            )
              .trim()
              .toLowerCase();

          return {
            countryCode:
              countryValue,
            phone:
              phoneValue,
            email:
              emailValue
          };
        },
        {
          countrySelector,
          phoneSelector,
          emailSelector
        }
      );

    if (
      verification.countryCode !==
      "244"
    ) {
      return {
        success: false,
        reason:
          "VFS rejected or changed the country code after filling 244.",
        verification
      };
    }

    if (
      !/^9\d{8}$/.test(
        verification.phone
      )
    ) {
      return {
        success: false,
        reason:
          "VFS phone field does not contain a valid 9-digit Angolan number beginning with 9.",
        verification
      };
    }

    if (
      verification.email !==
      applicationEmail
    ) {
      return {
        success: false,
        reason:
          "VFS email field does not contain the configured application email.",
        verification
      };
    }

    await this.inspectCurrentDom()
      .catch(() => {});

    return {
      success: true,

      countryCode:
        "244",

      phone:
        verification.phone,

      email:
        applicationEmail,

      applicationId:
        application?._id?.toString?.() ||
        this.applicationId,

      dom:
        this.getDomSummary()
    };
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
  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      return await this.detectCheckpointOnce();
    } catch (error) {
      const message =
        error?.message ||
        String(error);

      const detachedFrame =
        message
          .toLowerCase()
          .includes(
            "detached frame"
          ) ||
        message
          .toLowerCase()
          .includes(
            "navigating frame was detached"
          );

      if (!detachedFrame) {
        throw error;
      }

      logger.warn(
        "VFS DETACHED FRAME — CHECKPOINT RETRY",
        {
          applicationId:
            this.applicationId,

          attempt,

          maxAttempts,

          url:
            (() => {
              try {
                return this.page?.url?.() ||
                  null;
              } catch {
                return null;
              }
            })(),

          message
        }
      );

      if (
        attempt >=
        maxAttempts
      ) {
        throw error;
      }

      /*
       * O VFS pode ter acabado de substituir
       * o documento/frame.
       *
       * Esperamos um pequeno intervalo para
       * o novo frame estabilizar e depois
       * executamos toda a detecção novamente.
       */
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            500
          )
      );

      /*
       * Garante que continuamos usando
       * a página atual da sessão.
       */
      await this.ensurePage();
    }
  }
}
async detectCheckpointOnce() {
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
  this.stopRadarKeepAlive();
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
