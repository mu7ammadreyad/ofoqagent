// agent.js — OFOQ Agent v7.0 (Unified)
// AGENT_MODE=agent (default) | AGENT_MODE=scheduler
// ملف واحد: Tools + Task.md + Agent Core + Scheduler

// ================================================================
// SECTION 1 — TOOLS  (was tools.js)
// ================================================================
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
function log(level, section, msg, data = null) {
  const ts   = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  const icon = { info:'ℹ️', ok:'✅', warn:'⚠️', error:'❌' }[level] || '•';
  console.log(`${icon} [${ts}] [${section}] ${msg}`);
  if (data) console.log(JSON.stringify(sanitize(data), null, 2));
}

function sanitize(obj) {
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
function readSkill(filename) {
  try {
    return readFileSync(join(SKILLS_DIR, filename), 'utf8');
  } catch {
    log('error', 'tools', `Could not read skills/${filename}`);
    return '';
  }
}

// backward-compat alias
const readMd = readSkill;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cairoDate() {
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

async function loadMemory(uid) {
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
async function saveMemory(uid, fullContent) {
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
function getMemVal(mem, key) {
  const line = mem.split('\n').find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return (val === 'null' || val === '') ? null : val;
}

// ── Conversations ─────────────────────────────────────────────────
// كل محادثة = document في users/{uid}/conversations/{convId}
// يحتوي على history كامل + thinking + tool_updates + final_response

async function createConv(uid, convId, userMessage, history = []) {
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

async function getConv(uid, convId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/conversations/${convId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) { log('error', 'conv', 'getConv failed', { error: e.message }); return null; }
}

async function updateConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).update(data);
  } catch (e) { log('error', 'conv', 'updateConv failed', { error: e.message }); }
}

async function saveConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set(data, { merge: true });
  } catch (e) { log('error', 'conv', 'saveConv failed', { error: e.message }); }
}

async function appendToConv(uid, convId, field, value) {
  try {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      [field]: FieldValue.arrayUnion(value),
    });
  } catch (e) { log('warn', 'conv', `append ${field} failed`, { error: e.message }); }
}

