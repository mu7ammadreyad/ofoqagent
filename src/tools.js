// tools.js — OFOQ Agent v6.0
// Code Execution Sandbox + Memory Helpers + Logging
// helpers.js مدمج هنا

import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { execSync }           from 'child_process';
import { tmpdir }             from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath }      from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR  = resolve(__dirname, '..');         // project root
const SKILLS_DIR   = join(PROJECT_DIR, 'skills');      // soul.md, tools.md, memory.md

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
// قراءة ملف من skills/ (soul.md, tools.md, memory.md)
export function readSkill(filename) {
  try {
    return readFileSync(join(SKILLS_DIR, filename), 'utf8');
  } catch {
    log('error', 'tools', `Could not read skills/${filename}`);
    return '';
  }
}

// backward-compat alias
export const readMd = readSkill;

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// FIREBASE
// ================================================================

// ← ضع Firebase Service Account هنا مؤقتاً (انقله لـ GitHub Secret لاحقاً)
const FIREBASE_SA_HARDCODED = process.env.FIREBASE_SERVICE_ACCOUNT || JSON.stringify({
  _placeholder: true,
  // مثال: "type":"service_account","project_id":"...","private_key":"...","client_email":"..."
});

let _db = null;

async function getDb() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let sa;
    try   { sa = JSON.parse(FIREBASE_SA_HARDCODED); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT JSON غير صالح'); }
    if (sa._placeholder) throw new Error('ضع Firebase Service Account في FIREBASE_SA_HARDCODED أو GitHub Secret');
    initializeApp({ credential: cert(sa) });
  }
  _db = getFirestore();
  return _db;
}

// ── Memory (memory.md كاملاً في Firestore) ────────────────────────
// يُحمَّل مع كل رسالة بغض النظر عن الـ conversation
// يُحفَظ كنص كامل — لا sections، لا partial update

export async function loadMemory(uid) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/config/memory`).get();
    if (doc.exists && doc.data()?.content) return doc.data().content;
    // مستخدم جديد → template من skills/memory.md
    const template = readSkill('memory.md');
    if (template) await saveMemory(uid, template); // init في Firestore
    return template || '';
  } catch (e) {
    log('error', 'memory', 'loadMemory failed', { error: e.message });
    return readSkill('memory.md'); // fallback محلي
  }
}

// حفظ memory.md كاملاً — AI يكتب الملف بالكامل دايماً
export async function saveMemory(uid, fullContent) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/config/memory`).set({
      content:    fullContent,
      updated_at: new Date().toISOString(),
    });
    log('ok', 'memory', `memory saved — uid=${uid.slice(0,8)} (${fullContent.length}ch)`);
  } catch (e) {
    log('error', 'memory', 'saveMemory failed', { error: e.message });
    throw e;
  }
}

// قراءة قيمة محددة من نص memory.md
export function getMemVal(mem, key) {
  const line = mem.split('\n').find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return (val === 'null' || val === '') ? null : val;
}

// ── Conversations ─────────────────────────────────────────────────
// كل محادثة = document في users/{uid}/conversations/{convId}
// يحتوي على history كامل + thinking + tool_updates + final_response

