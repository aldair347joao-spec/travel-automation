require("dotenv").config();

const puppeteer = require("puppeteer");

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

  const connectionURL =
    new URL(
      "wss://browser.scrapeless.com/api/v2/browser"
    );

  connectionURL.searchParams.set(
    "token",
    apiKey
  );

  connectionURL.searchParams.set(
    "sessionTTL",
    "180"
  );

  connectionURL.searchParams.set(
    "proxyCountry",
    "ANY"
  );

  connectionURL.searchParams.set(
    "sessionName",
    "travel-automation-vfs-test"
  );

  console.log(
    "[SCRAPELESS TEST] Connecting..."
  );

  const browser =
    await puppeteer.connect({
      browserWSEndpoint:
        connectionURL.toString(),
      defaultViewport:
        null
    });

  try {
    const pages =
      await browser.pages();

    const page =
      pages[0] ||
      await browser.newPage();

    page.setDefaultNavigationTimeout(
      45000
    );

    console.log(
      "[SCRAPELESS TEST] Connected."
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
      "[SCRAPELESS TEST] RESULT:",
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
