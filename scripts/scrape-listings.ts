/**
 * General-purpose listing scraper using Playwright.
 * Handles JavaScript-heavy sites (LoopNet, CoStar, etc.)
 *
 * Setup (run once on your machine):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Usage:
 *   npx tsx scripts/scrape-listings.ts
 *
 * Config: edit the CONFIG block below to point at any site.
 * Output: writes JSON + CSV to ./scrape-output/
 */

import { chromium, type Page, type Browser } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Edit this section to target any site.

const CONFIG = {
  // Starting URL (search results page)
  startUrl:
    "https://www.loopnet.com/search/commercial-real-estate/portland-or/for-lease/",

  // Login credentials (leave blank if no login needed)
  login: {
    url: "",               // e.g. "https://www.loopnet.com/login/"
    usernameSelector: "",  // e.g. 'input[name="email"]'
    passwordSelector: "",  // e.g. 'input[name="password"]'
    submitSelector: "",    // e.g. 'button[type="submit"]'
    username: process.env.SCRAPE_USERNAME ?? "",
    password: process.env.SCRAPE_PASSWORD ?? "",
  },

  // CSS selector that matches each listing card on the results page
  listingSelector: ".placard-content, .listing-card, article[data-id]",

  // Fields to extract from each listing card.
  // Key = field name in output, value = CSS selector relative to the card.
  fields: {
    name:       ".placard-title, .listing-name, h3",
    address:    ".placard-address, .listing-address, [data-address]",
    price:      ".placard-price, .price, [data-price]",
    sqft:       ".placard-sqft, .sqft, [data-sqft]",
    type:       ".placard-type, .property-type, [data-type]",
    url:        "a",          // href attribute will be extracted
    available:  ".available, .availability",
  },

  // Pagination: selector for the "Next page" button (null = no pagination)
  nextPageSelector: "a[aria-label='Next page'], .pagination-next, button.next",

  // Max pages to scrape (set to 1 to test a single page)
  maxPages: 10,

  // Delay between pages in ms (be respectful, avoid hammering)
  pageDelayMs: 2000,

  // Output folder
  outputDir: "./scrape-output",

  // Run headless (true = invisible browser, false = see what it's doing)
  headless: false,
};

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Listing = Record<string, string>;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toCSV(rows: Listing[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ];
  return lines.join("\n");
}

// ─── SCRAPER ─────────────────────────────────────────────────────────────────

async function login(page: Page) {
  const { url, usernameSelector, passwordSelector, submitSelector, username, password } =
    CONFIG.login;
  if (!url || !username || !password) return;

  console.log("  Logging in...");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.fill(usernameSelector, username);
  await page.fill(passwordSelector, password);
  await page.click(submitSelector);
  await page.waitForNavigation({ waitUntil: "networkidle" });
  console.log("  ✓ Logged in");
}

async function scrapePage(page: Page): Promise<Listing[]> {
  // Wait for listings to appear
  try {
    await page.waitForSelector(CONFIG.listingSelector, { timeout: 10_000 });
  } catch {
    console.warn("  No listings found on this page — check listingSelector");
    return [];
  }

  const listings = await page.$$eval(
    CONFIG.listingSelector,
    (cards, fields) => {
      return cards.map((card) => {
        const result: Record<string, string> = {};
        for (const [key, selector] of Object.entries(fields)) {
          const el = card.querySelector(selector as string);
          if (!el) { result[key] = ""; continue; }
          if (key === "url" && el.tagName === "A") {
            result[key] = (el as HTMLAnchorElement).href;
          } else {
            result[key] = el.textContent?.trim() ?? "";
          }
        }
        return result;
      });
    },
    CONFIG.fields
  );

  return listings;
}

async function scrapeDetailPage(page: Page, url: string): Promise<Partial<Listing>> {
  // Optional: visit each listing's detail page for more data
  // Extend this if you want to follow links and scrape deeper info
  return {};
}

async function run() {
  console.log("\n🕷️  Scraper starting");
  console.log(`   Target: ${CONFIG.startUrl}`);
  console.log(`   Max pages: ${CONFIG.maxPages}`);
  console.log(`   Headless: ${CONFIG.headless}\n`);

  if (!existsSync(CONFIG.outputDir)) mkdirSync(CONFIG.outputDir, { recursive: true });

  const browser: Browser = await chromium.launch({
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled", // reduce bot detection
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Hide automation signals
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const allListings: Listing[] = [];
  let pageNum = 0;

  try {
    if (CONFIG.login.url) await login(page);

    await page.goto(CONFIG.startUrl, { waitUntil: "networkidle", timeout: 30_000 });

    while (pageNum < CONFIG.maxPages) {
      pageNum++;
      console.log(`  Scraping page ${pageNum}...`);

      const listings = await scrapePage(page);
      allListings.push(...listings);
      console.log(`  ✓ ${listings.length} listings found (${allListings.length} total)`);

      if (!CONFIG.nextPageSelector) break;

      const nextBtn = await page.$(CONFIG.nextPageSelector);
      if (!nextBtn) {
        console.log("  No next page — done.");
        break;
      }

      await nextBtn.click();
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {
        // Some SPAs don't trigger navigation events
      });
      await sleep(CONFIG.pageDelayMs);
    }
  } finally {
    await browser.close();
  }

  // ── Write output ────────────────────────────────────────────────────────────

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const jsonPath = join(CONFIG.outputDir, `listings-${timestamp}.json`);
  const csvPath  = join(CONFIG.outputDir, `listings-${timestamp}.csv`);

  writeFileSync(jsonPath, JSON.stringify(allListings, null, 2));
  writeFileSync(csvPath,  toCSV(allListings));

  console.log(`\n✅ Done — ${allListings.length} listings scraped`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   CSV:  ${csvPath}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