export async function createConv(uid, convId, userMessage, history = []) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set({
      status:          'pending',
      created_at:      new Date().toISOString(),
      user_message:    userMessage,
      history,                    // كل الـ history السابق
      thinking_chunks: [],
      tool_updates:    [],
      final_response:  null,
      error:           null,
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

// قراءة ملف مرفوع من Firestore
export async function readUploadedFile(uid, fileId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/files/${fileId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) { log('error','memory','readFile',{error:e.message}); return null; }
}

// ================================================================
// SHELL EXECUTION
// ────────────────────────────────────────────────────────────────
// GitHub Actions = Ubuntu VM كامل
// AI يكتب bash script → يشتغل مباشرة مع كامل صلاحيات الـ runner
// curl / wget / git / npm / python3 / apt-get / أي أمر Ubuntu
// ================================================================
export async function executeShell(script) {
  const id      = `ofoq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const tmpFile = join(tmpdir(), `${id}.sh`);

  // كتابة الـ script مع set -e (يوقف عند أي خطأ)
  writeFileSync(tmpFile, `#!/bin/bash\nset -eo pipefail\n\n${script}\n`, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`bash "${tmpFile}"`, {
      maxBuffer: 10 * 1024 * 1024,  // 10MB output
      encoding:  'utf8',
      cwd:       PROJECT_DIR,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (e) {
    // execSync throws on non-zero exit
    stderr = (e.stderr || '') + (e.stdout || '') + (e.message || '');
    if (e.stdout) stdout = e.stdout;
    return {
      success:   false,
      exit_code: e.status || 1,
      stdout:    stdout.slice(0, 3000),
      stderr:    stderr.slice(0, 1000),
      error:     stderr.split('\n').filter(Boolean).slice(-3).join(' | '),
    };
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  return {
    success:   true,
    exit_code: 0,
    stdout:    stdout.slice(0, 3000),
    stderr:    '',
  };
}

// ================================================================
// SCHEDULING SYSTEM
// ────────────────────────────────────────────────────────────────
// كل جدول = doc في `schedules/{schedId}` (global للـ scheduler)
//         + doc في `users/{uid}/schedules/{schedId}` (للـ frontend)
//         + conv في `users/{uid}/conversations/conv_sched_xxx`
// ================================================================

/**
 * parseCronNext — يحسب موعد التشغيل القادم لـ cron expression
 * يدعم: * / , - وأرقام ثابتة
 * الحقول: minute hour day-of-month month day-of-week
 */
export function parseCronNext(cronExpr, afterDate = new Date(), timezone = 'Africa/Cairo') {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron غير صالح: "${cronExpr}" — يجب أن يكون 5 حقول`);
  const [minP, hrP, domP, monP, dowP] = parts;

  const matches = (part, val, min = 0, max = 59) => {
    if (part === '*') return true;
    for (const seg of part.split(',')) {
      if (seg.includes('/')) {
        const [range, step] = seg.split('/');
        const s = parseInt(step);
        const [lo, hi] = range === '*' ? [min, max] : range.split('-').map(Number);
        for (let v = lo; v <= hi; v += s) if (v === val) return true;
      } else if (seg.includes('-')) {
        const [a, b] = seg.split('-').map(Number);
        if (val >= a && val <= b) return true;
      } else {
        if (parseInt(seg) === val) return true;
      }
    }
    return false;
  };

  // ابدأ من الدقيقة التالية
  const d = new Date(afterDate.getTime() + 60_000);
  d.setSeconds(0, 0);

  for (let i = 0; i < 527_040; i++) { // max ~366 days
    // تحويل للتوقيت المحلي
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t) => parseInt(parts.find(p => p.type === t)?.value ?? '0');
    const [mn, hr, dom, mon, dow] = [
      get('minute'), get('hour'), get('day'), get('month'),
      new Date(d.toLocaleString('en-US', { timeZone: timezone })).getDay(),
    ];
    if (
      matches(minP, mn, 0, 59) &&
      matches(hrP,  hr, 0, 23) &&
      matches(domP, dom, 1, 31) &&
      matches(monP, mon, 1, 12) &&
      matches(dowP, dow, 0, 6)
    ) return new Date(d);

    d.setTime(d.getTime() + 60_000);
  }
  return null;
}

/**
 * createSchedule — ينشئ جدول في Firestore + محادثة مخصصة له
 */
export async function createSchedule(uid, { name, description = '', cron, taskPrompt, timezone = 'Africa/Cairo' }) {
  const db      = await getDb();
  const schedId = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const convId  = `conv_sched_${schedId}`;

  let nextRun = null;
  try {
    nextRun = parseCronNext(cron, new Date(), timezone);
  } catch (e) {
    throw new Error(`cron غير صالح: ${e.message}`);
  }

  const now      = new Date().toISOString();
  const schedDoc = {
    id:          schedId,
    uid,
    name,
    description,
    task_prompt: taskPrompt,
    cron,
    timezone,
    status:      'active',
    created_at:  now,
    last_run_at: null,
    next_run_at: nextRun?.toISOString() ?? null,
    conv_id:     convId,
    run_count:   0,
  };

  // Global — للـ scheduler
  await db.doc(`schedules/${schedId}`).set(schedDoc);
  // Per-user — للـ frontend
  await db.doc(`users/${uid}/schedules/${schedId}`).set(schedDoc);
  // المحادثة المخصصة
  await db.doc(`users/${uid}/conversations/${convId}`).set({
    type:          'scheduled',
    schedule_id:   schedId,
    schedule_name: name,
    schedule_cron: cron,
    schedule_desc: description,
    created_at:    now,
    messages:      [],
    last_updated:  now,
    status:        'active',
  });

  log('ok', 'schedule', `Created ${schedId} — next: ${schedDoc.next_run_at}`);
  return { schedId, convId, nextRun: schedDoc.next_run_at };
}

/**
 * getSchedules — يجلب كل الجداول النشطة للمستخدم
 */
export async function getSchedules(uid) {
  try {
    const db   = await getDb();
    const snap = await db.collection(`users/${uid}/schedules`)
      .where('status', '==', 'active').get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    log('error', 'schedule', 'getSchedules failed', { error: e.message });
    return [];
  }
}

/**
 * getDueSchedules — يجلب الجداول التي حان وقت تشغيلها (للـ scheduler)
 */
export async function getDueSchedules() {
  try {
    const db  = await getDb();
    const now = new Date().toISOString();
    const snap = await db.collection('schedules')
      .where('status', '==', 'active')
      .where('next_run_at', '<=', now)
      .get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    log('error', 'schedule', 'getDueSchedules failed', { error: e.message });
    return [];
  }
}

/**
 * markScheduleRan — يحدّث الجدول بعد التشغيل ويحسب الموعد القادم
 */
export async function markScheduleRan(schedId, uid, cron, timezone = 'Africa/Cairo') {
  try {
    const db      = await getDb();
    const now     = new Date();
    const nextRun = parseCronNext(cron, now, timezone);
    // جلب run_count الحالي
    const doc      = await db.doc(`schedules/${schedId}`).get();
    const runCount = (doc.data()?.run_count ?? 0) + 1;
    const upd = {
      last_run_at: now.toISOString(),
      next_run_at: nextRun?.toISOString() ?? null,
      run_count:   runCount,
    };
    await db.doc(`schedules/${schedId}`).update(upd);
    await db.doc(`users/${uid}/schedules/${schedId}`).update(upd);
    log('ok', 'schedule', `Marked ran — schedId=${schedId} runCount=${runCount} next=${upd.next_run_at}`);
    return runCount;
  } catch (e) {
    log('error', 'schedule', 'markScheduleRan failed', { error: e.message });
    return 0;
  }
}

/**
 * appendScheduleMessage — يضيف رسالة لمحادثة الجدول (كل تشغيل رسالة)
 */
export async function appendScheduleMessage(uid, convId, schedId, content, runNumber) {
  try {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      messages:     FieldValue.arrayUnion({
        timestamp:  new Date().toISOString(),
        run_number: runNumber,
        content,
        status:     'done',
      }),
      last_updated: new Date().toISOString(),
    });
    log('ok', 'schedule', `Appended message #${runNumber} to ${convId}`);
  } catch (e) {
    log('error', 'schedule', 'appendScheduleMessage failed', { error: e.message });
  }
}

/**
 * getScheduleById — يجلب بيانات جدول معين
 */
export async function getScheduleById(schedId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`schedules/${schedId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    log('error', 'schedule', 'getScheduleById failed', { error: e.message });
    return null;
  }
}

/**
 * deactivateSchedule — إيقاف جدول
 */
export async function deactivateSchedule(uid, schedId) {
  try {
    const db = await getDb();
    await db.doc(`schedules/${schedId}`).update({ status: 'paused' });
    await db.doc(`users/${uid}/schedules/${schedId}`).update({ status: 'paused' });
    log('ok', 'schedule', `Deactivated ${schedId}`);
  } catch (e) {
    log('error', 'schedule', 'deactivateSchedule failed', { error: e.message });
  }
}

