// tools.js — OFOQ Agent v6.0
// Code Execution Sandbox + Memory Helpers
// helpers.js مدمج هنا — لا ملفات منفصلة

import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { execSync }   from 'child_process';
import { tmpdir }     from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ================================================================
// LOGGING
// ================================================================
export function log(level, section, msg, data = null) {
  const ts    = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  const icon  = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌' }[level] || '•';
  console.log(`${icon} [${ts}] [${section}] ${msg}`);
  if (data) console.log(JSON.stringify(sanitize(data), null, 2));
}

export function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const HIDE = ['token', 'secret', 'refresh_token', 'access_token', 'password', 'api_key'];
  const out  = {};
  for (const [k, v] of Object.entries(obj)) {
    if (HIDE.some(h => k.toLowerCase().includes(h))) out[k] = '[REDACTED]';
    else if (typeof v === 'object' && v) out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}

// ================================================================
// FILE HELPERS
// ================================================================
export function readMd(filename) {
  try {
    return readFileSync(join(__dirname, '..', 'md', filename), 'utf8');
  } catch {
    log('error', 'tools', `Could not read md/${filename}`);
    return '';
  }
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// FIREBASE FIRESTORE — memory.md ops only
// الذاكرة كلها نص واحد في Firestore
// ================================================================
let _db = null;

async function getDb() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
  _db = getFirestore();
  return _db;
}

// قراءة memory.md من Firestore (أو الـ template لو مستخدم جديد)
export async function loadMemory(uid) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/memory/doc`).get();
    if (doc.exists && doc.data()?.content) return doc.data().content;
    // مستخدم جديد → نسخ الـ template
    return readMd('memory.md');
  } catch (e) {
    log('error', 'memory', 'loadMemory failed', { error: e.message });
    return readMd('memory.md');
  }
}

// حفظ memory.md في Firestore
export async function saveMemory(uid, content) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/memory/doc`).set({
      content,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    log('error', 'memory', 'saveMemory failed', { error: e.message });
  }
}

// تحديث section واحدة فقط في memory.md
export function patchMemSection(currentMem, section, newContent) {
  const marker  = `## ${section}`;
  const lines   = currentMem.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === marker);
  if (startIdx === -1) {
    // Section غير موجودة — أضفها في النهاية
    return currentMem.trimEnd() + `\n\n${marker}\n${newContent}\n`;
  }
  // ابحث عن بداية الـ section التالية
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break; }
  }
  const before = lines.slice(0, startIdx + 1).join('\n');
  const after  = lines.slice(endIdx).join('\n');
  return `${before}\n${newContent.trim()}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
}

// قراءة قيمة من CONFIG section
export function getMemVal(mem, key) {
  const lines = mem.split('\n');
  const line  = lines.find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return val === 'null' ? null : val;
}

// حفظ conversation في Firestore (لـ real-time updates)
export async function saveConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).set(data, { merge: true });
  } catch (e) {
    log('error', 'memory', 'saveConv failed', { error: e.message });
  }
}

export async function updateConv(uid, convId, data) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/conversations/${convId}`).update(data);
  } catch (e) {
    log('error', 'memory', 'updateConv failed', { error: e.message });
  }
}

export async function getConv(uid, convId) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/conversations/${convId}`).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    log('error', 'memory', 'getConv failed', { error: e.message });
    return null;
  }
}

// ================================================================
// CODE EXECUTION SANDBOX
// يشتغل في Node.js 20 داخل GitHub Actions
// الكود يكتبه الـ AI — ينفّذه هنا بأمان
// ================================================================
export async function executeCode(uid, code, currentMemory) {
  const id      = `ofoq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const tmpFile = join(tmpdir(), `${id}.mjs`);

  // قراءة tools.md لحقنه كـ helper functions
  const toolsMd = readMd('tools.md');
  // استخرج كل كتل الكود من tools.md
  const helperFunctions = extractCodeBlocks(toolsMd);

  const escapedMem = JSON.stringify(currentMemory);
  const escapedUid = JSON.stringify(uid);

  const wrapper = `
// OFOQ Code Execution Sandbox — Node.js ${process.version}
// ─────────────────────────────────────────────────────────
// المتغيرات المتاحة:
//   __mem  → نص memory.md الحالي
//   __uid  → Firebase UID
//   fetch  → HTTP (Node 18+)
//   process.env.FIREBASE_SERVICE_ACCOUNT

const __mem = ${escapedMem};
const __uid = ${escapedUid};

// ── Helper Functions من tools.md ──────────────────────────
${helperFunctions}

// ── كود الـ AI ────────────────────────────────────────────
let __result__ = undefined;
async function __run__() {
${code}
}

try {
  __result__ = await __run__();
  if (__result__ !== undefined) {
    process.stdout.write('\\n__RESULT__:' + JSON.stringify(__result__) + '\\n');
  }
} catch (e) {
  process.stdout.write('\\n__ERROR__:' + e.message + '\\n');
  process.exit(1);
}
`;

  writeFileSync(tmpFile, wrapper, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`node "${tmpFile}"`, {
      timeout:   30_000,
      maxBuffer: 1024 * 512,
      encoding:  'utf8',
      env: { ...process.env },
    });
  } catch (e) {
    stderr = e.stdout || e.message || '';
    // لو stdout فيه نتيجة جزئية قبل الخطأ
    if (e.stdout) stdout = e.stdout;
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  const combined   = stdout + stderr;
  const resultLine = combined.split('\n').find(l => l.startsWith('__RESULT__:'));
  const errorLine  = combined.split('\n').find(l => l.startsWith('__ERROR__:'));

  if (errorLine) {
    const errMsg = errorLine.replace('__ERROR__:', '').trim();
    return {
      success: false,
      error:   errMsg,
      output:  combined.replace(/__RESULT__:.*|__ERROR__:.*/g, '').trim().slice(0, 1000),
    };
  }

  let result = null;
  if (resultLine) {
    try   { result = JSON.parse(resultLine.replace('__RESULT__:', '')); }
    catch { result = resultLine.replace('__RESULT__:', '').trim(); }
  }

  return {
    success: true,
    result,
    output: stdout.replace(/__RESULT__:.*/g, '').trim().slice(0, 1000),
  };
}

// استخرج code blocks من ملف MD
function extractCodeBlocks(mdText) {
  const blocks = [];
  const re = /```js\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(mdText)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join('\n\n');
}
