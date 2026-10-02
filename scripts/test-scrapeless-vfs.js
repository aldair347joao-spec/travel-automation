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
    "[SCRAPELESS TEST] Verifying API key..."
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
        1000
      )
    );

    throw new Error(
      `Scrapeless API key verification failed with HTTP ${accountResponse.status}`
    );
  }

  console.log(
    "[SCRAPELESS TEST] API key authenticated successfully."
  );

  const connectionURL =
  "wss://browser.scrapeless.com/api/v2/browser" +
  `?token=${encodeURIComponent(apiKey)}` +
  "&sessionTTL=60" +
  "&sessionName=travel-automation-test";

  console.log(
    "[SCRAPELESS TEST] Connecting..."
  );

  const browser =
    await puppeteer.connect({
      browserWSEndpoint:
        connectionURL,

      defaultViewport:
        null
    });

  console.log(
    "[SCRAPELESS TEST] Connected."
  );

  try {
    const page =
      await browser.newPage();

    page.setDefaultNavigationTimeout(
      45000
    );

    console.log(
      "[SCRAPELESS TEST] Navigating:",
      TARGET_URL
    );

    await page.goto(
      TARGET_URL,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          45000
      }
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );

    const result =
      await page.evaluate(
        () => ({
          url:
            window.location.href,

          title:
            document.title,

          inputCount:
            document.querySelectorAll(
              "input"
            ).length,

          iframeCount:
            document.querySelectorAll(
              "iframe"
            ).length,

          buttonCount:
            document.querySelectorAll(
              "button"
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
                1500
              )
        })
      );

    console.log(
      "[SCRAPELESS TEST] RESULT:"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
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
      "[SCRAPELESS TEST] FAILED:"
    );

    console.error(
      error?.stack ||
      error?.message ||
      String(error)
    );

    process.exitCode = 1;
  }
);
