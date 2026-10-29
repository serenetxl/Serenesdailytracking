// Sends Serene a short morning news digest on Telegram: Singapore, World, and a
// "Your industry" section (insurance / retirement / MAS / rates). Each story is the
// headline (linked) plus the publisher's own one-line blurb.
// Runs from GitHub Actions. Needs Node 18+. No packages.
//
// Secrets (same as the reminders): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Usage: node news.mjs        (DRY_RUN=1 prints the message instead of sending it)
//
// To add or drop a source, edit FEEDS below. To change what counts as "your industry", edit INDUSTRY_KEYWORDS.

const FEEDS = [
  // Singapore, general
  { section: "sg", name: "CNA",     url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416" },
  { section: "sg", name: "ST",      url: "https://www.straitstimes.com/news/singapore/rss.xml" },
  // World, general
  { section: "world", name: "BBC",      url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { section: "world", name: "Guardian", url: "https://www.theguardian.com/world/rss" },
  { section: "world", name: "CNA",      url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311" },
  // Industry: finance feeds, filtered to insurance / retirement / MAS / health-cost type stories
  { section: "ind", name: "ST",      url: "https://www.straitstimes.com/news/business/rss.xml" },
  { section: "ind", name: "CNA",     url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936" },
  { section: "ind", name: "BT",      url: "https://www.businesstimes.com.sg/rss/top-stories" },
  { section: "ind", name: "BT Mkts", url: "https://www.businesstimes.com.sg/rss/companies-markets" },
  { section: "ind", name: "BBC",     url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { section: "ind", name: "Guardian", url: "https://www.theguardian.com/uk/business/rss" },
];
// A story goes in "Your industry" only if its headline or blurb has one of these.
const INDUSTRY_KEYWORDS = ["mas ", "monetary authority", "insur", "aia", "prudential", "great eastern", "income ", "manulife", "cpf", "medishield",
  "careshield", "healthcare", "health care", "hospital", "retire", "annuit", "pension", "unit trust", "etf", "wealth", "financial advis",
  "interest rate", "rate cut", "rate hike", "fed ", "sora", "inflation", "mortgage", "property cooling", "singapore dollar", "tariff", "recession", "gdp"];
const SECTIONS = [
  { key: "sg",    title: "Singapore",     n: 4 },
  { key: "world", title: "World",         n: 4 },
  { key: "ind",   title: "Your industry", n: 3 },
];
const MAX_AGE_H = 36;
const BLURB_MAX = 130;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unent = s => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? unent(m[1]).trim() : ""; };

// The publisher's own one-line blurb, cleaned up and cut at a word boundary.
export function cleanBlurb(raw, title) {
  let t = unent(unent(raw || "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const norm = x => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(t) === norm(title) || norm(t).startsWith(norm(title)) && norm(t).length < norm(title).length + 15) return "";
  if (t.length > BLURB_MAX) { t = t.slice(0, BLURB_MAX - 1); t = t.slice(0, t.lastIndexOf(" ") > 60 ? t.lastIndexOf(" ") : t.length) + "…"; }
  return t;
}

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
    const blurb = cleanBlurb(tag(b, "description") || tag(b, "summary"), title);
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date, blurb });
  }
  return items;
}

export function industryScore(i) { const t = " " + (i.title + " " + i.blurb).toLowerCase() + " "; return INDUSTRY_KEYWORDS.filter(k => t.includes(k)).length; }
const storyKey = i => i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 60);

// Picks per section. "Your industry" goes first so those stories aren't used up by the general lists.
// General sections take the newest stories but rotate across outlets so one paper doesn't fill the list.
export function pickAll(items, now = Date.now()) {
  const used = new Set(), result = {};
  const fresh = items.filter(i => !i.date || now - i.date <= MAX_AGE_H * 3600e3);
  const order = ["ind", "sg", "world"];
  for (const key of order) {
    const sec = SECTIONS.find(s => s.key === key);
    let pool = fresh.filter(i => i.section === key);
    if (key === "ind") pool = pool.filter(i => industryScore(i) > 0).sort((a, b) => industryScore(b) - industryScore(a) || (b.date || 0) - (a.date || 0));
    else pool.sort((a, b) => (b.date || 0) - (a.date || 0));
    const bySrc = {};
    pool.forEach(i => (bySrc[i.src] = bySrc[i.src] || []).push(i));
    const queues = Object.values(bySrc);
    const ordered = key === "ind" ? pool : [];
    if (key !== "ind") { for (let r = 0; queues.some(q => q[r]); r++) queues.forEach(q => { if (q[r]) ordered.push(q[r]); }); }
    const out = [];
    for (const i of ordered) {
      const k = storyKey(i);
      if (used.has(k)) continue;
      used.add(k); out.push(i);
      if (out.length >= sec.n) break;
    }
    result[key] = out;
  }
  return result;
}

export function buildMessage(items, failed, dateLabel, now = Date.now()) {
  const picked = pickAll(items, now);
  if (!SECTIONS.some(s => picked[s.key].length)) return null;
  const render = withBlurbs => {
    const line = i => `• <a href="${esc(i.link)}">${esc(i.title.length > 140 ? i.title.slice(0, 137) + "…" : i.title)}</a> <i>(${esc(i.src)})</i>` + (withBlurbs && i.blurb ? `\n${esc(i.blurb)}` : "");
    const out = [`📰 <b>Morning news · ${esc(dateLabel)}</b>`];
    for (const s of SECTIONS) {
      if (!picked[s.key].length) continue;
      out.push("", `<b>${esc(s.title)}</b>`);
      picked[s.key].forEach(i => out.push(line(i)));
    }
    if (failed.length) out.push("", `<i>Couldn't load: ${esc([...new Set(failed)].join(", "))}</i>`);
    return out.join("\n");
  };
  // Telegram caps a message at 4096 characters; cutting mid-tag breaks it, so drop the blurbs instead.
  const full = render(true);
  return full.length <= 3900 ? full : render(false);
}

async function loadFeed(f) {
  const res = await fetch(f.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SereneNewsDigest/1.0)", "Accept": "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(20000), redirect: "follow"
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const items = parseFeed(await res.text());
  if (!items.length) throw new Error("no items");
  return items.map(i => ({ ...i, section: f.section, src: f.name }));
}

async function main() {
  const all = [], failed = [];
  await Promise.all(FEEDS.map(async f => {
    try { all.push(...await loadFeed(f)); }
    catch (e) { failed.push(f.section + "/" + f.name); console.error(`Feed ${f.name} failed: ${e.message}`); }
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
