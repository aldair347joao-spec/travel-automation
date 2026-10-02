require("dotenv").config();

const puppeteer =
  require("puppeteer");

const TARGET_URL =
  "https://visa.vfsglobal.com/ago/en/prt/login";

async function main() {
  const apiKey =
    process.env.SCRAPELESS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SCRAPELESS_API_KEY não está definida no ambiente."
    );
  }

  console.log(
    "============================================================"
  );

  console.log(
    "[SCRAPELESS TEST] DIAGNOSTICO COMPLETO"
  );

  console.log(
    "============================================================"
  );

  /*
   * ==========================================================
   * 1. VALIDAR A API KEY
   * ==========================================================
   */

  console.log(
    "[SCRAPELESS TEST] 1/5 - Verificando API key..."
  );

  const accountResponse =
    await fetch(
      "https://api.scrapeless.com/api/v1/me",
      {
        method:
          "GET",

        headers: {
          "x-api-token":
            apiKey
        }
      }
    );

  const accountText =
    await accountResponse.text();

  console.log(
    "[SCRAPELESS TEST] API KEY STATUS:",
    accountResponse.status
  );

  if (
    accountResponse.status !==
    200
  ) {
    console.error(
      "[SCRAPELESS TEST] API KEY RESPONSE:",
      accountText.slice(
        0,
        2000
      )
    );

    throw new Error(
      `Scrapeless API key verification failed with HTTP ${accountResponse.status}`
    );
  }

  console.log(
    "[SCRAPELESS TEST] API key authenticated successfully."
  );

  /*
   * ==========================================================
   * 2. CRIAR SESSAO VIA API HTTP
   * ==========================================================
   *
   * Este é o fluxo alternativo documentado pelo Scrapeless:
   *
   * GET /api/v2/browser
   *
   * A resposta deve fornecer um taskId.
   */

  console.log(
    "[SCRAPELESS TEST] 2/5 - Criando sessão Agent Browser via HTTP..."
  );

  const sessionResponse =
    await fetch(
      "https://api.scrapeless.com/api/v2/browser",
      {
        method:
          "GET",

        headers: {
          "x-api-token":
            apiKey,

          "Accept":
            "application/json"
        }
      }
    );

  const sessionText =
    await sessionResponse.text();

  console.log(
    "[SCRAPELESS TEST] SESSION CREATE STATUS:",
    sessionResponse.status
  );

  console.log(
    "[SCRAPELESS TEST] SESSION CREATE RESPONSE:",
    sessionText.slice(
      0,
      3000
    )
  );

  if (
    !sessionResponse.ok
  ) {
    throw new Error(
      `Scrapeless Agent Browser session creation failed with HTTP ${sessionResponse.status}`
    );
  }

  let sessionData =
    null;

  try {
    sessionData =
      JSON.parse(
        sessionText
      );
  } catch {
    throw new Error(
      "Scrapeless respondeu à criação da sessão com conteúdo que não é JSON."
    );
  }

  const taskId =
    sessionData?.taskId ||
    sessionData?.data?.taskId ||
    sessionData?.result?.taskId ||
    null;

  if (!taskId) {
    console.error(
      "[SCRAPELESS TEST] Não foi encontrado taskId na resposta."
    );

    console.error(
      "[SCRAPELESS TEST] JSON RECEBIDO:",
      JSON.stringify(
        sessionData,
        null,
        2
      )
    );

    throw new Error(
      "Scrapeless não devolveu taskId para a sessão Agent Browser."
    );
  }

  console.log(
    "[SCRAPELESS TEST] Agent Browser taskId recebido:",
    taskId
  );

  /*
   * ==========================================================
   * 3. CONECTAR AO NAVEGADOR PELO taskId
   * ==========================================================
   */

  const browserWebSocket =
    `wss://api.scrapeless.com/browser/${encodeURIComponent(
      taskId
    )}`;

  console.log(
    "[SCRAPELESS TEST] 3/5 - Conectando ao navegador..."
  );

  console.log(
    "[SCRAPELESS TEST] WebSocket:",
    browserWebSocket
  );

  const browser =
    await puppeteer.connect({
      browserWSEndpoint:
        browserWebSocket,

      headers: {
        "x-api-token":
          apiKey
      },

      defaultViewport:
        null
    });

  console.log(
    "[SCRAPELESS TEST] Browser Agent conectado com sucesso."
  );

  /*
   * ==========================================================
   * 4. ABRIR A VFS
   * ==========================================================
   */

  try {
    const page =
      await browser.newPage();

    page.setDefaultNavigationTimeout(
      60000
    );

    console.log(
      "[SCRAPELESS TEST] 4/5 - Abrindo VFS..."
    );

    console.log(
      "[SCRAPELESS TEST] URL:",
      TARGET_URL
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

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          5000
        )
    );

    /*
     * ========================================================
     * 5. DIAGNOSTICO DA PAGINA
     * ========================================================
     */

    console.log(
      "[SCRAPELESS TEST] 5/5 - Diagnosticando página VFS..."
    );

    const result =
      await page.evaluate(
        () => ({
          url:
            window.location.href,

          title:
            document.title,

          readyState:
            document.readyState,

          inputCount:
            document.querySelectorAll(
              "input"
            ).length,

          passwordCount:
            document.querySelectorAll(
              'input[type="password"]'
            ).length,

          emailCount:
            document.querySelectorAll(
              'input[type="email"]'
            ).length,

          iframeCount:
            document.querySelectorAll(
              "iframe"
            ).length,

          buttonCount:
            document.querySelectorAll(
              "button"
            ).length,

          videoCount:
            document.querySelectorAll(
              "video"
            ).length,

          bodyText:
            (
              document.body?.innerText ||
              ""
            )
              .replace(
                /\s+/g,
                " "
              )
              .slice(
                0,
                3000
              )
        })
      );

    console.log(
      "============================================================"
    );

    console.log(
      "[SCRAPELESS TEST] RESULTADO FINAL:"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    console.log(
      "============================================================"
    );

    console.log(
      "[SCRAPELESS TEST] VFS navigation completed successfully."
    );
  } finally {
    await browser.close();

    console.log(
      "[SCRAPELESS TEST] Browser closed."
    );
  }
}

main().catch(
  error => {
    console.error(
      "============================================================"
    );

    console.error(
      "[SCRAPELESS TEST] FAILED:"
    );

    console.error(
      error?.stack ||
      error?.message ||
      String(error)
    );

    console.error(
      "============================================================"
    );

    process.exitCode =
      1;
  }
);
