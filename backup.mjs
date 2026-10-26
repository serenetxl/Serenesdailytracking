// Weekly backup: reads Serene's data from Firestore and sends it to her private
// Telegram chat as files. Runs from GitHub Actions. Needs Node 18+. No packages.
//
// Secrets (same ones the reminder uses): FIREBASE_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Files sent:
//   serene-app-data-DATE.json   main app data (restore: app > Export / Import > Import)
//   contacts-DATE.csv           contacts, opens in Excel (restore: Import from Excel)
//   contacts-full-DATE.json     everything in the contacts doc (incl. waiting / owed replies)
// Usage: node backup.mjs      (DRY_RUN=1 writes the files to ./backup-out instead of sending)

import { decodeFields, sgLogicalToday } from "./reminder.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const API_KEY = "AIzaSyCUH8mwTFhRbe9w4Ui2RLVs4SFK8zr7lcg"; // public web key, same as the panel
const PROJECT = "serene-s-tracker";
const EMAIL = "txlserene@gmail.com";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function birthdayText(c) {
  if (!c.birthday || !/^\d\d-\d\d$/.test(c.birthday)) return "";
  return `${+c.birthday.slice(3)} ${MON[+c.birthday.slice(0, 2) - 1]}${c.birthYear ? " " + c.birthYear : ""}`;
}
// Same columns the app's Excel import reads, so this file can be imported straight back.
export function contactsToCsv(contacts) {
  const head = ["Name", "IGN / Nickname", "How I know them", "Type (Prospect or Client)", "Class (A-D)", "Important details", "Last messaged", "Birthday"];
  const rows = (contacts || []).map(c => [
    c.name, c.aka, c.knownFrom, c.kind === "client" ? "Client" : "Prospect", c.cls, c.note, c.lastContact || "", birthdayText(c)
  ]);
  return "﻿" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

async function getDocRaw(path, idToken) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (res.status === 404) return null;
  const doc = await res.json();
  if (!res.ok) throw new Error(`Could not read ${path}: ` + JSON.stringify(doc.error || doc));
  return decodeFields(doc.fields || {});
}

async function sendFile(token, chat, name, text, caption) {
  const form = new FormData();
  form.append("chat_id", chat);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([text], { type: "text/plain" }), name);
  const tg = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  if (!tg.ok) throw new Error("Telegram failed: " + (await tg.text()));
}

async function main() {
  const password = process.env.FIREBASE_PASSWORD;
  if (!password) throw new Error("FIREBASE_PASSWORD secret is missing");
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true })
  });
  const auth = await signIn.json();
  if (!signIn.ok) throw new Error("Sign-in failed: " + (auth.error && auth.error.message));

  const appData = await getDocRaw("meta/state", auth.idToken);
  const contactsDoc = await getDocRaw("private/contacts", auth.idToken);
  if (!appData && !contactsDoc) throw new Error("Nothing found to back up.");

  const date = sgLogicalToday();
  const files = [];
  if (appData) files.push([`serene-app-data-${date}.json`, JSON.stringify(appData, null, 2)]);
  if (contactsDoc) {
    files.push([`contacts-${date}.csv`, contactsToCsv(contactsDoc.contacts)]);
    files.push([`contacts-full-${date}.json`, JSON.stringify(contactsDoc, null, 2)]);
  }

  if (process.env.DRY_RUN) {
    mkdirSync("backup-out", { recursive: true });
    for (const [n, t] of files) writeFileSync(`backup-out/${n}`, t);
    console.log("Wrote", files.map(f => f[0]).join(", "));
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secret is missing");
  const n = (contactsDoc && contactsDoc.contacts || []).length;
  for (let i = 0; i < files.length; i++) {
    await sendFile(token, chat, files[i][0], files[i][1], i === 0 ? `Weekly backup ${date} · ${n} contacts. Keep these files somewhere safe.` : "");
  }
  console.log("Backup sent:", files.map(f => f[0]).join(", "));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