// قراءة ملف مرفوع من Firestore
async function readUploadedFile(uid, fileId) {
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
async function executeShell(script) {
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
function parseCronNext(cronExpr, afterDate = new Date(), timezone = 'Africa/Cairo') {
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
async function createSchedule(uid, { name, description = '', cron, taskPrompt, timezone = 'Africa/Cairo' }) {
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
async function getSchedules(uid) {
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
async function getDueSchedules() {
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
async function markScheduleRan(schedId, uid, cron, timezone = 'Africa/Cairo') {
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
async function appendScheduleMessage(uid, convId, schedId, content, runNumber) {
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
async function getScheduleById(schedId) {
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
async function deactivateSchedule(uid, schedId) {
  try {
    const db = await getDb();
    await db.doc(`schedules/${schedId}`).update({ status: 'paused' });
    await db.doc(`users/${uid}/schedules/${schedId}`).update({ status: 'paused' });
    log('ok', 'schedule', `Deactivated ${schedId}`);
  } catch (e) {
    log('error', 'schedule', 'deactivateSchedule failed', { error: e.message });
  }
}


// ================================================================
// SECTION 2 — TASK.MD  (scratchpad محلي مؤقت على GitHub Actions)
// ================================================================
// task.md يُنشأ مع بداية كل job ويُحذف تلقائياً بانتهاء الـ runner
// أسرع من Firestore — للبيانات المؤقتة: نتائج shell، مخرجات بحث، تفكير متسلسل
// memory.md → Firestore (دائم) | task.md → /tmp (مؤقت per-job)

function getTaskPath(convId) {
  return join(tmpdir(), `ofoq_task_${(convId || 'default').replace(/[^a-z0-9_]/gi, '_')}.md`);
}

/** يكتب task.md كاملاً (full overwrite مثل update_memory) */
function writeTask(convId, content) {
  writeFileSync(getTaskPath(convId), content, 'utf8');
  log('info', 'task', `writeTask (${content.length}ch)`);
}

/** يقرأ task.md — يعيد '' لو مش موجود */
function readTask(convId) {
  const p = getTaskPath(convId);
  try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
}

/** يُلحق قسماً لـ task.md */
function appendTask(convId, text) {
  const p   = getTaskPath(convId);
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  writeFileSync(p, cur + '\n' + text, 'utf8');
}

/** يحذف task.md في نهاية الـ job */
function cleanTask(convId) {
  try { const p = getTaskPath(convId); if (existsSync(p)) unlinkSync(p); } catch {}
}

// ================================================================
// SECTION 3 — AGENT CORE  (was agent.js)
// ================================================================
// ── Env ───────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMMA_KEY  = process.env.GEMMA_API_KEY || GEMINI_KEY;
const UID        = process.env.CONV_UID;
const CONV_ID    = process.env.CONV_ID;

if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY missing'); process.exit(1); }
if (!UID)        { console.error('❌ CONV_UID missing');        process.exit(1); }
if (!CONV_ID)    { console.error('❌ CONV_ID missing');         process.exit(1); }

// ================================================================
// SECTION 1 — ACTION PARSER
//
// صيغتان:
//   <action type="shell">bash commands</action>
//   <action type="update_memory">memory.md كامل من أوله لآخره</action>
//
// النص خارج الـ actions = تفكير مرئي أو رد نهائي
// ================================================================

function parseActions(text) {
  const actions = [];
  const re = /<action\s+([^>]*)>([\s\S]*?)<\/action>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrsStr = m[1], body = m[2].trim();
    const attrs = {};
    const ar = /(\w+)=["']([^"']*)["']/g; let am;
    while ((am = ar.exec(attrsStr)) !== null) attrs[am[1]] = am[2];
    const type = (attrs.type || '').toLowerCase();
    if (type === 'shell')           actions.push({ type: 'shell',           script:  body, raw: m[0] });
    if (type === 'update_memory')   actions.push({ type: 'update_memory',   content: body, raw: m[0] });
    if (type === 'write_task')      actions.push({ type: 'write_task',      content: body, raw: m[0] });
    if (type === 'create_schedule') actions.push({ type: 'create_schedule', content: body, raw: m[0] });
    if (type === 'list_schedules')  actions.push({ type: 'list_schedules',  content: body, raw: m[0] });
    if (type === 'pause_schedule')  actions.push({ type: 'pause_schedule',  content: body, raw: m[0] });
  }
  return actions;
}

// كل شيء خارج action tags
function extractText(text) {
  return text.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '').trim();
}

// ================================================================
// SECTION 2 — THINKING PASS (SSE بدون tools → thinkingConfig يعمل)
// ================================================================
async function streamThinking(userMsg, soul, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `فكّر باختصار: ${userMsg.slice(0, 300)}` }] }],
        systemInstruction: { parts: [{ text: soul.slice(0, 1000) }] },
        generationConfig: { temperature: 0.5, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 400 } },
      }),
    });
    if (!resp.ok) return;
    const reader = resp.body.getReader(), dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const json = t.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        let chunk; try { chunk = JSON.parse(json); } catch { continue; }
        for (const part of (chunk.candidates?.[0]?.content?.parts ?? [])) {
          if (part.thought === true && part.text) await onChunk(part.text);
        }
      }
    }
  } catch (e) {
    log('warn', 'agent', 'thinking pass failed (non-fatal)', { error: e.message });
  }
}

