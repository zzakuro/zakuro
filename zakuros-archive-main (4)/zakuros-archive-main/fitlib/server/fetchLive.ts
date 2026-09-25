import { PlaywrightCrawler, Configuration, log } from "crawlee";

// Live feed spot-check through a real headless browser (Crawlee + Playwright).
// Plain HTTP clients get a Cloudflare "Just a moment" challenge against
// hydralinks.cloud from some egresses; a real browser executes the challenge
// JS and lands on the actual JSON.
//
// Usage: npx tsx server/fetchLive.ts <slug> [query]
//   - slug:  source key, e.g. "fitgirl", "glitchify", "elamigos"
//   - query: optional case-insensitive substring filter on download titles

async function main() {
  const [slug = "fitgirl", query = ""] = process.argv.slice(2);
  const url = `https://hydralinks.cloud/sources/${slug}.json`;

  Configuration.set?.("persistStorage", false);
  log.setLevel(log.LEVELS.ERROR);

  const crawler = new PlaywrightCrawler({
    headless: process.env.HEADED !== "1",
    maxConcurrency: 1,
    maxRequestRetries: 1,
    retryOnBlocked: false,
    useSessionPool: false,
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    launchContext: {
      launchOptions: {
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      },
    },
    async requestHandler({ page }) {
      let body = "";
      for (let i = 0; i < 20; i++) {
        const raw =
          (await page.evaluate(() => document.body && document.body.textContent)) ||
          "";
        const blocked =
          /just a moment|checking your browser|performing security|security service|verifying you are human|attention required|cf-chl/i.test(
            raw.slice(0, 3000),
          );
        if (!blocked && raw.trim().length > 0) {
          body = raw;
          break;
        }
        if (i % 3 === 2) {
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        } else {
          await page.waitForTimeout(2500);
        }
      }
      if (!body) {
        const dump = await page.evaluate(
          () => (document.body && document.body.textContent) || "",
        );
        throw new Error(
          `Blocked even in headless browser. Page dump: ${dump.slice(0, 200)}`,
        );
      }

      let data: any;
      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(`Response is not JSON: ${body.slice(0, 160)}`);
      }

      const downloads: any[] = data.downloads || [];
      console.log(`feed: ${data.name} | downloads: ${downloads.length} | ${url}`);
      const q = query.toLowerCase();
      const hits = q
        ? downloads.filter((d) => (d.title || "").toLowerCase().includes(q))
        : downloads.slice(0, 5);
      if (hits.length === 0) {
        console.log(`no matches for "${query}"`);
        return;
      }
      for (const d of hits) {
        const size = d.fileSize || d.size || "";
        const date = d.uploadDate || d.date || "";
        console.log(`- ${d.title} | ${size} | ${date}`);
        if (d.url) console.log(`  magnet: ${String(d.url).slice(0, 90)}...`);
      }
    },
    async failedRequestHandler({ request }) {
      console.error(
        `FAILED: ${request.url}`,
        request.errorMessages?.slice(-1)[0] || "",
      );
    },
  });

  await crawler.run([{ url, label: "fetch" }]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});