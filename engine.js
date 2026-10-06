// ============================================================================
// Pure data/engine module — constants, points/streak math, reward/touchpoint
// logic. NO Firebase imports here on purpose, so this file can be unit-tested
// directly with plain Node (see test-engine.mjs) and is imported by both
// shared.js (browser) and any future test/ops script.
// ============================================================================

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCUH8mwTFhRbe9w4Ui2RLVs4SFK8zr7lcg",
  authDomain: "serene-s-tracker.firebaseapp.com",
  projectId: "serene-s-tracker",
  storageBucket: "serene-s-tracker.firebasestorage.app",
  messagingSenderId: "1089954434824",
  appId: "1:1089954434824:web:aa87de139fc1752cef66bd"
};

export const ALLOWED_USERS = {
  SERENE: "txlserene@gmail.com",
  ODIN: "odinyeo5@gmail.com"
};

// ----------------------------------------------------------------------------
// TELEGRAM — all three required ping scenarios go through this one function.
// Dedicated single-purpose bot; token exposed client-side is an accepted
// trade-off (worst case: someone sends fake messages into this one group
// topic — no real data exposure).
// ----------------------------------------------------------------------------
export const TELEGRAM = {
  BOT_TOKEN: "8687703271:AAHiCtdrCO4ZRRNXDbn3srz1lUZLj9hICfU",
  CHAT_ID: "-1002559501837",
  THREAD_ID: 13
};

export async function pingOdin(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM.CHAT_ID,
    message_thread_id: TELEGRAM.THREAD_ID,
    text,
    parse_mode: "HTML"
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (e) {
    console.warn("Telegram ping failed (non-fatal):", e);
    return false;
  }
}

// ----------------------------------------------------------------------------
// CONSTANTS carried over from the original LCP spec + merged requirements.
// ----------------------------------------------------------------------------
export const DAILY_TEMPLATE = [
  "Check urgent WhatsApp / Telegram / email",
  "Check outstanding documents",
  "Check underwriting / submissions",
  "Check pending client servicing",
  "Follow up clients / prospects",
  "Check today's appointments",
  "15-minute skill practice",
  "Choose today's 3 main quests"
];

export const STAT_DEFS = [
  { key: "appointments", label: "Appointments", isMoney: false, targetComputed: false },
  { key: "followups", label: "Follow-ups", isMoney: false, targetComputed: false },
  { key: "fycc", label: "FYCC Earned", isMoney: true, targetComputed: true },
  { key: "exercise", label: "Exercise Sessions", isMoney: false, targetComputed: false }
];

export const DEFAULT_WEEKLY_TARGETS = { appointments: 8, followups: 5, exercise: 4 };

export const PIPELINE_STAGES = [
  { key: "prospect", label: "Prospect", sub: "to meet" },
  { key: "open", label: "Open", sub: "to present" },
  { key: "proposed", label: "Proposed", sub: "presented" },
  { key: "closed", label: "Closed", sub: "FYC submitted" },
  { key: "inforced", label: "Inforced", sub: "FYC earned" }
];

export const GOAL_DEADLINE = new Date(2026, 11, 25); // 25 Dec 2026

export const QUEST_REASONS = [
  { key: "time", label: "Ran out of time" },
  { key: "energy", label: "Energy was too low" },
  { key: "blocked", label: "Blocked / waiting on someone" },
  { key: "priority", label: "Priority genuinely changed" },
  { key: "larger", label: "Task was larger than expected" },
  { key: "unnecessary", label: "No longer necessary" },
  { key: "other", label: "Other" }
];

export const TIMER_DURATION_MS = 30 * 60 * 1000;

