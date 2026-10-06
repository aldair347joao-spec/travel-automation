require("dotenv").config();

const puppeteer = require("puppeteer");

const TARGET_URL =
  "https://visa.vfsglobal.com/ago/en/prt/login";

const AUTH_TIMEOUT =
  Number(process.env.SCRAPELESS_AUTH_TEST_TIMEOUT_MS) || 300000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSnapshot(page) {
  if (page.isClosed()) {
    return {
      closed: true
    };
  }

  try {
    return await page.evaluate(() => {
      const normalize = value =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const visible = element => {
        const style =
          window.getComputedStyle(element);

        const rect =
          element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const inputs =
        Array.from(
          document.querySelectorAll("input")
        ).filter(visible);

      const buttons =
        Array.from(
          document.querySelectorAll(
            "button, input[type='submit'], [role='button']"
          )
        ).filter(visible);

      const body =
        normalize(
          document.body?.innerText || ""
        );

      const url =
        window.location.href || "";

      const title =
        normalize(
          document.title || ""
        );

      const emailInput =
        inputs.find(element => {
          const values = [
            element.type,
            element.name,
            element.id,
            element.placeholder,
            element.getAttribute("aria-label")
          ]
            .map(normalize)
            .join(" ");

          return (
            element.type === "email" ||
            values.includes("email") ||
            values.includes("username")
          );
        });

      const passwordInput =
        inputs.find(element =>
          normalize(element.type) === "password"
        );

      const signInButton =
        buttons.find(element =>
          normalize(
            [
              element.innerText,
              element.value,
              element.getAttribute("aria-label")
            ].join(" ")
          ).includes("sign in")
        );

      const otpInput =
        inputs.find(element => {
          const values = [
            element.name,
            element.id,
            element.placeholder,
            element.getAttribute("aria-label")
          ]
            .map(normalize)
            .join(" ");

          return (
            values.includes("otp") ||
            values.includes("one time password") ||
            values.includes("verification code")
          );
        });

      const loginError =
        body.includes("invalid username") ||
        body.includes("invalid password") ||
        body.includes("incorrect password") ||
        body.includes("invalid credentials") ||
        body.includes("authentication failed");

      const authenticated =
        !url.includes("/login") &&
        (
          url.includes("/dashboard") ||
          url.includes("/application-detail") ||
          url.includes("/your-details") ||
          url.includes("/services") ||
          url.includes("/book-appointment") ||
          url.includes("/fv-instructions")
        );

      const cloudflare =
        title.includes("just a moment") ||
        body.includes("performing security verification") ||
        body.includes("security verification") ||
        body.includes("checking your browser") ||
        body.includes("verify you are human") ||
        body.includes(
          "checking if the site connection is secure"
        );

      return {
        url,
        title,
        body: body.slice(0, 2000),
        inputCount: inputs.length,
        emailReady: Boolean(emailInput),
        passwordReady: Boolean(passwordInput),
        signInReady: Boolean(signInButton),
        otpReady: Boolean(otpInput),
        loginError,
        authenticated,
        cloudflare
      };
    });
  } catch (error) {
    return {
      evaluateError:
        error?.message || String(error)
    };
  }
}

async function main() {
  const apiKey =
    process.env.SCRAPELESS_API_KEY;

  const email =
    process.env.VFS_TEST_EMAIL;

  const password =
    process.env.VFS_TEST_PASSWORD;

  if (!apiKey) {
    throw new Error(
      "SCRAPELESS_API_KEY não está definida."
    );
  }

  if (!email || !password) {
    throw new Error(
      "Defina VFS_TEST_EMAIL e VFS_TEST_PASSWORD no ambiente."
    );
  }

  console.log(
    "============================================================"
  );

  console.log(
    "[VFS LOGIN TEST] TESTE REAL DE AUTENTICAÇÃO"
  );

  console.log(
    "============================================================"
  );

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

  const sessionName =
    `travel-automation-login-test-${Date.now()}`;

  const browserWebSocket =
    "wss://browser.scrapeless.com/api/v2/browser?" +
    new URLSearchParams({
      token: apiKey,
      sessionTTL: String(sessionTTL),
      sessionName,
      proxyCountry: "ANY"
    }).toString();

  console.log(
    "[VFS LOGIN TEST] Session:",
    {
      sessionTTL,
      sessionName
    }
  );

  const browser =
    await puppeteer.connect({
      browserWSEndpoint:
        browserWebSocket,

      defaultViewport:
        null,

      protocolTimeout:
        120000
    });

  console.log(
    "[VFS LOGIN TEST] Agent Browser conectado."
  );

  try {
    const page =
      await browser.newPage();

    page.setDefaultNavigationTimeout(
      60000
    );

    /*
     * ========================================================
     * CAPTCHA EVENTS
     * ========================================================
     */

    let captchaDetected = false;
    let captchaSolved = false;
    let captchaFailed = false;

    let captchaClient = null;

    try {
      captchaClient =
        await page.createCDPSession();

      captchaClient.on(
        "Captcha.detected",
        message => {
          captchaDetected = true;

          console.log(
            "[VFS LOGIN TEST] CAPTCHA DETECTADO:",
            {
              type:
                message?.type || null
            }
          );
        }
      );

      captchaClient.on(
        "Captcha.solveFinished",
        message => {
          captchaSolved =
            message?.success === true;

          console.log(
            "[VFS LOGIN TEST] CAPTCHA SOLVE FINISHED:",
            {
              success:
                message?.success ?? null,

              type:
                message?.type || null
            }
          );
        }
      );

      captchaClient.on(
        "Captcha.solveFailed",
        message => {
          captchaFailed = true;

          console.error(
            "[VFS LOGIN TEST] CAPTCHA SOLVE FAILED:",
            {
              type:
                message?.type || null,

              message:
                message?.message || null
            }
          );
        }
      );
    } catch (error) {
      console.warn(
        "[VFS LOGIN TEST] Não foi possível ligar listeners CAPTCHA:",
        error?.message || String(error)
      );
    }

    /*
     * ========================================================
     * ABRIR VFS
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Abrindo VFS..."
    );

    await page.goto(
      TARGET_URL,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );

    /*
     * ========================================================
     * AGUARDAR LOGIN
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Aguardando formulário VFS..."
    );

    const loginWaitStarted =
      Date.now();

    let snapshot = null;

    while (
      Date.now() -
        loginWaitStarted <
      AUTH_TIMEOUT
    ) {
      snapshot =
        await getSnapshot(page);

      console.log(
        "[VFS LOGIN TEST] Estado:",
        {
          elapsed:
            Math.round(
              (
                Date.now() -
                loginWaitStarted
              ) / 1000
            ) + "s",

          url:
            snapshot?.url,

          title:
            snapshot?.title,

          cloudflare:
            snapshot?.cloudflare,

          emailReady:
            snapshot?.emailReady,

          passwordReady:
            snapshot?.passwordReady,

          signInReady:
            snapshot?.signInReady,

          otpReady:
            snapshot?.otpReady,

          authenticated:
            snapshot?.authenticated
        }
      );

      if (
        snapshot?.authenticated
      ) {
        console.log(
          "[VFS LOGIN TEST] AUTHENTICATED ANTES DO LOGIN MANUAL."
        );

        break;
      }

      if (
        snapshot?.loginError
      ) {
        throw new Error(
          "A VFS apresentou um erro de autenticação antes do teste."
        );
      }

      if (
        snapshot?.emailReady &&
        snapshot?.passwordReady
      ) {
        console.log(
          "[VFS LOGIN TEST] FORMULÁRIO DE LOGIN ENCONTRADO."
        );

        break;
      }

      await sleep(1500);
    }

    if (
      !snapshot?.emailReady ||
      !snapshot?.passwordReady
    ) {
      throw new Error(
        "Formulário de login não apareceu dentro do tempo do teste."
      );
    }

    /*
     * ========================================================
     * PREENCHER CREDENCIAIS
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Preenchendo email..."
    );

    const emailSelector =
      await page.evaluate(() => {
        const normalize =
          value =>
            String(value || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

        const visible =
          element => {
            const style =
              window.getComputedStyle(
                element
              );

            const rect =
              element.getBoundingClientRect();

            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };

        const inputs =
          Array.from(
            document.querySelectorAll(
              "input"
            )
          ).filter(visible);

        const email =
          inputs.find(
            element => {
              const values = [
                element.type,
                element.name,
                element.id,
                element.placeholder,
                element.getAttribute(
                  "aria-label"
                )
              ]
                .map(normalize)
                .join(" ");

              return (
                element.type === "email" ||
                values.includes("email") ||
                values.includes("username")
              );
            }
          );

        const password =
          inputs.find(
            element =>
              normalize(
                element.type
              ) === "password"
          );

        return {
          email:
            email
              ? {
                  id:
                    email.id || null,

                  name:
                    email.name || null
                }
              : null,

          password:
            password
              ? {
                  id:
                    password.id || null,

                  name:
                    password.name || null
                }
              : null
        };
      });

    if (
      !emailSelector?.email ||
      !emailSelector?.password
    ) {
      throw new Error(
        "Não foi possível identificar os campos de login."
      );
    }

    const emailField =
      emailSelector.email.id
        ? `#${CSS.escape(
            emailSelector.email.id
          )}`
        : `input[name="${CSS.escape(
            emailSelector.email.name
          )}"]`;

    const passwordField =
      emailSelector.password.id
        ? `#${CSS.escape(
            emailSelector.password.id
          )}`
        : `input[name="${CSS.escape(
            emailSelector.password.name
          )}"]`;

    await page.click(
      emailField
    );

    await page.keyboard.down(
      "Control"
    );

    await page.keyboard.press(
      "A"
    );

    await page.keyboard.up(
      "Control"
    );

    await page.keyboard.press(
      "Backspace"
    );

    await page.type(
      email
    );

    console.log(
      "[VFS LOGIN TEST] Email preenchido."
    );

    await page.click(
      passwordField
    );

    await page.keyboard.down(
      "Control"
    );

    await page.keyboard.press(
      "A"
    );

    await page.keyboard.up(
      "Control"
    );

    await page.keyboard.press(
      "Backspace"
    );

    await page.type(
      password
    );

    console.log(
      "[VFS LOGIN TEST] Password preenchida."
    );

    /*
     * ========================================================
     * AGUARDAR BOTÃO SIGN IN
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Aguardando Sign In..."
    );

    let submitReady =
      false;

    const submitWaitStarted =
      Date.now();

    while (
      Date.now() -
        submitWaitStarted <
      60000
    ) {
      snapshot =
        await getSnapshot(page);

      if (
        snapshot?.cloudflare
      ) {
        console.log(
          "[VFS LOGIN TEST] Cloudflare ainda ativo..."
        );
      }

      if (
        snapshot?.signInReady
      ) {
        submitReady =
          true;

        break;
      }

      await sleep(1000);
    }

    if (!submitReady) {
      throw new Error(
        "O botão Sign In não ficou disponível."
      );
    }

    /*
     * ========================================================
     * CLICAR SIGN IN
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Clicando Sign In..."
    );

    const clicked =
      await page.evaluate(() => {
        const normalize =
          value =>
            String(value || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

        const visible =
          element => {
            const style =
              window.getComputedStyle(
                element
              );

            const rect =
              element.getBoundingClientRect();

            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };

        const buttons =
          Array.from(
            document.querySelectorAll(
              "button, input[type='submit'], [role='button']"
            )
          ).filter(visible);

        const button =
          buttons.find(element =>
            normalize(
              [
                element.innerText,
                element.value,
                element.getAttribute(
                  "aria-label"
                )
              ].join(" ")
            ).includes("sign in")
          );

        if (!button) {
          return false;
        }

        button.click();

        return true;
      });

    if (!clicked) {
      throw new Error(
        "Não foi possível clicar no Sign In."
      );
    }

    console.log(
      "[VFS LOGIN TEST] Sign In enviado."
    );

    /*
     * ========================================================
     * AGUARDAR RESULTADO DO LOGIN
     * ========================================================
     */

    console.log(
      "[VFS LOGIN TEST] Aguardando resultado da autenticação..."
    );

    const authStarted =
      Date.now();

    while (
      Date.now() -
        authStarted <
      AUTH_TIMEOUT
    ) {
      snapshot =
        await getSnapshot(page);

      console.log(
        "[VFS LOGIN TEST] Pós-login:",
        {
          elapsed:
            Math.round(
              (
                Date.now() -
                authStarted
              ) / 1000
            ) + "s",

          url:
            snapshot?.url,

          title:
            snapshot?.title,

          cloudflare:
            snapshot?.cloudflare,

          captchaDetected,

          captchaSolved,

          captchaFailed,

          otpReady:
            snapshot?.otpReady,

          authenticated:
            snapshot?.authenticated,

          loginError:
            snapshot?.loginError
        }
      );

      if (
        snapshot?.authenticated
      ) {
        console.log(
          "============================================================"
        );

        console.log(
          "[VFS LOGIN TEST] RESULTADO: AUTHENTICATED"
        );

        console.log(
          "============================================================"
        );

        return;
      }

      if (
        snapshot?.otpReady
      ) {
        console.log(
          "============================================================"
        );

        console.log(
          "[VFS LOGIN TEST] RESULTADO: OTP_REQUIRED"
        );

        console.log(
          "[VFS LOGIN TEST] O Agent Browser + automação chegaram ao ponto do OTP."
        );

        console.log(
          "============================================================"
        );

        return;
      }

      if (
        snapshot?.loginError
      ) {
        console.log(
          "============================================================"
        );

        console.log(
          "[VFS LOGIN TEST] RESULTADO: LOGIN_FAILED"
        );

        console.log(
          "============================================================"
        );

        return;
      }

      await sleep(1500);
    }

    console.log(
      "============================================================"
    );

    console.log(
      "[VFS LOGIN TEST] RESULTADO: AUTH_TIMEOUT"
    );

    console.log(
      {
        captchaDetected,
        captchaSolved,
        captchaFailed,
        lastSnapshot:
          snapshot
      }
    );

    console.log(
      "============================================================"
    );
  } finally {
    await browser.close();

    console.log(
      "[VFS LOGIN TEST] Browser fechado."
    );
  }
}

main().catch(error => {
  console.error(
    "============================================================"
  );

  console.error(
    "[VFS LOGIN TEST] FAILED:"
  );

  console.error(
    error?.message ||
      String(error)
  );

  console.error(
    "============================================================"
  );

  process.exitCode = 1;
});