// ================================================================
// SECTION 3 — MODEL CALL
// retry مع exponential backoff
// ================================================================
async function callModel(messages, systemInstruction, attempt = 0) {
  const useGemma = attempt === 1;
  const model    = useGemma ? 'gemma-4-26b-a4b-it' : 'gemma-4-26b-a4b-it';
  const apiKey   = useGemma ? GEMMA_KEY : GEMINI_KEY;
  const url      = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // حذف thought parts — يمنع thought_signature error
  const clean = messages
    .map(m => ({ role: m.role, parts: (m.parts || []).filter(p => !p.thought) }))
    .filter(m => m.parts.length);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: clean,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
    });
  } catch (e) {
    if (attempt < 5) {
      const wait = [500, 2000, 5000, 10000, 20000][attempt] || 20000;
      log('warn', 'agent', `fetch failed (attempt ${attempt+1}) → retry ${wait}ms`, { error: e.message });
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`AI unreachable after 5 attempts: ${e.message}`);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && attempt < 5) {
      const wait = [1000, 3000, 6000, 12000, 24000][attempt] || 24000;
      log('warn', 'agent', `HTTP ${resp.status} → retry ${wait}ms`);
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`${model} ${resp.status}: ${JSON.stringify(err).slice(0, 100)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// SECTION 4 — SYSTEM INSTRUCTION BUILDER
// يدمج soul.md + tools.md + memory.md الحالي للمستخدم
// يُعاد بناؤه في كل round مع أحدث نسخة من memory
// ================================================================
function buildSystemInstruction(soul, toolsMd, currentMemory, convId) {
  const now      = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  const taskNote = readTask(convId);
  return [
    soul,
    '\n\n---\n## Shell Examples (skills/tools.md)\n',
    toolsMd,
    '\n\n---\n## ذاكرتك الدائمة (memory.md — Firestore)\n```\n',
    currentMemory,
    '\n```',
    taskNote ? `\n\n---\n## مفكّرتك المؤقتة (task.md — local)\n\`\`\`\n${taskNote}\n\`\`\`` : '',
    `\n\n**الوقت:** ${now}`,
  ].join('');
}

