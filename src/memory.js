// memory.js — OFOQ Agent v5.0
// Firebase Admin Firestore — per-user data + schedules
// Schema documented in md/memory.md

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

function getDb() {
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore();
}

// ── Paths ─────────────────────────────────────────────────────────
const P = {
  config:  uid          => `users/${uid}/config/main`,
  conv:    (uid, cid)   => `users/${uid}/conversations/${cid}`,
  plan:    uid          => `users/${uid}/plan/current`,
  log:     uid          => `users/${uid}/log/entries`,
  sched:   (uid, sid)   => `users/${uid}/schedules/${sid}`,
  schedAll: uid         => `users/${uid}/schedules`,
};

// ================================================================
// DEFAULTS
// ================================================================
export const DEFAULT_CONFIG = {
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
    // github_dispatch_token: الـ PAT لاستدعاء GitHub Actions من الـ frontend
    github_dispatch_token: '',
  },
};

// ================================================================
// CONFIG
// ================================================================
export async function getConfig(uid) {
  const db  = getDb();
  const doc = await db.doc(P.config(uid)).get();
  if (!doc.exists) return structuredClone(DEFAULT_CONFIG);
  const s = doc.data();
  return {
    github:   { ...DEFAULT_CONFIG.github,   ...(s.github   || {}) },
    youtube:  { ...DEFAULT_CONFIG.youtube,  ...(s.youtube  || {}) },
    settings: { ...DEFAULT_CONFIG.settings, ...(s.settings || {}) },
  };
}

export async function patchConfig(uid, partial) {
  const db      = getDb();
  const updates = {};
  for (const [section, data] of Object.entries(partial)) {
    if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(data)) {
        updates[`${section}.${key}`] = val;
      }
    } else {
      updates[section] = data;
    }
  }
  await db.doc(P.config(uid)).set(updates, { merge: true });
}

// ================================================================
// CONVERSATION
// ================================================================
export async function createConversation(uid, convId, userMessage, history = []) {
  const db = getDb();
  await db.doc(P.conv(uid, convId)).set({
    status:          'pending',
    created_at:      Timestamp.now(),
    user_message:    userMessage,
    history,
    thinking_chunks: [],
    tool_updates:    [],
    final_response:  null,
    error:           null,
  });
}

export async function setConvStatus(uid, convId, status) {
  await getDb().doc(P.conv(uid, convId)).update({ status });
}

export async function appendThinking(uid, convId, chunk) {
  await getDb().doc(P.conv(uid, convId)).update({
    thinking_chunks: FieldValue.arrayUnion(chunk),
    status:          'thinking',
  });
}

export async function appendUpdate(uid, convId, text) {
  await getDb().doc(P.conv(uid, convId)).update({
    tool_updates: FieldValue.arrayUnion(text),
    status:       'running',
  });
}

export async function finishConversation(uid, convId, finalResponse, updatedHistory) {
  await getDb().doc(P.conv(uid, convId)).update({
    status:         'done',
    final_response: finalResponse,
    history:        updatedHistory,
    finished_at:    Timestamp.now(),
  });
}

export async function failConversation(uid, convId, errorMsg) {
  await getDb().doc(P.conv(uid, convId)).update({
    status:      'error',
    error:       errorMsg,
    finished_at: Timestamp.now(),
  });
}

export async function getConversation(uid, convId) {
  const doc = await getDb().doc(P.conv(uid, convId)).get();
  return doc.exists ? doc.data() : null;
}

// ================================================================
// PLAN
// ================================================================
export async function savePlan(uid, planData) {
  await getDb().doc(P.plan(uid)).set({ ...planData, updated_at: Timestamp.now() });
}

export async function getPlan(uid) {
  const doc = await getDb().doc(P.plan(uid)).get();
  return doc.exists ? doc.data() : null;
}

export async function updateSlotStatus(uid, slotIndex, status, url = null) {
  const doc = await getDb().doc(P.plan(uid)).get();
  if (!doc.exists) return;
  const slots = doc.data().slots || [];
  if (slotIndex < slots.length) {
    slots[slotIndex].status = status;
    if (url) slots[slotIndex].url = url;
  }
  const published = slots.filter(s => s.status === 'published').length;
  await getDb().doc(P.plan(uid)).update({ slots, published_count: published });
}

// ================================================================
// LOG
// ================================================================
export async function appendLog(uid, entry) {
  const db  = getDb();
  const ref = db.doc(P.log(uid));
  const doc = await ref.get();
  const row = { ts: new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }), ...entry };
  if (!doc.exists) {
    await ref.set({ items: [row] });
  } else {
    let items = [...(doc.data().items || []), row];
    if (items.length > 100) items = items.slice(-100);
    await ref.update({ items });
  }
}

export async function getLog(uid, limit = 15) {
  const doc = await getDb().doc(P.log(uid)).get();
  return doc.exists ? (doc.data().items || []).slice(-limit) : [];
}

