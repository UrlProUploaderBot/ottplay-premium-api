import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 1800 });

const BASE_URL = "https://www.ottplay.com/search?q=";
const CURRENT_YEAR = new Date().getFullYear();
const AUTO_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1];

// ---------- Spelling similarity ----------
function similarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const dp = Array(b.length + 1).fill(0).map(() => []);
  for (let i = 0; i <= b.length; i++) dp[i][0] = i;
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      dp[i][j] =
        b[i - 1] === a[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(
              dp[i - 1][j - 1] + 1,
              dp[i][j - 1] + 1,
              dp[i - 1][j] + 1
            );
    }
  }
  return 1 - dp[b.length][a.length] / Math.max(a.length, b.length);
}

export default async function handler(req, res) {
  const { q, year, page = 1 } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query q" });

  const cacheKey = `${q}_${year || "auto"}_${page}`;
  if (cache.has(cacheKey)) {
    return res.json({ cached: true, ...cache.get(cacheKey) });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--disable-blink-features=AutomationControlled"
      ],
      executablePath:
        process.env.VERCEL === "1"
          ? await chromium.executablePath()
          : undefined,
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport
    });

    const pageObj = await browser.newPage();

    // 🔥 Anti-bot headers
    await pageObj.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    await pageObj.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9"
    });

    await pageObj.goto(`${BASE_URL}${encodeURIComponent(q)}`, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    await pageObj.waitForTimeout(4000);

    const raw = await pageObj.evaluate(() => {
      const data = [];
      document.querySelectorAll("article, a").forEach(el => {
        const text = el.innerText || "";
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);

        if (text.length > 20 && yearMatch) {
          data.push({
            title: text.split("\n")[0],
            year: yearMatch ? yearMatch[0] : null,
            poster: el.querySelector("img")?.src || null,
            description: text.slice(0, 200),
            ottPlatforms: [...el.querySelectorAll("img")]
              .map(i => i.alt)
              .filter(Boolean),
            ottReleaseDate:
              text.match(
                /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*?\d{4}\b/
              )?.[0] || null
          });
        }
      });
      return data;
    });

    let filtered = raw
      .map(i => ({ ...i, score: similarity(q, i.title) }))
      .filter(i => i.score >= 0.45);

    if (year) {
      filtered = filtered.filter(i => i.year === year);
    } else {
      filtered = filtered.filter(i =>
        AUTO_YEARS.includes(Number(i.year))
      );
    }

    filtered.sort((a, b) => b.score - a.score);

    const start = (page - 1) * 10;
    const results = filtered.slice(start, start + 10);

    const response = {
      success: true,
      query: q,
      detectedYear: year || AUTO_YEARS,
      total: filtered.length,
      page: Number(page),
      results
    };

    cache.set(cacheKey, response);
    res.json(response);

  } catch (err) {
    console.error("SCRAPE FAILED:", err);
    res.json({
      success: false,
      message: "OTTplay blocked request or page structure changed",
      results: []
    });
  } finally {
    if (browser) await browser.close();
  }
}
