// Sends Serene a short morning news digest on Telegram: Singapore business/finance
// first, then global. Headlines + links only (the publishers own the article text).
// Runs from GitHub Actions. Needs Node 18+. No packages.
//
// Secrets (same as the reminders): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Usage: node news.mjs        (DRY_RUN=1 prints the message instead of sending it)
//
// To add or drop a source, edit FEEDS below. To bump topics you care about, edit KEYWORDS.

const FEEDS = [
  { region: "sg", name: "ST",      url: "https://www.straitstimes.com/news/business/rss.xml" },
  { region: "sg", name: "CNA",     url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936" },
  { region: "sg", name: "BT",      url: "https://www.businesstimes.com.sg/rss/top-stories" },
  { region: "sg", name: "BT Mkts", url: "https://www.businesstimes.com.sg/rss/companies-markets" },
  { region: "global", name: "BBC",      url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { region: "global", name: "Guardian", url: "https://www.theguardian.com/uk/business/rss" },
  { region: "global", name: "CNBC",     url: "https://www.cnbc.com/id/10001147/device/rss/rss.html" },
];
// Headlines containing these float to the top of each section.
const KEYWORDS = ["mas", "insur", "aia", "prudential", "great eastern", "income", "manulife", "interest rate", "rate cut", "rate hike",
  "fed ", "sora", "inflation", "cpf", "gdp", "recession", "property", "mortgage", "stocks", "sti ", "bond", "tariff", "medishield",
  "healthcare", "retire", "annuit", "unit trust", "etf", "singapore dollar", "dollar", "oil", "gold", "bank"];
const PER_SECTION = { sg: 6, global: 5 };
const MAX_AGE_H = 36;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unent = s => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? unent(m[1]).trim() : ""; };

// Reads RSS <item> or Atom <entry>.
export function parseFeed(xml) {
  const items = [];
  const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
  for (const m of xml.matchAll(re)) {
    const b = m[0];
    const title = tag(b, "title").replace(/\s+/g, " ");
    let link = tag(b, "link");
    if (!link) { const h = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (h) link = unent(h[1]); }
    const date = Date.parse(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")) || null;
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date });
  }
  return items;
}

export function score(title) { const t = " " + title.toLowerCase() + " "; return KEYWORDS.filter(k => t.includes(k)).length; }

export function pick(items, region, now = Date.now()) {
  const seen = new Set();
  const fresh = items.filter(i => i.region === region && (!i.date || now - i.date <= MAX_AGE_H * 3600e3));
  const pool = fresh.length ? fresh : items.filter(i => i.region === region);
  pool.sort((a, b) => score(b.title) - score(a.title) || (b.date || 0) - (a.date || 0));
  const out = [];
  for (const i of pool) {
    const k = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 60);   // same story from two feeds
    if (seen.has(k)) continue;
    seen.add(k); out.push(i);
    if (out.length >= PER_SECTION[region]) break;
  }
  return out;
}

export function buildMessage(items, failed, dateLabel, now = Date.now()) {
  const line = i => `• <a href="${esc(i.link)}">${esc(i.title.length > 140 ? i.title.slice(0, 137) + "…" : i.title)}</a> <i>(${esc(i.src)})</i>`;
  const sg = pick(items, "sg", now), gl = pick(items, "global", now);
  if (!sg.length && !gl.length) return null;
  const out = [`📰 <b>Morning news · ${esc(dateLabel)}</b>`];
  if (sg.length) { out.push("", "<b>Singapore business &amp; finance</b>"); sg.forEach(i => out.push(line(i))); }
  if (gl.length) { out.push("", "<b>Global</b>"); gl.forEach(i => out.push(line(i))); }
  if (failed.length) out.push("", `<i>Couldn't load: ${esc(failed.join(", "))}</i>`);
  return out.join("\n");
}

async function loadFeed(f) {
  const res = await fetch(f.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SereneNewsDigest/1.0)", "Accept": "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(20000), redirect: "follow"
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const items = parseFeed(await res.text());
  if (!items.length) throw new Error("no items");
  return items.map(i => ({ ...i, region: f.region, src: f.name }));
}

async function main() {
  const all = [], failed = [];
  await Promise.all(FEEDS.map(async f => {
    try { all.push(...await loadFeed(f)); }
    catch (e) { failed.push(f.name); console.error(`Feed ${f.name} failed: ${e.message}`); }
  }));
  const dateLabel = new Date(Date.now() + 8 * 3600e3).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  let text = buildMessage(all, failed, dateLabel);
  if (!text) text = `📰 <b>Morning news · ${esc(dateLabel)}</b>\nNo headlines loaded today. Couldn't load: ${esc(failed.join(", ") || "all feeds")}.`;
  if (process.env.DRY_RUN) { console.log(text); return; }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing");
  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!tg.ok) throw new Error("Telegram failed: " + (await tg.text()));
  console.log("News sent.", failed.length ? "Failed feeds: " + failed.join(", ") : "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
