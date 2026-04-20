// tools.js — OFOQ Agent v6.0
// Code Execution Sandbox + Memory Helpers + Logging
// helpers.js مدمج هنا

import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { execSync }           from 'child_process';
import { tmpdir }             from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath }      from 'url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..'); // project root

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
export function readMd(filename) {
  try {
    return readFileSync(join(PROJECT_DIR, 'md', filename), 'utf8');
  } catch {
    log('error', 'tools', `Could not read md/${filename}`);
    return '';
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// FIREBASE — MEMORY + MD DOCS
// ================================================================

// ← Firebase Service Account — مؤقت للتطوير، انقله لـ GitHub Secret لاحقاً
const FIREBASE_SA_HARDCODED = process.env.FIREBASE_SERVICE_ACCOUNT || JSON.stringify({
  // ضع هنا محتوى ملف serviceAccount.json مؤقتاً
  // مثال: "type": "service_account", "project_id": "...", ...
  // استبدله بـ FIREBASE_SERVICE_ACCOUNT secret في الإنتاج
  _placeholder: true,
});

let _db = null;

async function getDb() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let sa;
    try {
      sa = JSON.parse(FIREBASE_SA_HARDCODED);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT غير صالح — تحقق من الـ JSON');
    }
    if (sa._placeholder) throw new Error('ضع Firebase Service Account في FIREBASE_SA_HARDCODED أو GitHub Secret');
    initializeApp({ credential: cert(sa) });
  }
  _db = getFirestore();
  return _db;
}

// قراءة memory.md من Firestore
export async function loadMemory(uid) {
  return loadMdDoc(uid, 'memory');
}

// حفظ memory.md كاملاً في Firestore
export async function saveMemory(uid, content) {
  await saveMdDoc(uid, 'memory', content);
}

// ── قراءة MD document من Firestore per-uid ────────────────────────
// يُستخدم لـ soul / tools / memory
// fallback: ملف محلي لو الـ document غير موجود بعد
export async function loadMdDoc(uid, docName) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/config/${docName}`).get();
    if (doc.exists && doc.data()?.content) return doc.data().content;
    // أول مرة → احفظ الـ template محلياً في Firestore
    const template = readMd(`${docName}.md`);
    if (template) {
      await saveMdDoc(uid, docName, template);
      log('ok', 'memory', `${docName}.md → Firestore (first time init)`);
    }
    return template;
  } catch (e) {
    log('error', 'memory', `loadMdDoc(${docName}) failed`, { error: e.message });
    return readMd(`${docName}.md`);
  }
}

// ── حفظ MD document في Firestore per-uid ─────────────────────────
export async function saveMdDoc(uid, docName, content) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/config/${docName}`).set({
      content,
      updated_at: new Date().toISOString(),
    });
    log('ok', 'memory', `saveMdDoc(${docName}) uid=${uid.slice(0,8)}`);
  } catch (e) {
    log('error', 'memory', `saveMdDoc(${docName}) failed`, { error: e.message });
    throw e;
  }
}

// تحديث section واحدة في memory.md بدون مسح الباقي
export function patchMemSection(currentMem, section, newContent) {
  const marker  = `## ${section}`;
  const lines   = currentMem.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === marker);

  if (startIdx === -1) {
    // Section غير موجودة — أضفها في النهاية
    return currentMem.trimEnd() + `\n\n${marker}\n${newContent.trim()}\n`;
  }

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break; }
  }

  const before = lines.slice(0, startIdx + 1).join('\n');
  const after  = lines.slice(endIdx).join('\n');
  const sep    = after.trim() ? '\n\n' : '\n';
  return `${before}\n${newContent.trim()}${sep}${after}`.replace(/\n{3,}/g, '\n\n');
}

// قراءة قيمة من memory text
export function getMemVal(mem, key) {
  const line = mem.split('\n').find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val  = line.slice(key.length + 1).trim();
  return (val === 'null' || val === '') ? null : val;
}

// ── Firestore conversation helpers ────────────────────────────────
export async function saveConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set(data, { merge: true });
  } catch (e) { log('error','memory','saveConv',{error:e.message}); }
}

export async function updateConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).update(data);
  } catch (e) { log('error','memory','updateConv',{error:e.message}); }
}

export async function getConv(uid, convId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/conversations/${convId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) { log('error','memory','getConv',{error:e.message}); return null; }
}

export async function appendFirestoreArray(uid, convId, field, value) {
  try {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      [field]: FieldValue.arrayUnion(value),
    });
  } catch (e) { log('warn','memory',`appendArr ${field}`,{error:e.message}); }
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