// ================================================================
// SECTION 5 — REACT LOOP
// ================================================================
async function reactLoop(uid, convId, userMsg, history, soul, toolsMd) {
  // تحميل memory.md مع كل رسالة — مصدر الحقيقة الوحيد
  let currentMemory = await loadMemory(uid);
  let memUpdated    = false;

  // بناء Gemini messages من history
  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText = '';

  for (let round = 0; round < 15; round++) {
    log('info', 'agent', `ReAct round ${round + 1}/15`);

    // أعد بناء sysInstruction في كل round مع أحدث memory + task.md
    const sysInst = buildSystemInstruction(soul, toolsMd, currentMemory, convId);
    const raw     = await callModel(messages, sysInst);
    log('info', 'agent', `Model (${raw.length}ch)`, { preview: raw.slice(0, 70) });

    const actions  = parseActions(raw);
    const textOnly = extractText(raw);

    // النص خارج الـ actions → thinking chunks (مرئي للمستخدم live)
    if (textOnly) {
      await appendToConv(uid, convId, 'thinking_chunks', textOnly);
      log('info', 'agent', `[think] ${textOnly.slice(0, 60)}`);
    }

    // لا actions = رد نهائي
    if (!actions.length) {
      finalText = raw.trim();
      messages.push({ role: 'model', parts: [{ text: finalText }] });
      break;
    }

    const resultParts = [];

    for (const action of actions) {
      // ── shell ────────────────────────────────────────────────────
      if (action.type === 'shell') {
        log('info', 'agent', `[shell] ${action.script.slice(0, 60)}`);
        await appendToConv(uid, convId, 'tool_updates', '⚙️ shell...');
        const result = await executeShell(action.script);
        const label  = result.success ? '✅ shell نجح' : `❌ shell: ${result.error?.slice(0,60)}`;
        await appendToConv(uid, convId, 'tool_updates', label);
        resultParts.push({ type: 'shell', success: result.success, stdout: result.stdout, stderr: result.stderr, error: result.error });
      }

      // ── update_memory ────────────────────────────────────────────
      // AI يكتب ملف memory.md كاملاً من أوله لآخره
      else if (action.type === 'update_memory') {
        log('info', 'agent', `[update_memory] ${action.content.length}ch`);
        await appendToConv(uid, convId, 'tool_updates', '💾 تحديث الذاكرة...');
        try {
          await saveMemory(uid, action.content);
          currentMemory = action.content;
          memUpdated    = true;
          await appendToConv(uid, convId, 'tool_updates', '✅ تم تحديث memory.md');
          resultParts.push({ type: 'update_memory', success: true, size: action.content.length });
        } catch (e) {
          await appendToConv(uid, convId, 'tool_updates', `❌ فشل الحفظ: ${e.message.slice(0, 60)}`);
          resultParts.push({ type: 'update_memory', success: false, error: e.message });
        }
      }

      // ── write_task ───────────────────────────────────────────────
      // AI يكتب مفكّرته المؤقتة المحلية (task.md) — أسرع من Firestore
      // مناسب لـ: خطوات التفكير، نتائج البحث، بيانات وسيطة ضخمة
      else if (action.type === 'write_task') {
        writeTask(convId, action.content);
        log('info', 'agent', `[write_task] ${action.content.length}ch`);
        resultParts.push({ type: 'write_task', success: true, size: action.content.length });
      }
      // AI يُنشئ جدول مهام دائم في Firestore مع محادثة مخصصة
      else if (action.type === 'create_schedule') {
        log('info', 'agent', `[create_schedule]`);
        await appendToConv(uid, convId, 'tool_updates', '📅 جارٍ إنشاء الجدول...');
        try {
          // AI يكتب JSON داخل الـ action
          let params;
          try { params = JSON.parse(action.content); }
          catch { throw new Error('محتوى create_schedule يجب أن يكون JSON صالح'); }

          const { schedId, convId: schedConvId, nextRun } = await createSchedule(uid, params);
          await appendToConv(uid, convId, 'tool_updates', `✅ تم إنشاء الجدول "${params.name}"`);
          resultParts.push({ type: 'create_schedule', success: true, schedId, convId: schedConvId, nextRun });
        } catch (e) {
          await appendToConv(uid, convId, 'tool_updates', `❌ فشل إنشاء الجدول: ${e.message.slice(0, 80)}`);
          resultParts.push({ type: 'create_schedule', success: false, error: e.message });
        }
      }

      // ── list_schedules ───────────────────────────────────────────
      else if (action.type === 'list_schedules') {
        log('info', 'agent', `[list_schedules]`);
        await appendToConv(uid, convId, 'tool_updates', '📋 جلب الجداول...');
        try {
          const scheds = await getSchedules(uid);
          await appendToConv(uid, convId, 'tool_updates', `✅ ${scheds.length} جدول نشط`);
          resultParts.push({ type: 'list_schedules', success: true, schedules: scheds });
        } catch (e) {
          resultParts.push({ type: 'list_schedules', success: false, error: e.message });
        }
      }

      // ── pause_schedule ───────────────────────────────────────────
      else if (action.type === 'pause_schedule') {
        log('info', 'agent', `[pause_schedule]`);
        try {
          let params;
          try { params = JSON.parse(action.content); }
          catch { throw new Error('محتوى pause_schedule يجب أن يكون JSON: {"schedId":"..."}'); }
          await deactivateSchedule(uid, params.schedId);
          await appendToConv(uid, convId, 'tool_updates', `⏸️ تم إيقاف الجدول ${params.schedId.slice(-8)}`);
          resultParts.push({ type: 'pause_schedule', success: true, schedId: params.schedId });
        } catch (e) {
          resultParts.push({ type: 'pause_schedule', success: false, error: e.message });
        }
      }
    }

    // أضف النتائج للـ conversation
    messages.push({ role: 'model',  parts: [{ text: raw }] });
    messages.push({
      role:  'user',
      parts: [{ text: `نتائج:\n${JSON.stringify(resultParts, null, 2)}\n\nأكمل ردك للمستخدم بالعربية بإيجاز. لا تكرر tokens.` }],
    });
  }

  if (!finalText) finalText = '❌ لم أتمكن من إتمام الطلب — جرب مرة أخرى.';

  return {
    finalText,
    updatedHistory: [
      ...history,
      { role: 'user',      content: userMsg },
      { role: 'assistant', content: finalText },
    ],
    memUpdated,
  };
}