// Default reward items — auto-refreshing "Streak Keeper" tokens from the
// original Google Sheet, plus the quantities/costs/refresh schedule given.
export const DEFAULT_REWARD_ITEMS = [
  {
    id: "streak-keeper-daily", name: "Daily Streak Keeper", cost: 35,
    qty: 1, maxQty: 1, refreshRule: "weekly-monday", lastRefreshed: null,
    description: "Saves your streak for one missed/incomplete day."
  },
  {
    id: "streak-keeper-weekly", name: "Weekly Streak Keeper", cost: 60,
    qty: 1, maxQty: 1, refreshRule: "monthly-1st", lastRefreshed: null,
    description: "Saves your streak across one incomplete week."
  },
  {
    id: "streak-keeper-monthly", name: "Monthly Streak Keeper", cost: 150,
    qty: 1, maxQty: 1, refreshRule: "yearly-jan1", lastRefreshed: null,
    description: "Saves your streak across one incomplete month."
  },
  {
    id: "snack-drink", name: "Chosen snack/drink", cost: 20,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: "Capped at $10."
  },
  {
    id: "hair-wash", name: "Hair wash", cost: 30,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: ""
  },
  {
    id: "manicure", name: "Manicure", cost: 130,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: ""
  },
  {
    id: "makan-20", name: "Makan at place of choice ($20 budget)", cost: 50,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: "Budget per pax $20."
  },
  {
    id: "makan-50", name: "Makan at place of choice ($50 budget)", cost: 100,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: "Budget per pax $50."
  },
  {
    id: "makan-100", name: "Makan at place of choice ($100 budget)", cost: 185,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: "Budget per pax $100."
  },
  {
    id: "gift-20", name: "Chosen gift/item ($20)", cost: 50,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: ""
  },
  {
    id: "gift-50", name: "Chosen gift/item ($50)", cost: 100,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: ""
  },
  {
    id: "gift-100", name: "Chosen gift/item ($100)", cost: 185,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: ""
  },
  {
    id: "gift-beyond", name: "Chosen gift/item (beyond $100)", cost: null,
    qty: 9999, maxQty: 9999, refreshRule: null, lastRefreshed: null,
    description: "Cost to be negotiated with Odin — not an instant redeem."
  },
  {
    id: "hair-treatment", name: "Hair treatment", cost: 10,
    qty: 0, maxQty: 1, refreshRule: "every-6-months", lastRefreshed: "2025-09-25",
    description: "Capped at $300. Once per 6 months (last redeemed 25 Sep 2025) — confirm the 10pt cost with Odin, the original sheet had it under a non-standard label."
  }
];

export const DEFAULT_TOUCHPOINT_CHALLENGE = {
  count: 0, target: 50,
  rewardLabel: "Reward TBD with Odin",
  startedAt: null
};

// ----------------------------------------------------------------------------
// POINTS / STREAK ENGINE — pure functions, no Firestore/DOM, so they can be
// unit-tested directly in Node (see shared.engine.test.js).
// ----------------------------------------------------------------------------

export const POINT_VALUES = {
  QUEST_SIDE: 10,
  QUEST_MAIN: 15,
  EXERCISE_APPROVED: 20,
  TOUCHPOINT: 10,
  FULL_DAY_BONUS: 15,
  MISSED_DAY_PENALTY: -20,   // no update posted at all
  INCOMPLETE_DAY_PENALTY: -10 // posted, but didn't clear all 3 quests
};

// Streak multiplier tiers. currentStreakDays counts consecutive days the
// daily bar ("all 3 quests cleared") was met, unmultiplied.
export function computeMultiplier(streakDays) {
  const fullWeeks = Math.floor(streakDays / 7);
  if (streakDays <= 0) return 1;
  if (fullWeeks >= 20) return 2.5;
  if (fullWeeks >= 5) return 2;
  if (fullWeeks >= 1) return 1.5;
  return 1;
}

/**
 * Settle one day's outcome against the points/streak state.
 * @param {object} points - { total, streakDays, multiplier, lastDayProcessed }
 * @param {object} dayFacts - { date, questsCompleted, totalQuests, touchpointLogged, exerciseApproved, anyUpdatePosted, streakKeeperSpent }
 * @returns {{ points: object, events: Array<{type, amount, reason, ping}> }}
 */
