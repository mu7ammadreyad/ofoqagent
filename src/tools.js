// tools.js — OFOQ Agent v6.1
// Code Execution Sandbox + Memory + Conversations + Scheduled Tasks

import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { execSync }           from 'child_process';
import { tmpdir }             from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath }      from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR  = resolve(__dirname, '..');
const SKILLS_DIR   = join(PROJECT_DIR, 'skills');

// ================================================================
// LOGGING
// ================================================================
export function log(level, section, msg, data = null) {
  const ts   = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  const icon = { info:'ℹ️', ok:'✅', warn:'⚠️', error:'❌' }[level] || '•';
  console.log(`${icon} [${ts}] [${section}] ${msg}`);
  if (data) console.log(JSON.stringify(sanitize(data), null, 2));
}

export function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const HIDE = ['token','secret','refresh_token','access_token','password','api_key','apikey'];
  const out  = {};
  for (const [k,v] of Object.entries(obj)) {
    if (HIDE.some(h => k.toLowerCase().includes(h))) out[k] = '[REDACTED]';
    else if (typeof v === 'object' && v)             out[k] = sanitize(v);
    else                                             out[k] = v;
  }
  return out;
}

// ================================================================
// FILE HELPERS
// ================================================================
export function readSkill(filename) {
  try { return readFileSync(join(SKILLS_DIR, filename), 'utf8'); }
  catch { log('error', 'tools', `Could not read skills/${filename}`); return ''; }
}
export const readMd = readSkill;
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// FIREBASE
// ================================================================
const FIREBASE_SA_HARDCODED = process.env.FIREBASE_SERVICE_ACCOUNT || JSON.stringify({ _placeholder: true });

let _db = null;
export async function getDb() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let sa;
    try   { sa = JSON.parse(FIREBASE_SA_HARDCODED); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT JSON غير صالح'); }
    if (sa._placeholder) throw new Error('ضع Firebase Service Account في GitHub Secret');
    initializeApp({ credential: cert(sa) });
  }
  _db = getFirestore();
  return _db;
}

// ================================================================
// MEMORY
// ================================================================
export async function loadMemory(uid) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/config/memory`).get();
    if (doc.exists && doc.data()?.content) return doc.data().content;
    const template = readSkill('memory.md');
    if (template) await saveMemory(uid, template);
    return template || '';
  } catch (e) {
    log('error', 'memory', 'loadMemory failed', { error: e.message });
    return readSkill('memory.md');
  }
}

export async function saveMemory(uid, fullContent) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/config/memory`).set({
      content: fullContent, updated_at: new Date().toISOString(),
    });
    log('ok', 'memory', `saved (${fullContent.length}ch)`);
  } catch (e) { log('error', 'memory', 'saveMemory failed', { error: e.message }); throw e; }
}

export function getMemVal(mem, key) {
  const line = mem.split('\n').find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return (val === 'null' || val === '') ? null : val;
}

// ================================================================
// CONVERSATIONS
// ================================================================
export async function createConv(uid, convId, userMessage, history = [], extra = {}) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set({
      status: 'pending', created_at: new Date().toISOString(),
      user_message: userMessage, history,
      thinking_chunks: [], tool_updates: [],
      final_response: null, error: null,
      title: userMessage.slice(0, 60),
      ...extra,
    });
  } catch (e) { log('error', 'conv', 'createConv failed', { error: e.message }); }
}

export async function getConv(uid, convId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/conversations/${convId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) { log('error', 'conv', 'getConv failed', { error: e.message }); return null; }
}

export async function updateConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).update(data);
  } catch (e) { log('error', 'conv', 'updateConv failed', { error: e.message }); }
}

export async function saveConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set(data, { merge: true });
  } catch (e) { log('error', 'conv', 'saveConv failed', { error: e.message }); }
}

export async function appendToConv(uid, convId, field, value) {
  try {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      [field]: FieldValue.arrayUnion(value),
    });
  } catch (e) { log('warn', 'conv', `append ${field} failed`, { error: e.message }); }
}

// ================================================================
// SCHEDULED TASKS
// ================================================================
// الهيكل في Firestore: users/{uid}/scheduled_tasks/{taskId}
// الـ scheduler.js يقرأ بـ collectionGroup('scheduled_tasks')

/**
 * حساب next_run القادمة
 * @param {object} config - { schedule_type, hour, minute, timezone, days }
 * @returns {string} ISO timestamp UTC
 */