// ================================================================
// SECTION 6 — MAIN
// ================================================================
async function mainAgent() {
  log('info', 'agent', `Starting — uid=${UID?.slice(0,8)} conv=${CONV_ID}`);

  // soul.md و tools.md من skills/ محلياً فقط — لا Firestore
  const soul    = readSkill('soul.md');
  const toolsMd = readSkill('tools.md');
  if (!soul) { log('error', 'agent', 'skills/soul.md not found'); process.exit(1); }

  // تحديث status → running
  await updateConv(UID, CONV_ID, { status: 'running' });

  // تحميل الـ conversation (اللي أنشأه الـ frontend)
  const conv = await getConv(UID, CONV_ID);
  if (!conv) { log('error', 'agent', 'Conversation not found in Firestore'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // Thinking pass — SSE chunks → Firestore thinking_chunks
  await updateConv(UID, CONV_ID, { status: 'thinking' });
  await streamThinking(userMsg, soul, async (chunk) => {
    await appendToConv(UID, CONV_ID, 'thinking_chunks', chunk);
  });

  // ReAct loop
  await updateConv(UID, CONV_ID, { status: 'running' });
  const { finalText, updatedHistory, memUpdated } = await reactLoop(
    UID, CONV_ID, userMsg, history, soul, toolsMd,
  );

  // حفظ الرد النهائي + history كامل
  await saveConv(UID, CONV_ID, {
    status:         'done',
    final_response: finalText,
    history:        updatedHistory,  // history كامل محفوظ في Firestore
    finished_at:    new Date().toISOString(),
  });

  log('ok', 'agent', `Done — memUpdated=${memUpdated} history=${updatedHistory.length} msgs`);
  cleanTask(CONV_ID); // احذف task.md المؤقت
}

// ================================================================
// SECTION 4 — SCHEDULER  (was scheduler.js)
// ================================================================
async function mainScheduler() {
  const now = new Date();
  log('info', 'scheduler', `Starting — ${now.toISOString()}`);

  const due = await getDueSchedules();
  log('info', 'scheduler', `Due schedules: ${due.length}`);

  if (!due.length) {
    log('ok', 'scheduler', 'No due schedules — done.');
    return;
  }

  for (const sched of due) {
    try {
      await runScheduledTask(sched, now);
      await sleep(2000); // تأخير بسيط بين المهام
    } catch (e) {
      log('error', 'scheduler', `Failed for sched ${sched.id}`, { error: e.message });
    }
  }

  log('ok', 'scheduler', 'All due schedules processed.');
}

// ================================================================
// RUN A SINGLE SCHEDULED TASK
// ================================================================
async function runScheduledTask(sched, now) {
  const { id: schedId, uid, name, task_prompt, cron, timezone = 'Africa/Cairo', conv_id: convId, run_count = 0 } = sched;

  log('info', 'scheduler', `Running: "${name}" (${schedId.slice(-8)}) uid=${uid?.slice(0,8)}`);

  // 1. احسب run number
  const runNumber = run_count + 1;
  const runLabel  = `#${runNumber} — ${now.toLocaleString('ar-EG', { timeZone: timezone })}`;

  // 2. أضف entry لمحادثة الجدول (في البداية = "جارٍ التنفيذ")
  await appendScheduleMessage(uid, convId, schedId, `⚙️ جارٍ التنفيذ... ${runLabel}`, runNumber);

  // 3. استدعاء Gemini مباشرة لتنفيذ المهمة
  const memory = await loadMemory(uid);
  const result = await executeScheduledPrompt(task_prompt, memory, sched, runNumber, now, timezone);

  // 4. احفظ النتيجة في محادثة الجدول
  await appendScheduleMessage(uid, convId, schedId, result, runNumber);

  // 5. حدّث next_run_at
  await markScheduleRan(schedId, uid, cron, timezone);

  log('ok', 'scheduler', `Done: "${name}" run #${runNumber}`);
}

// ================================================================
// CALL GEMINI FOR SCHEDULED TASK
// ================================================================
async function executeScheduledPrompt(taskPrompt, memory, sched, runNumber, now, timezone) {
  const nowStr = now.toLocaleString('ar-EG', { timeZone: timezone });
  const systemInstruction = `أنت أفق — مساعد ذكي يُنفّذ مهمة مجدولة تلقائياً.

## المهمة المجدولة
الاسم: ${sched.name}
الوصف: ${sched.description || '—'}
Cron: ${sched.cron}
التشغيل رقم: ${runNumber}
الوقت الحالي: ${nowStr}

## الذاكرة
${memory}

## تعليمات
- نفّذ المهمة بشكل كامل ومستقل
- إذا احتجت shell: اكتب الكود في action type="shell"
- الرد النهائي يكون الناتج المباشر للمهمة (الحكمة، التقرير، البيانات، إلخ)
- لا تحتاج تشرح ما ستفعله — نفّذ وأعطِ النتيجة مباشرة
- الرد بالعربية دائماً`;

  const messages = [{ role: 'user', parts: [{ text: taskPrompt }] }];

  let fullResponse = '';
  let attempt = 0;

  while (attempt < 4) {
    try {
      const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=${GEMINI_KEY}`;
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig:  { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      });

      if (!resp.ok) {
        const err  = await resp.json().catch(() => ({}));
        const wait = [2000, 5000, 10000][attempt] || 10000;
        log('warn', 'scheduler', `HTTP ${resp.status} → retry ${wait}ms`);
        await sleep(wait);
        attempt++;
        continue;
      }

      const data = await resp.json();
      fullResponse = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

      // تحقق إذا فيه shell actions — نفّذها
      const shellRe = /<action\s+type=["']shell["']>([\s\S]*?)<\/action>/gi;
      let m;
      let enriched = fullResponse;
      while ((m = shellRe.exec(fullResponse)) !== null) {
        const script = m[1].trim();
        log('info', 'scheduler', `[sched-shell] ${script.slice(0, 60)}`);
        const res = await runShell(script);
        const out = res.success
          ? `\n\n\`\`\`\n${res.stdout.slice(0, 1000)}\n\`\`\``
          : `\n\n❌ shell فشل: ${res.error?.slice(0, 200)}`;
        enriched = enriched.replace(m[0], out);
      }

      // إزالة action tags من الرد النهائي
      enriched = enriched.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '').trim();
      return enriched || '✅ تم التنفيذ (بدون ناتج نصي)';

    } catch (e) {
      const wait = [2000, 5000, 10000][attempt] || 10000;
      log('warn', 'scheduler', `fetch failed → retry ${wait}ms`, { error: e.message });
      await sleep(wait);
      attempt++;
    }
  }

  return `❌ فشل التنفيذ بعد ${attempt} محاولات`;
}