// ================================================================
// SCHEDULES
// User-defined recurring tasks stored in Firestore.
// The scheduler.yml cron reads these and dispatches agent-chat events.
//
// Schedule document shape:
// {
//   id:          string   — unique ID
//   uid:         string   — Firebase UID
//   label:       string   — human-readable ("خطة يومية الساعة 12")
//   task:        string   — tool to call: "build_daily_plan" | "health_check" | "custom"
//   task_args:   object   — args to pass to the tool (if any)
//   user_prompt: string   — the prompt to send to the agent (used for "custom" tasks)
//   cron_hour:   number   — 0-23 Cairo time
//   cron_minute: number   — 0-59
//   days_left:   number   — remaining days (null = infinite)
//   active:      boolean
//   created_at:  timestamp
//   last_run:    string | null — ISO date of last run
//   next_run:    string        — ISO date YYYY-MM-DD
// }
// ================================================================
export async function createSchedule(uid, { label, task, task_args = {}, user_prompt = '', cron_hour, cron_minute, days = null }) {
  const db     = getDb();
  const sid    = `sched_${Date.now()}`;
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  // next_run = today if the time hasn't passed yet, else tomorrow
  const nowCairo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const slotMs   = cron_hour * 60 * 60 * 1000 + cron_minute * 60 * 1000;
  const nowMs    = nowCairo.getHours() * 60 * 60 * 1000 + nowCairo.getMinutes() * 60 * 1000;
  const nextDate = nowMs >= slotMs
    ? new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    : today;

  const doc = {
    id: sid, uid, label, task, task_args, user_prompt,
    cron_hour, cron_minute,
    days_left:  days,
    active:     true,
    created_at: Timestamp.now(),
    last_run:   null,
    next_run:   nextDate,
  };
  await db.doc(P.sched(uid, sid)).set(doc);
  return { sid, next_run: nextDate };
}

export async function listSchedules(uid) {
  const snap = await getDb().collection(P.schedAll(uid)).where('active', '==', true).get();
  return snap.docs.map(d => d.data());
}

export async function deleteSchedule(uid, sid) {
  await getDb().doc(P.sched(uid, sid)).update({ active: false });
}

export async function markScheduleRan(uid, sid) {
  const db  = getDb();
  const ref = db.doc(P.sched(uid, sid));
  const doc = await ref.get();
  if (!doc.exists) return;
  const s        = doc.data();
  const today    = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  let daysLeft = s.days_left;
  let active   = true;
  if (daysLeft !== null) {
    daysLeft = Math.max(0, daysLeft - 1);
    if (daysLeft === 0) active = false;
  }
  await ref.update({ last_run: today, next_run: tomorrow, days_left: daysLeft, active });
}

// Returns all schedules due for today (for all users — used by scheduler.yml)
export async function getDueSchedules() {
  const db    = getDb();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  // Query across all users — need collectionGroup index
  const snap  = await db.collectionGroup('schedules')
    .where('active',   '==',  true)
    .where('next_run', '<=', today)
    .get();
  return snap.docs.map(d => d.data());
}

// ================================================================
// CONTEXT BUILDER (for AI system prompt injection)
// ================================================================
export async function buildContextSummary(uid) {
  const [config, plan, recentLog, schedules] = await Promise.all([
    getConfig(uid),
    getPlan(uid),
    getLog(uid, 8),
    listSchedules(uid),
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
  if (schedules.length) {
    lines.push(`schedules: ${schedules.map(s => `"${s.label}" كل يوم الساعة ${pad(s.cron_hour)}:${pad(s.cron_minute)}`).join(' | ')}`);
  } else {
    lines.push('schedules: none');
  }
  if (recentLog.length) {
    lines.push(`last_log: ${recentLog.slice(-3).map(e => `${e.platform}|${e.status}`).join(', ')}`);
  }
  return lines.join('\n');
}

function pad(n) { return String(n).padStart(2, '0'); }

// ================================================================
// FILE UPLOADS
// المستخدم يرفع ملف → يُخزَّن في Firestore → Agent يقرأه
// /users/{uid}/files/{fileId}
// ================================================================
export async function saveUploadedFile(uid, { fileId, name, mimeType, size, textContent, encoding = 'utf8' }) {
  const db = getDb();
  await db.doc(`users/${uid}/files/${fileId}`).set({
    fileId, name, mimeType, size,
    textContent: textContent?.slice(0, 500_000) || null, // 500KB max
    encoding,
    uploaded_at: Timestamp.now(),
  });
}

export async function getUploadedFile(uid, fileId) {
  const db  = getDb();
  const doc = await db.doc(`users/${uid}/files/${fileId}`).get();
  return doc.exists ? doc.data() : null;
}

export async function listUploadedFiles(uid) {
  const db   = getDb();
  const snap = await db.collection(`users/${uid}/files`).orderBy('uploaded_at', 'desc').limit(20).get();
  return snap.docs.map(d => ({ fileId: d.id, name: d.data().name, mimeType: d.data().mimeType, size: d.data().size }));
}

export async function deleteUploadedFile(uid, fileId) {
  const db = getDb();
  await db.doc(`users/${uid}/files/${fileId}`).delete();
}
