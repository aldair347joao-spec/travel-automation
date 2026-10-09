
require("dotenv").config();

const { chromium } =
  require("playwright-core");


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
 * 2/3. CONECTAR DIRETAMENTE AO SCRAPELESS AGENT BROWSER
 * ==========================================================
 *
 * Fluxo oficial atual:
 *
 * wss://browser.scrapeless.com/api/v2/browser
 *
 * Usamos proxyCountry=ANY para não forçar a saída por
 * Angola enquanto estamos diagnosticando a VFS.
 */

console.log(
  "[SCRAPELESS TEST] 2/5 - Preparando conexão Agent Browser..."
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
  `travel-automation-test-${Date.now()}`;

const proxyCountry =
  "AO";

const browserWebSocket =
  "wss://browser.scrapeless.com/api/v2/browser?" +
  new URLSearchParams({
    token:
      apiKey,

    sessionTTL:
      String(
        sessionTTL
      ),

    sessionName:
      sessionName,

    proxyCountry:
      proxyCountry
  }).toString();

console.log(
  "[SCRAPELESS TEST] Configuração da sessão:",
  {
    sessionTTL,
    sessionName,
    proxyCountry
  }
);

console.log(
  "[SCRAPELESS TEST] 3/5 - Conectando ao Agent Browser..."
);

console.log(
  "[SCRAPELESS TEST] WebSocket:",
  browserWebSocket.replace(
    apiKey,
    "[REDACTED]"
  )
);


const browser =
  await chromium.connectOverCDP(
    browserWebSocket,
    {
      timeout: 120000
    }
  );

console.log(
  "[SCRAPELESS TEST] Browser Agent conectado com sucesso."
);


  /*
   * ==========================================================
   * 4. ABRIR A VFS
   * ==========================================================
   */

  try {
    
const contexts = browser.contexts();

if (!contexts.length) {
  throw new Error(
    "Scrapeless não disponibilizou um contexto de navegador."
  );
}

const context = contexts[0];

const page = await context.newPage();

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

  
    const challengeStart =
  Date.now();

let challengeResolved =
  false;

while (
  Date.now() -
    challengeStart <
  60000
) {
  if (
    page.isClosed()
  ) {
    console.warn(
      "[SCRAPELESS TEST] Página foi fechada durante o Cloudflare Challenge."
    );

    break;
  }

  let snapshot =
    null;

  try {
    snapshot =
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
              .slice(
                0,
                3000
              );

          return {
            url:
              window.location.href,

            title:
              document.title || "",

            bodyText,

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

            buttonCount:
              document.querySelectorAll(
                "button"
              ).length
          };
        }
      );
  } catch (error) {
    const message =
      String(
        error?.message ||
        error ||
        ""
      );

    console.warn(
      "[SCRAPELESS TEST] Frame mudou durante diagnóstico. Repetindo...",
      message.slice(
        0,
        300
      )
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1500
        )
    );

    continue;
  }

  if (!snapshot) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );

    continue;
  }

  const text =
    String(
      snapshot.bodyText ||
        ""
    ).toLowerCase();

  const title =
    String(
      snapshot.title ||
        ""
    ).toLowerCase();

  const cloudflareChallenge =
    title.includes(
      "just a moment"
    ) ||
    text.includes(
      "performing security verification"
    ) ||
    text.includes(
      "security verification"
    ) ||
    text.includes(
      "checking your browser"
    ) ||
    text.includes(
      "verify you are human"
    ) ||
    text.includes(
      "checking if the site connection is secure"
    );

  /*
   * A confirmação real não depende do evento
   * Captcha.solveFinished.
   *
   * Se o challenge desapareceu e a página já
   * possui inputs/formulário, consideramos a
   * página liberada.
   */

  const loginPageReady =
    !cloudflareChallenge &&
    (
      snapshot.passwordCount >
        0 ||
      snapshot.emailCount >
        0
    );

  if (
    loginPageReady
  ) {
    challengeResolved =
      true;

    console.log(
      "[SCRAPELESS TEST] Cloudflare Challenge resolvida — página VFS disponível.",
      {
        url:
          snapshot.url,

        title:
          snapshot.title,

        inputCount:
          snapshot.inputCount,

        passwordCount:
          snapshot.passwordCount,

        emailCount:
          snapshot.emailCount
      }
    );

    break;
  }

  /*
   * Também aceitamos uma página VFS que já
   * tenha saído do Cloudflare mesmo antes de
   * todos os campos aparecerem.
   */

  const looksLikeVfs =
    snapshot.url.includes(
      "visa.vfsglobal.com"
    ) &&
    !cloudflareChallenge;

  if (
    looksLikeVfs &&
    snapshot.inputCount > 0
  ) {
    challengeResolved =
      true;

    console.log(
      "[SCRAPELESS TEST] Cloudflare desapareceu e a página VFS começou a renderizar."
    );

    break;
  }

  console.log(
    "[SCRAPELESS TEST] Aguardando resolução Cloudflare...",
    {
      elapsedMs:
        Date.now() -
        challengeStart,

      title:
        snapshot.title,

      url:
        snapshot.url,

      inputCount:
        snapshot.inputCount,

      passwordCount:
        snapshot.passwordCount,

      emailCount:
        snapshot.emailCount
    }
  );

  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        2000
      )
  );
}