// ================================================================
// SHELL RUNNER (مبسّط للـ scheduler)
// ================================================================
async function runShell(script) {
  const { writeFileSync, unlinkSync, existsSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join }   = await import('path');

  const id      = `sched_${Date.now()}`;
  const tmpFile = join(tmpdir(), `${id}.sh`);
  writeFileSync(tmpFile, `#!/bin/bash\nset -eo pipefail\n\n${script}\n`, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`bash "${tmpFile}"`, {
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf8',
      cwd: PROJECT_DIR,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    return { success: true, stdout: stdout.slice(0, 2000) };
  } catch (e) {
    stderr = (e.stderr || '') + (e.message || '');
    return { success: false, error: stderr.slice(0, 500), stdout: (e.stdout || '').slice(0, 500) };
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }
}

// ================================================================
// ENTRYPOINT — dispatch by AGENT_MODE
// ================================================================
const AGENT_MODE = process.env.AGENT_MODE || 'agent';
log('info', 'agent', `Mode: ${AGENT_MODE}`);

if (AGENT_MODE === 'scheduler') {
  mainScheduler().catch(e => {
    log('error', 'scheduler', 'Fatal', { error: e.message });
    process.exit(1);
  });
} else {
  mainAgent().catch(async (e) => {
    log('error', 'agent', 'Fatal error', { error: e.message });
    try {
      const _uid = process.env.CONV_UID, _cid = process.env.CONV_ID;
      if (_uid && _cid) await saveConv(_uid, _cid, {
        status: 'error', error: e.message, finished_at: new Date().toISOString()
      });
    } catch {}
    process.exit(1);
  });
}
