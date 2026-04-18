// memory.js — OFOQ Agent v5.0
// Firebase Admin Firestore — per-user data management
// See md/memory.md for full schema documentation

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// ── Initialize Firebase Admin (once) ─────────────────────────────
function getDb() {
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore();
}

// ── Paths ─────────────────────────────────────────────────────────
const configPath  = uid => `users/${uid}/config/main`;
const convPath    = (uid, cid) => `users/${uid}/conversations/${cid}`;
const planPath    = uid => `users/${uid}/plan/current`;
const logPath     = uid => `users/${uid}/log/entries`;

// ================================================================
// DEFAULT STATE
// ================================================================
const DEFAULT_CONFIG = {
  github: {
    token: '', repo_owner: '', repo_name: '',
    status: 'not_configured', last_verified: null,
  },
  youtube: {
    client_id: '', client_secret: '', refresh_token: '',
    access_token: '', status: 'not_configured', last_verified: null,
  },
  settings: {
    location_lat: '30.0444', location_lng: '31.2357',
    fajr_offset_minutes: '30', posts_per_day: '4',
  },
};

// ================================================================
// CONFIG OPERATIONS
// ================================================================

export async function getConfig(uid) {
  const db  = getDb();
  const doc = await db.doc(configPath(uid)).get();
  if (!doc.exists) return structuredClone(DEFAULT_CONFIG);
  const stored = doc.data();
  // Deep merge with defaults so new fields don't break old users
  return {
    github:   { ...DEFAULT_CONFIG.github,   ...(stored.github   || {}) },
    youtube:  { ...DEFAULT_CONFIG.youtube,  ...(stored.youtube  || {}) },
    settings: { ...DEFAULT_CONFIG.settings, ...(stored.settings || {}) },
  };
}

export async function patchConfig(uid, partial) {
  const db = getDb();
  // Build dot-notation updates for nested merge without overwriting siblings
  const updates = {};
  for (const [section, data] of Object.entries(partial)) {
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data)) {
        updates[`${section}.${key}`] = value;
      }
    } else {
      updates[section] = data;
    }
  }
  await db.doc(configPath(uid)).set(updates, { merge: true });
}

// ================================================================
// CONVERSATION OPERATIONS
// ================================================================

export async function createConversation(uid, convId, userMessage, history = []) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).set({
    status:          'pending',
    created_at:      Timestamp.now(),
    user_message:    userMessage,
    history:         history,
    thinking_chunks: [],
    tool_updates:    [],
    final_response:  null,
    error:           null,
  });
}

export async function setConvStatus(uid, convId, status) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).update({ status });
}

export async function appendThinking(uid, convId, chunk) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).update({
    thinking_chunks: FieldValue.arrayUnion(chunk),
    status:          'thinking',
  });
}

export async function appendUpdate(uid, convId, text) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).update({
    tool_updates: FieldValue.arrayUnion(text),
    status:       'running',
  });
}

export async function finishConversation(uid, convId, finalResponse, updatedHistory) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).update({
    status:         'done',
    final_response: finalResponse,
    history:        updatedHistory,
    finished_at:    Timestamp.now(),
  });
}

export async function failConversation(uid, convId, errorMsg) {
  const db = getDb();
  await db.doc(convPath(uid, convId)).update({
    status: 'error',
    error:  errorMsg,
    finished_at: Timestamp.now(),
  });
}

export async function getConversation(uid, convId) {
  const db  = getDb();
  const doc = await db.doc(convPath(uid, convId)).get();
  return doc.exists ? doc.data() : null;
}

// ================================================================
// PLAN OPERATIONS
// ================================================================

export async function savePlan(uid, planData) {
  const db = getDb();
  await db.doc(planPath(uid)).set({
    ...planData,
    updated_at: Timestamp.now(),
  });
}

export async function getPlan(uid) {
  const db  = getDb();
  const doc = await db.doc(planPath(uid)).get();
  return doc.exists ? doc.data() : null;
}

export async function updateSlotStatus(uid, slotIndex, status, url = null) {
  const db  = getDb();
  const doc = await db.doc(planPath(uid)).get();
  if (!doc.exists) return;
  const slots = doc.data().slots || [];
  if (slotIndex >= slots.length) return;
  slots[slotIndex].status = status;
  if (url) slots[slotIndex].url = url;
  const published = slots.filter(s => s.status === 'published').length;
  await db.doc(planPath(uid)).update({ slots, published_count: published });
}

// ================================================================
// LOG OPERATIONS
// ================================================================

export async function appendLog(uid, entry) {
  const db  = getDb();
  const ref = db.doc(logPath(uid));
  const doc = await ref.get();

  const newEntry = {
    ts:       new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
    ...entry,
  };

  if (!doc.exists) {
    await ref.set({ items: [newEntry] });
  } else {
    let items = doc.data().items || [];
    items.push(newEntry);
    // Keep last 100 entries
    if (items.length > 100) items = items.slice(-100);
    await ref.update({ items });
  }
}

export async function getLog(uid, limit = 20) {
  const db  = getDb();
  const doc = await db.doc(logPath(uid)).get();
  if (!doc.exists) return [];
  const items = doc.data().items || [];
  return items.slice(-limit);
}

// ================================================================
// CONTEXT BUILDER
// ドキュメント用 — builds AI context from user data
// ================================================================
export async function buildContextSummary(uid) {
  const [config, plan, recentLog] = await Promise.all([
    getConfig(uid),
    getPlan(uid),
    getLog(uid, 10),
  ]);

  const lines = [
    `github: ${config.github.status} | owner=${config.github.repo_owner||'?'} repo=${config.github.repo_name||'?'}`,
    `youtube: ${config.youtube.status}`,
    `settings: lat=${config.settings.location_lat} posts=${config.settings.posts_per_day}/day offset=${config.settings.fajr_offset_minutes}min`,
  ];

  if (plan) {
    lines.push(`plan: ${plan.status} | date=${plan.date} | published=${plan.published_count||0}/${plan.slots?.length||0}`);
  } else {
    lines.push('plan: none');
  }

  if (recentLog.length) {
    const last = recentLog.slice(-3).map(e => `${e.ts}|${e.platform}|${e.video}|${e.status}`).join(', ');
    lines.push(`recent_log: ${last}`);
  }

  return lines.join('\n');
}
