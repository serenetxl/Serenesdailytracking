// Short news nudge on Telegram: 3 headlines (Singapore, World, Industry) + a one-tap CNA Fast link.
// Runs from GitHub Actions. Node 18+, no packages.
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Usage: node news.mjs [morning|evening]   (DRY_RUN=1 prints instead of sending)

const FAST_URL = "https://www.channelnewsasia.com/fast";
const FEEDS = [
  { slot: "sg",       name: "ST",   url: "https://www.straitstimes.com/news/singapore/rss.xml" },
  { slot: "world",    name: "BBC",  url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { slot: "world",    name: "ST",   url: "https://www.straitstimes.com/news/world/rss.xml" },
  { slot: "industry", name: "BT",   url: "https://www.businesstimes.com.sg/rss/top-stories" },
  { slot: "industry", name: "ST",   url: "https://www.straitstimes.com/news/business/rss.xml" },
  { slot: "industry", name: "CNA",  url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936" },
];
// Industry headline = the freshest story that mentions one of these (falls back to top business story).
const KEYWORDS = ["mas", "insur", "aia", "prudential", "great eastern", "income", "manulife", "interest rate", "rate cut", "rate hike",
  "fed ", "sora", "inflation", "cpf", "gdp", "recession", "property", "mortgage", "bond", "tariff", "medishield", "healthcare",
  "retire", "annuit", "unit trust", "etf", "singapore dollar", "bank", "wealth", "fund"];
const MAX_AGE_H = 30;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unent = s => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? unent(m[1]).trim() : ""; };

export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const title = tag(b, "title").replace(/\s+/g, " ");
    let link = tag(b, "link");
    if (!link) { const h = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (h) link = unent(h[1]); }
    const date = Date.parse(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")) || null;
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date });
  }
  return items;
}
const score = t => { const s = " " + t.toLowerCase() + " "; return KEYWORDS.filter(k => s.includes(k)).length; };

export function pickOne(items, slot, used, now = Date.now()) {
  const all = items.filter(i => i.slot === slot && !used.has(i.link));
  const fresh = all.filter(i => !i.date || now - i.date <= MAX_AGE_H * 3600e3);
  const pool = (fresh.length ? fresh : all).slice();
  if (slot === "industry") pool.sort((a, b) => score(b.title) - score(a.title) || (b.date || 0) - (a.date || 0));
  else pool.sort((a, b) => (b.date || 0) - (a.date || 0));
  return pool[0] || null;
}

export function buildMessage(items, label, now = Date.now()) {
  const used = new Set();
  const row = (emoji, name, i) => { if (i) used.add(i.link); return i ? `${emoji} <b>${name}:</b> <a href="${esc(i.link)}">${esc(i.title.length > 120 ? i.title.slice(0, 117) + "…" : i.title)}</a>` : null; };
  const lines = [`📰 <b>${esc(label)}</b>`];
  for (const [slot, emoji, name] of [["sg", "🇸🇬", "Singapore"], ["world", "🌏", "World"], ["industry", "💼", "Industry"]]) {
    const l = row(emoji, name, pickOne(items, slot, used, now));
    if (l) lines.push(l);
  }
  lines.push("", `👉 <a href="${FAST_URL}">CNA Fast: 2-min catch-up</a>`);
  return lines.join("\n");
}

async function loadFeed(f) {
  const res = await fetch(f.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SereneNewsDigest/1.0)", "Accept": "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(20000), redirect: "follow"
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const items = parseFeed(await res.text());
  if (!items.length) throw new Error("no items");
  return items.map(i => ({ ...i, slot: f.slot, src: f.name }));
}

async function main() {
  const mode = (process.argv[2] || process.env.NEWS_MODE || "morning").toLowerCase() === "evening" ? "evening" : "morning";
  const all = [];
  await Promise.all(FEEDS.map(async f => {
    try { all.push(...await loadFeed(f)); } catch (e) { console.error(`Feed ${f.name} failed: ${e.message}`); }
  }));
  const label = mode === "evening" ? "Evening news" : "Morning news";
  const text = buildMessage(all, label);   // always includes the CNA Fast link, even if every feed fails
  if (process.env.DRY_RUN) { console.log(text); return; }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing");
  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!tg.ok) throw new Error("Telegram failed: " + (await tg.text()));
  console.log("News sent.");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