if (!challengeResolved) {
  console.warn(
    "[SCRAPELESS TEST] Cloudflare Challenge não foi confirmada após 60 segundos."
  );
}

    /*
     * ========================================================
     * 5. DIAGNOSTICO DA PAGINA
     * ========================================================
     */

    console.log(
      "[SCRAPELESS TEST] 5/5 - Diagnosticando página VFS..."
    );

    let result =
  null;

try {
  if (
    page.isClosed()
  ) {
    throw new Error(
      "A página foi fechada antes do diagnóstico final."
    );
  }

  result =
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
            ),

        formCount:
          document.querySelectorAll(
            "form"
          ).length,

        inputs:
          Array.from(
            document.querySelectorAll(
              "input"
            )
          ).map(
            (el, index) => ({
              index,
              type: el.getAttribute("type"),
              name: el.getAttribute("name"),
              id: el.id,
              placeholder:
                el.getAttribute("placeholder"),
              autocomplete:
                el.getAttribute("autocomplete"),
              ariaLabel:
                el.getAttribute("aria-label"),
              visible: Boolean(
                el.getClientRects().length &&
                getComputedStyle(el).visibility !== "hidden" &&
                getComputedStyle(el).display !== "none"
              ),
              label: el.id
                ? document.querySelector(
                    `label[for="${CSS.escape(el.id)}"]`
                  )?.innerText || ""
                : "",
              parentText: (
                el.parentElement?.innerText || ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120)
            })
          ),

        buttons:
          Array.from(
            document.querySelectorAll(
              "button, input[type='submit'], [role='button']"
            )
          ).map(
            (el, index) => ({
              index,
              text: (
                el.innerText ||
                el.value ||
                el.getAttribute("aria-label") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 100),
              type: el.getAttribute("type"),
              disabled: Boolean(el.disabled)
            })
          )
      })
    );
} catch (error) {
  console.warn(
    "[SCRAPELESS TEST] Diagnóstico final não pôde usar o frame atual.",
    error?.message ||
      String(error)
  );

  result = {
    url:
      page.isClosed()
        ? "PAGE_CLOSED"
        : page.url(),

    title:
      "",

    diagnosticError:
      error?.message ||
      String(error)
  };
}

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

    if (
  challengeResolved &&
  !result?.diagnosticError
) {
  console.log(
    "[SCRAPELESS TEST] SUCCESS: Cloudflare resolvido e diagnóstico VFS concluído."
  );
} else if (
  !result?.diagnosticError
) {
  console.warn(
    "[SCRAPELESS TEST] WARNING: Diagnóstico concluído, mas o Cloudflare não foi confirmado."
  );
} else {
  console.error(
    "[SCRAPELESS TEST] ERROR: Diagnóstico VFS não pôde ser concluído."
  );
}
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
