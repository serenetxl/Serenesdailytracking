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

// ---- "activity is slow" watch ----
// Runs once a day (evening run). If Serene's numbers haven't moved for SLOW_DAYS days it
// tells Odin once, then again every SLOW_DAYS days while it stays flat. Skipped while Away mode is on.
// "Numbers" = FYCC total, the pipeline (cases, stages, FYC), and the running totals of FYCC earned,
// appointments and follow-ups across all weeks. The last-seen fingerprint is kept in meta/activityWatch.
export const SLOW_DAYS = 7;
export function activityFingerprint(state) {
  const sum = key => [state.currentWeek, ...(state.weekHistory || [])]
    .reduce((t, w) => t + (Number(w && w.stats && w.stats[key]) || 0), 0);
  const cases = (state.pipeline && state.pipeline.cases || [])
    .map(c => `${c.id}:${c.stage}:${Number(c.fyc) || 0}`).sort();
  return JSON.stringify({
    fycc: Number(state.goal && state.goal.currentFYCC) || 0,
    earned: sum("fycc"), appts: sum("appointments"), follow: sum("followups"), cases
  });
}
export function activityCheck(state, watch, today) {
  const sig = activityFingerprint(state);
  const away = (state.awayDays || []).includes(today);
  if (!watch || watch.sig !== sig || away) return { next: { sig, since: today, lastPing: (watch && watch.lastPing) || null }, ping: null };
  const flat = daysBetween(watch.since, today);
  const lastPing = watch.lastPing || null;
  if (flat >= SLOW_DAYS && (!lastPing || daysBetween(lastPing, today) >= SLOW_DAYS)) {
    const f = JSON.parse(sig);
    const text = `📉 <b>Heads up:</b> Serene's numbers haven't moved for ${flat} days.\n` +
      `• FYCC progress: $${f.fycc.toLocaleString("en-SG")}\n` +
      `• Pipeline: ${f.cases.length} case${f.cases.length === 1 ? "" : "s"}, nothing changed stage or value\n` +
      `• No new appointments or follow-ups logged\n` +
      `Activity looks slow. (Auto-check; if she's been busy offline, she may just not have logged it.)`;
    return { next: { sig, since: watch.since, lastPing: today }, ping: text };
  }
  return { next: { sig, since: watch.since, lastPing }, ping: null };
}
const encStr = v => v == null ? { nullValue: null } : { stringValue: String(v) };

async function runActivityWatch(auth, today) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta`;
  const headers = { Authorization: `Bearer ${auth.idToken}` };
  const stRes = await fetch(`${base}/state`, { headers });
  if (!stRes.ok) throw new Error("Could not read state: " + stRes.status);
  const state = decodeFields((await stRes.json()).fields || {});
  const wRes = await fetch(`${base}/activityWatch`, { headers });
  const watch = wRes.ok ? decodeFields((await wRes.json()).fields || {}) : null;
  const { next, ping } = activityCheck(state, watch, today);
  if (process.env.DRY_RUN) { console.log("Activity watch:", JSON.stringify(next), ping ? "\n" + ping : "(no ping)"); return; }
  if (ping) {
    const { TELEGRAM } = await import("./engine.js");
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_thread_id: TELEGRAM.THREAD_ID, text: ping, parse_mode: "HTML" })
    });
    if (!r.ok) throw new Error("Odin ping failed: " + (await r.text()));
    console.log("Slow-activity ping sent to Odin.");
  }
  const w = await fetch(`${base}/activityWatch`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { sig: encStr(next.sig), since: encStr(next.since), lastPing: encStr(next.lastPing) } })
  });
  if (!w.ok) throw new Error("Could not save activity watch: " + w.status);
}

// ---- reminder for Odin: things waiting for his approval ----
// Runs with the morning job. Lists every submitted day still waiting, with its date and how old it is,
// plus any late-submit requests, and posts it in the tracker topic where Odin already gets the other pings.
export function approvalNudge(state, lateReqs, today) {
  const waiting = [];
  const t = state.today || {};
  if (t.date && t.submittedForApproval && t.approval && t.approval.status === "pending") waiting.push(t.date);
  (state.dayHistory || []).slice(0, 10).forEach(d => { if (d.submitted && d.approval === "pending") waiting.push(d.date); });
  const late = (lateReqs || []).filter(r => r && r.status === "pending");
  if (!waiting.length && !late.length) return null;
  const nice = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const ago = d => { const n = daysBetween(d, today); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
  const lines = ["⏳ <b>Waiting for your approval</b>"];
  [...new Set(waiting)].sort().reverse().forEach(d => lines.push(`• ${nice(d)} (${ago(d)})`));
  late.forEach(r => lines.push(`• Late-submit request for ${nice(r.date)}`));
  lines.push("Open the panel to approve or decline.");
  return lines.join("\n");
}
async function runApprovalNudge(auth, today) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${auth.idToken}` };
  const stRes = await fetch(`${base}/meta/state`, { headers });
  if (!stRes.ok) throw new Error("Could not read state: " + stRes.status);
  const state = decodeFields((await stRes.json()).fields || {});
  const lr = await fetch(`${base}/lateRequests`, { headers });
  const late = lr.ok ? ((await lr.json()).documents || []).map(d => decodeFields(d.fields || {})) : [];
  const msg = approvalNudge(state, late, today);
  if (!msg) { console.log("Nothing waiting for Odin."); return; }
  if (process.env.DRY_RUN) { console.log(msg); return; }
  const { TELEGRAM } = await import("./engine.js");
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM.CHAT_ID, message_thread_id: TELEGRAM.THREAD_ID, text: msg, parse_mode: "HTML" })
  });
  if (!r.ok) throw new Error("Odin approval nudge failed: " + (await r.text()));
  console.log("Approval nudge sent to Odin.");
}

