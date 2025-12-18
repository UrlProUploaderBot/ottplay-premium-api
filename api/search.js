import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser();

const OTT_PLATFORMS = [
  "Netflix",
  "Amazon Prime",
  "Prime Video",
  "Disney+ Hotstar",
  "Hotstar",
  "ZEE5",
  "SonyLIV",
  "JioCinema"
];

function extractOTTInfo(text) {
  const platform =
    OTT_PLATFORMS.find(p =>
      text.toLowerCase().includes(p.toLowerCase())
    ) || null;

  const date =
    text.match(
      /\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s\d{4}\b/
    )?.[0] || null;

  return { platform, date };
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query + " OTT release"
  )}`;
  const r = await fetch(url);
  const xml = await r.text();
  const json = parser.parse(xml);
  return json?.rss?.channel?.item || [];
}

async function fetchOTTplayNews(query) {
  const url = `https://www.ottplay.com/news?search=${encodeURIComponent(query)}`;
  const r = await fetch(url);
  return r.text();
}

export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Query q is required" });
  }

  try {
    // 1️⃣ Google News
    const newsItems = await fetchGoogleNews(q);
    let finalInfo = null;

    for (const item of newsItems) {
      const text = `${item.title} ${item.description || ""}`;
      const info = extractOTTInfo(text);
      if (info.platform) {
        finalInfo = {
          source: "Google News",
          ...info
        };
        break;
      }
    }

    // 2️⃣ OTTplay News (confirmation / fallback)
    let ottplayInfo = null;
    try {
      const ottplayHTML = await fetchOTTplayNews(q);
      const info = extractOTTInfo(ottplayHTML);
      if (info.platform) {
        ottplayInfo = {
          source: "OTTplay News",
          ...info
        };
      }
    } catch {}

    const result = finalInfo || ottplayInfo;

    res.json({
      success: true,
      query: q,
      ott: result
        ? {
            platform: result.platform,
            release_date: result.date,
            status: result.date
              ? "OTT release date announced"
              : "OTT platform announced",
            source: result.source
          }
        : {
            platform: null,
            release_date: null,
            status: "No public OTT announcement found",
            source: null
          },
      note:
        "Data is collected only from public news & announcements (no protected-page scraping)"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch OTT news" });
  }
}
