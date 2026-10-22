// Sends Serene a Telegram message listing who she should message today and who
// she should check back with. Runs on a schedule from GitHub Actions.
// Needs Node 18+ (built-in fetch). No packages.
//
// Secrets (set in GitHub: Settings > Secrets and variables > Actions):
//   FIREBASE_PASSWORD   Serene's login password for the panel
//   TELEGRAM_BOT_TOKEN  the bot token (same one used in engine.js)
//   TELEGRAM_CHAT_ID    where to send it (Serene's own chat with the bot)
// Optional: TELEGRAM_THREAD_ID (only if sending into a group topic)
//
// Usage: node reminder.mjs morning|evening      (add DRY_RUN=1 to print only)

const API_KEY = "AIzaSyCUH8mwTFhRbe9w4Ui2RLVs4SFK8zr7lcg"; // public web key, same as the panel
const PROJECT = "serene-s-tracker";
const EMAIL = "txlserene@gmail.com";

// ---- date helpers: Serene's day runs 3am to 3am, Singapore time ----
export function sgLogicalToday(nowMs = Date.now()) {
  const d = new Date(nowMs + 8 * 3600e3 - 3 * 3600e3); // shift to SGT, then back 3h
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400e3); }

// ---- Firestore REST value decoder ----
export function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
export function decodeFields(f) {
  const o = {};
  for (const k of Object.keys(f)) o[k] = decodeValue(f[k]);
  return o;
}

// ---- build the message ----
const CLASS_ORDER = ["A", "B", "C", "D"];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Birthdays are stored as "MM-DD". Feb 29 counts as Feb 28 in non-leap years.
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function bdayOn(md, dateStr) {
  if (!md) return false;
  const tail = dateStr.slice(5);
  return md === tail || (md === "02-29" && tail === "02-28" && !isLeap(+dateStr.slice(0, 4)));
}
function addDay(dateStr, n = 1) { return new Date(Date.parse(dateStr) + n * 86400e3).toISOString().slice(0, 10); }
const label = c => `${esc(c.name)} (${c.kind === "client" ? "Client" : "Prospect"} ${esc(c.cls)})`;
// Age they turn on `dateStr`, if we know their birth year. For clients also show insurance age (age next birthday).
function turningNote(c, dateStr) {
  const by = Number(c.birthYear);
  const n = by ? +dateStr.slice(0, 4) - by : 0;
  if (!(n > 0 && n < 120)) return "";
  return c.kind === "client" ? ` – turning ${n}, insurance age ${n}→${n + 1}` : ` – turning ${n}`;
}

export function buildMessage(data, today, mode) {
  const all = data.contacts || [];
  const year = +today.slice(0, 4);
  const contacts = all.filter(c => c.nextDue && c.nextDue <= today);
  const chase = (data.followUps || []).filter(f => !f.done && f.chaseDate && f.chaseDate <= today);
  // Morning: today's birthdays + a heads-up for tomorrow. Evening: only today's not yet wished.
  const bdToday = all.filter(c => bdayOn(c.birthday, today) && (mode !== "evening" || c.bdayWished !== year));
  const bdTomorrow = mode === "evening" ? [] : all.filter(c => bdayOn(c.birthday, addDay(today)));
  if (!contacts.length && !chase.length && !bdToday.length && !bdTomorrow.length) return null;

  const lines = [];
  lines.push(mode === "evening" ? "<b>Still pending today</b>" : "<b>Good morning. Your 定联 for today</b>");

  if (bdToday.length) {
    lines.push("");
    lines.push(`<b>🎂 Birthday today (${bdToday.length})</b>`);
    for (const c of bdToday) lines.push(`• ${label(c)}${turningNote(c, today)}${c.note ? " | " + esc(String(c.note).slice(0, 80)) : ""}`);
  }
  if (bdTomorrow.length) {
    lines.push("");
    lines.push(`<b>🎂 Birthday tomorrow (${bdTomorrow.length})</b>`);
    for (const c of bdTomorrow) lines.push(`• ${label(c)}${turningNote(c, addDay(today))}`);
  }
  if (contacts.length) {
    lines.push("");
    lines.push(`<b>Message these people (${contacts.length})</b>`);
    const MAX = 15;
    const sorted = [...contacts].sort((a, b) =>
      (CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls)) || (a.nextDue < b.nextDue ? -1 : 1));
    for (const c of sorted.slice(0, MAX)) {
      const late = daysBetween(c.nextDue, today);
      lines.push(`• ${label(c)}${late > 0 ? ` – ${late}d overdue` : ""}`);
    }
    if (sorted.length > MAX) lines.push(`…and ${sorted.length - MAX} more in the panel`);
  }
  if (chase.length) {
    lines.push("");
    lines.push(`<b>Check back with (${chase.length})</b>`);
    for (const f of chase.slice(0, 15)) {
      lines.push(`• ${esc(f.name)}${f.about ? " – " + esc(f.about) : ""}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const mode = process.argv[2] === "evening" ? "evening" : "morning";
  const password = process.env.FIREBASE_PASSWORD;
  if (!password) throw new Error("FIREBASE_PASSWORD secret is missing");

  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true })
  });
  const auth = await signIn.json();
  if (!signIn.ok) throw new Error("Sign-in failed: " + (auth.error && auth.error.message));

  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/private/contacts`, {
    headers: { Authorization: `Bearer ${auth.idToken}` }
  });
  if (res.status === 404) { console.log("No contacts saved yet. Nothing to remind."); return; }
  const doc = await res.json();
  if (!res.ok) throw new Error("Could not read contacts: " + JSON.stringify(doc.error || doc));
  const data = decodeFields(doc.fields || {});

  const today = sgLogicalToday();
  const text = buildMessage(data, today, mode);
  if (!text) { console.log("Nobody due. No message sent."); return; }

  if (process.env.DRY_RUN) { console.log(text); return; }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing");
  const body = { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (process.env.TELEGRAM_THREAD_ID) body.message_thread_id = Number(process.env.TELEGRAM_THREAD_ID);
  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!tg.ok) throw new Error("Telegram failed: " + (await tg.text()));
  console.log("Reminder sent.");
}

// Only run when called directly (so tests can import the helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