export function calcNextRun(config) {
  const { schedule_type = 'daily', hour = 9, minute = 0,
          days = ['sat','sun','mon','tue','wed','thu','fri'] } = config;

  // الوقت الحالي بتوقيت القاهرة (UTC+2 — تقريب ثابت)
  const CAIRO_OFFSET_MS = 2 * 3600 * 1000;
  const nowUtc   = Date.now();
  const nowCairo = new Date(nowUtc + CAIRO_OFFSET_MS);

  if (schedule_type === 'daily' || schedule_type === 'weekly') {
    // ابحث عن أقرب يوم تنطبق عليه الشروط
    const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];
    let candidate = new Date(nowCairo);
    candidate.setHours(hour, minute, 0, 0);

    for (let i = 0; i < 8; i++) {
      const dayName = DAY_NAMES[candidate.getDay()];
      const inFuture = candidate.getTime() > nowCairo.getTime();
      if (inFuture && days.includes(dayName)) {
        // تحويل لـ UTC
        const utcMs = candidate.getTime() - CAIRO_OFFSET_MS;
        return new Date(utcMs).toISOString();
      }
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(hour, minute, 0, 0);
    }
  }

  if (schedule_type === 'hourly') {
    const next = new Date(nowUtc + 3600 * 1000);
    next.setMinutes(minute, 0, 0);
    return next.toISOString();
  }

  // default: بكرة نفس الوقت
  const next = new Date(nowCairo);
  next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return new Date(next.getTime() - CAIRO_OFFSET_MS).toISOString();
}

/**
 * إنشاء مهمة مجدولة جديدة
 */
export async function createScheduledTask(uid, config) {
  const db     = await getDb();
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const nextRun = calcNextRun(config);

  const task = {
    taskId,
    uid,
    title:         config.title         || 'مهمة مجدولة',
    message:       config.message       || '',
    schedule_type: config.schedule_type || 'daily',
    hour:          config.hour          ?? 9,
    minute:        config.minute        ?? 0,
    timezone:      config.timezone      || 'Africa/Cairo',
    days:          config.days          || ['sat','sun','mon','tue','wed','thu','fri'],
    active:        true,
    created_at:    new Date().toISOString(),
    last_run:      null,
    next_run:      nextRun,
    run_count:     0,
  };

  await db.doc(`users/${uid}/scheduled_tasks/${taskId}`).set(task);
  log('ok', 'scheduler', `Task created: ${taskId} — next: ${nextRun}`);
  return { taskId, nextRun };
}

/**
 * تحديث مهمة (مثلاً بعد التنفيذ)
 */
export async function updateScheduledTask(uid, taskId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/scheduled_tasks/${taskId}`).update(data);
  } catch (e) { log('error', 'scheduler', 'updateTask failed', { error: e.message }); }
}

/**
 * إيقاف أو تفعيل مهمة
 */
export async function toggleScheduledTask(uid, taskId, active) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/scheduled_tasks/${taskId}`).update({ active });
    log('ok', 'scheduler', `Task ${taskId} → active=${active}`);
  } catch (e) { log('error', 'scheduler', 'toggleTask failed', { error: e.message }); }
}

/**
 * جلب كل المهام المجدولة النشطة (لكل المستخدمين)
 * يُستخدم من scheduler.js
 */
export async function getAllDueTasks() {
  try {
    const db  = await getDb();
    const now = new Date().toISOString();
    const snap = await db.collectionGroup('scheduled_tasks')
      .where('active', '==', true)
      .where('next_run', '<=', now)
      .get();
    return snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  } catch (e) {
    log('error', 'scheduler', 'getAllDueTasks failed', { error: e.message });
    return [];
  }
}

// ================================================================
// SHELL EXECUTION
// بدون timeout — المهمة تكتمل مهما طالت
// ================================================================
export async function executeShell(script) {
  const id      = `ofoq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const tmpFile = join(tmpdir(), `${id}.sh`);

  writeFileSync(tmpFile, `#!/bin/bash\nset -eo pipefail\n\n${script}\n`, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`bash "${tmpFile}"`, {
      timeout:   0,                    // لا timeout — المهمة تكتمل مهما طالت
      maxBuffer: 10 * 1024 * 1024,    // 10MB
      encoding:  'utf8',
      cwd:       PROJECT_DIR,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    stderr = (e.stderr || '') + (e.stdout || '') + (e.message || '');
    if (e.stdout) stdout = e.stdout;
    return {
      success:   false,
      exit_code: e.status || 1,
      stdout:    stdout.slice(0, 4000),
      stderr:    stderr.slice(0, 1500),
      error:     stderr.split('\n').filter(Boolean).slice(-3).join(' | '),
    };
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  return { success: true, exit_code: 0, stdout: stdout.slice(0, 4000), stderr: '' };
}
