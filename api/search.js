import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import NodeCache from "node-cache";

/* ================= CONFIG ================= */
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour
const BASE_URL = "https://www.ottplay.com/search?q=";
const CURRENT_YEAR = new Date().getFullYear();
const AUTO_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];

/* ============ SPELLING FIX (LEVENSHTEIN) ============ */
function similarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
    }
  }
  return 1 - matrix[b.length][a.length] / Math.max(a.length, b.length);
}

/* ================= API HANDLER ================= */
export default async function handler(req, res) {
  const { q, year, page = 1 } = req.query;

  if (!q) {
    return res.status(400).json({
      error: "Query parameter 'q' is required"
    });
  }

  const cacheKey = `${q}_${year || "auto"}_${page}`;
  if (cache.has(cacheKey)) {
    return res.json({
      premium: true,
      cached: true,
      ...cache.get(cacheKey)
    });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const pageObj = await browser.newPage();
    await pageObj.goto(`${BASE_URL}${encodeURIComponent(q)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await pageObj.waitForTimeout(3000);

    const scraped = await pageObj.evaluate(() => {
      return [...document.querySelectorAll(".card")].map(card => ({
        title: card.querySelector("h2")?.innerText || "",
        year: card.innerText.match(/\b(19|20)\d{2}\b/)?.[0] || null,
        poster: card.querySelector("img")?.src || null,
        description: card.querySelector("p")?.innerText || null,
        ottPlatforms: [...card.querySelectorAll("img")]
          .map(img => img.alt)
          .filter(Boolean),
        ottReleaseDate:
          card.innerText.match(
            /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*?\d{4}\b/
          )?.[0] || null
      }));
    });

    /* ===== SMART FILTERING ===== */
    let filtered = scraped
      .map(item => ({
        ...item,
        score: similarity(q, item.title)
      }))
      .filter(item => item.score >= 0.5);

    /* ===== AUTO YEAR LOGIC ===== */
    if (year) {
      filtered = filtered.filter(i => i.year === year);
    } else {
      filtered = filtered.filter(i =>
        AUTO_YEARS.includes(Number(i.year))
      );
    }

    /* ===== SORT BY RELEVANCE ===== */
    filtered.sort((a, b) => b.score - a.score);

    /* ===== PAGINATION ===== */
    const start = (page - 1) * 10;
    const results = filtered.slice(start, start + 10);

    const response = {
      premium: true,
      query: q,
      detectedYear: year || AUTO_YEARS,
      page: Number(page),
      totalResults: filtered.length,
      results
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "OTT search failed"
    });
  } finally {
    if (browser) await browser.close();
  }
            }