// ---- "submit your day" nudge ----
// Runs late in the evening. If today isn't submitted yet (and it's not an away day) it sends
// Serene a Telegram message, so a forgotten Submit Day doesn't quietly break the streak.
export function submitNudge(state, today) {
  if ((state.awayDays || []).includes(today)) return null;
  const t = state.today || {};
  if (t.date === today && t.submittedForApproval) return null;
  const done = (t.quests || []).filter(q => q && q.status === "completed").length;
  const streak = Number(state.points && state.points.streakDays) || 0;
  const opened = t.date === today;
  return `⏰ <b>Submit your day</b>\n` +
    (opened ? `Quests ${done}/3 so far. ` : `You haven't opened the app today. `) +
    (streak > 0 ? `Your ${streak}-day streak is on the line.` : `Don't let today roll over unsubmitted.`) +
    `\nOpen the app and press Submit Day before 3am.`;
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
  lines.push(mode === "evening" ? "<b>Still pending today</b>" : "<b>Your 定联 for today</b>");

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
  const owe = chase.filter(f => f.dir === "owe");
  const wait = chase.filter(f => f.dir !== "owe");
  if (owe.length) {
    lines.push("");
    lines.push(`<b>You owe a reply (${owe.length})</b>`);
    for (const f of owe.slice(0, 15)) {
      lines.push(`• ${esc(f.name)}${f.about ? " – " + esc(f.about) : ""}`);
    }
  }
  if (wait.length) {
    lines.push("");
    lines.push(`<b>Check back with (${wait.length})</b>`);
    for (const f of wait.slice(0, 15)) {
      lines.push(`• ${esc(f.name)}${f.about ? " – " + esc(f.about) : ""}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const arg = process.argv[2];
  const mode = arg === "evening" ? "evening" : arg === "submit" ? "submit" : "morning";
  const password = process.env.FIREBASE_PASSWORD;
  if (!password) throw new Error("FIREBASE_PASSWORD secret is missing");

  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true })
  });
  const auth = await signIn.json();
  if (!signIn.ok) throw new Error("Sign-in failed: " + (auth.error && auth.error.message));

  if (mode === "submit") {
    const stRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta/state`, { headers: { Authorization: `Bearer ${auth.idToken}` } });
    if (!stRes.ok) throw new Error("Could not read state: " + stRes.status);
    const msg = submitNudge(decodeFields((await stRes.json()).fields || {}), sgLogicalToday());
    if (!msg) { console.log("Already submitted (or away). No nudge."); return; }
    if (process.env.DRY_RUN) { console.log(msg); return; }
    const tok = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !chatId) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing");
    const nb = { chat_id: chatId, text: msg, parse_mode: "HTML" };
    if (process.env.TELEGRAM_THREAD_ID) nb.message_thread_id = Number(process.env.TELEGRAM_THREAD_ID);
    const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nb) });
    if (!r.ok) throw new Error("Telegram failed: " + (await r.text()));
    console.log("Submit nudge sent.");
    return;
  }

  // Morning run only: tell Odin if anything is waiting for his approval. Never blocks the reminder.
  if (mode === "morning") {
    try { await runApprovalNudge(auth, sgLogicalToday()); }
    catch (e) { console.error("Approval nudge failed (non-fatal): " + e.message); }
  }

  // Evening run only: check whether Serene's numbers have gone flat. Never blocks the reminder.
  if (mode === "evening") {
    try { await runActivityWatch(auth, sgLogicalToday()); }
    catch (e) { console.error("Activity watch failed (non-fatal): " + e.message); }
  }

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
