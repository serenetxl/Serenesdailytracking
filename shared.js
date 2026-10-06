// ============================================================================
// Serene // Life Control Panel + Odin Tracker — shared Firebase module
// Imported by both serene.html and odin.html as an ES module:
//   <script type="module" src="./shared.js"></script>
// Pure data/points logic lives in engine.js (no Firebase deps, Node-testable).
// This file adds the Firebase bootstrap and re-exports everything from
// engine.js so each page only needs one import line.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export * from "./engine.js";
import { FIREBASE_CONFIG } from "./engine.js";

// ----------------------------------------------------------------------------
// FIRESTORE DATA MODEL (Task 1 deliverable)
// ----------------------------------------------------------------------------
// /meta/state            single doc — everything that isn't a per-day log:
//    {
//      goal: { currentFYCC, targetFYCC },
//      weeklyTargets: { appointments, followups, exercise },   // fycc is computed
//      currentWeekStart: "YYYY-MM-DD" (Monday),
//      weekHistory: [ { weekStart, stats:{...}, fyccEarned, exerciseSessions } ],
//      pipeline: { cases: [ {id, client, caseName, fyc, stage, revisit,
//                             inforcedCounted, createdAt} ] },
//      pendingCarryover: [ quest objects not yet resolved into today ],
//      points: {
//        total: number,
//        streakDays: number,            // consecutive days the daily bar was met
//        multiplier: 1 | 1.5 | 2 | 2.5,
//        lastDayProcessed: "YYYY-MM-DD" // last date the daily outcome was settled
//      },
//      rewardItems: [ { id, name, cost, qty, maxQty, refreshRule, lastRefreshed } ],
//      touchpointChallenge: { count, target: 50, rewardLabel, startedAt },
//      ledger: handled as its own collection (see below), not embedded.
//    }
//
// /days/{YYYY-MM-DD}     one doc per day:
//    {
//      date, checklist: {id:bool,...}, quests: [3 quest objects],
//      energy: "low"|"okay"|"good",
//      timer: { status, remainingMs, startedAt },
//      touchpoint: { logged:bool, note },
//      exercise: { logged:bool, photoUrl, approved:"pending"|"approved"|"rejected" },
//      submittedForApproval: bool, submittedAt,
//      approval: { status:"pending"|"approved", approvedBy, approvedAt, note },
//      outcome: { met:bool, penaltyApplied:bool, streakSaved:bool } // filled once settled
//    }
//
// /pointsLedger/{autoId}  append-only, newest first via orderBy:
//    { ts: serverTimestamp(), type: "earn"|"penalty"|"redeem"|"streak_save",
//      amount, reason, date, pingSent:bool }
//
// Security: firestore.rules (sibling file) allows read/write only to the two
// signed-in accounts (txlserene@gmail.com, odinyeo5@gmail.com).
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Firebase bootstrap — call once per page.
// ----------------------------------------------------------------------------
let _app, _auth, _db, _storage;
export function initFirebase() {
  if (_app) return { app: _app, auth: _auth, db: _db, storage: _storage };
  _app = initializeApp(FIREBASE_CONFIG);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
  _storage = getStorage(_app);
  return { app: _app, auth: _auth, db: _db, storage: _storage };
}
export { signInWithEmailAndPassword, onAuthStateChanged, signOut };
export { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, query, orderBy, limit, serverTimestamp };
export { ref, uploadBytes, getDownloadURL };

// Uploads a proof photo to Storage under <folder>/<date>-<random>.<ext> and
// returns its public download URL. Call with the File from an <input
// type="file"> change event. folder is e.g. "exercise-proof" or
// "touchpoint-proof".
export async function uploadProofPhoto(storage, folder, dateStr, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${folder}/${dateStr}-${Date.now()}.${ext}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