export function settleDay(points, dayFacts) {
  const p = { ...points };
  const events = [];
  const allQuestsCleared = dayFacts.questsCompleted >= dayFacts.totalQuests && dayFacts.totalQuests > 0;
  const mult = computeMultiplier(p.streakDays);

  let earned = 0;
  if (dayFacts.questsCompleted > 0) {
    // crude split: assume 1 main + rest side, capped at totalQuests
    const sideCount = Math.max(0, dayFacts.questsCompleted - 1);
    const mainCount = dayFacts.questsCompleted > 0 ? 1 : 0;
    earned += mainCount * POINT_VALUES.QUEST_MAIN + sideCount * POINT_VALUES.QUEST_SIDE;
  }
  if (dayFacts.touchpointLogged) earned += POINT_VALUES.TOUCHPOINT;
  if (dayFacts.exerciseApproved) earned += POINT_VALUES.EXERCISE_APPROVED;
  if (allQuestsCleared) earned += POINT_VALUES.FULL_DAY_BONUS;
  earned = Math.round(earned * mult);
  if (earned > 0) {
    p.total += earned;
    events.push({ type: "earn", amount: earned, reason: "Daily activity", ping: false });
  }

  if (!dayFacts.anyUpdatePosted) {
    // Scenario (a) — never posted anything at all.
    p.total += POINT_VALUES.MISSED_DAY_PENALTY;
    events.push({
      type: "penalty", amount: POINT_VALUES.MISSED_DAY_PENALTY,
      reason: "No daily update posted", ping: true
    });
    if (dayFacts.streakKeeperSpent) {
      events.push({ type: "streak_save", amount: 0, reason: "Streak Keeper used to save streak", ping: true });
      // streak preserved, don't reset
    } else {
      if (p.streakDays > 0) {
        events.push({ type: "streak_break", amount: 0, reason: "Streak broken (no update posted)", ping: true });
      }
      p.streakDays = 0;
      p.multiplier = 1;
    }
  } else if (!allQuestsCleared) {
    // Scenario (a) — posted, but didn't clear all 3 agenda items.
    p.total += POINT_VALUES.INCOMPLETE_DAY_PENALTY;
    events.push({
      type: "penalty", amount: POINT_VALUES.INCOMPLETE_DAY_PENALTY,
      reason: "Daily agenda not fully cleared", ping: true
    });
    if (dayFacts.streakKeeperSpent) {
      events.push({ type: "streak_save", amount: 0, reason: "Streak Keeper used to save streak", ping: true });
    } else {
      if (p.streakDays > 0) {
        events.push({ type: "streak_break", amount: 0, reason: "Streak broken (agenda incomplete)", ping: true });
      }
      p.streakDays = 0;
      p.multiplier = 1;
    }
  } else {
    // Fully cleared day — streak continues/grows.
    p.streakDays += 1;
    p.multiplier = computeMultiplier(p.streakDays);
  }

  p.lastDayProcessed = dayFacts.date;
  return { points: p, events };
}

/**
 * Redeem a reward item: scenario (c), always pings Odin.
 */
export function redeemReward(points, rewardItems, rewardId, now = new Date()) {
  const item = rewardItems.find(r => r.id === rewardId);
  if (!item) return { ok: false, error: "Unknown reward item" };
  if (item.cost == null) return { ok: false, error: "Cost TBD — discuss with Odin before redeeming" };
  if (item.qty <= 0) return { ok: false, error: "Out of stock — refreshes on its schedule" };
  if (points.total < item.cost) return { ok: false, error: "Not enough points" };
  const newPoints = { ...points, total: points.total - item.cost };
  const newItems = rewardItems.map(r => {
    if (r.id !== rewardId) return r;
    const newQty = r.qty - 1;
    // Cooldown-style rewards (e.g. "once per 6 months") count down from the
    // date they're actually used, not a fixed calendar tick, so stamp
    // lastRefreshed here the moment stock hits zero.
    const stampCooldown = r.refreshRule === "every-6-months" && newQty <= 0;
    return stampCooldown ? { ...r, qty: newQty, lastRefreshed: fmtDate(now) } : { ...r, qty: newQty };
  });
  const event = { type: "redeem", amount: -item.cost, reason: `Redeemed: ${item.name}`, ping: true };
  return { ok: true, points: newPoints, rewardItems: newItems, event };
}

/**
 * Auto-refresh reward item quantities on their schedule. Call on every load
 * with "now" — idempotent, only refreshes once per period.
 */
export function refreshRewardItems(rewardItems, now = new Date()) {
  return rewardItems.map(item => {
    const last = item.lastRefreshed ? new Date(item.lastRefreshed) : null;
    let due = false;
    if (item.refreshRule === "weekly-monday") {
      due = !last || weeksBetweenMondays(last, now) >= 1;
    } else if (item.refreshRule === "monthly-1st") {
      due = !last || (now.getFullYear() * 12 + now.getMonth()) > (last.getFullYear() * 12 + last.getMonth());
    } else if (item.refreshRule === "yearly-jan1") {
      due = !last || now.getFullYear() > last.getFullYear();
    } else if (item.refreshRule === "every-6-months") {
      due = !last || monthsBetween(last, now) >= 6;
    }
    if (due && item.qty < item.maxQty) {
      return { ...item, qty: item.maxQty, lastRefreshed: now.toISOString().slice(0, 10) };
    }
    if (due) {
      return { ...item, lastRefreshed: now.toISOString().slice(0, 10) };
    }
    return item;
  });
}

function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function weeksBetweenMondays(a, b) {
  const ma = mondayOf(a), mb = mondayOf(b);
  return Math.round((mb - ma) / (7 * 24 * 60 * 60 * 1000));
}
function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * Touchpoint challenge: 50-day cumulative counter, +1 per logged day.
 */
export function logTouchpoint(challenge) {
  const c = { ...challenge };
  if (!c.startedAt) c.startedAt = new Date().toISOString().slice(0, 10);
  c.count = Math.min(c.target, c.count + 1);
  return c;
}

export function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
