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
      timeout:   55_000,          // 55s — GitHub Actions job timeout 10min
      maxBuffer: 1024 * 1024,     // 1MB output
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
