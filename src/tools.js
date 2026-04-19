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
// FIREBASE — MEMORY ONLY
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

// قراءة memory.md من Firestore
export async function loadMemory(uid) {
  try {
    const db  = await getDb();
    const doc = await db.doc(`users/${uid}/memory/doc`).get();
    if (doc.exists && doc.data()?.content) return doc.data().content;
    return readMd('memory.md'); // template للمستخدمين الجدد
  } catch (e) {
    log('error', 'memory', 'loadMemory failed', { error: e.message });
    return readMd('memory.md');
  }
}

// حفظ memory.md كاملاً في Firestore
export async function saveMemory(uid, content) {
  try {
    const db = await getDb();
    await db.doc(`users/${uid}/memory/doc`).set({
      content,
      updated_at: new Date().toISOString(),
    });
    log('ok', 'memory', `saveMemory uid=${uid.slice(0,8)}`);
  } catch (e) {
    log('error', 'memory', 'saveMemory failed', { error: e.message });
    throw e; // re-throw حتى agent يعرف
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
// CODE EXECUTION SANDBOX
// ────────────────────────────────────────────────────────────────
// الإصلاحات المطبّقة:
//   1. cwd: PROJECT_DIR  → node_modules موجودة
//   2. NODE_PATH         → يحل مشكلة firebase-admin import
//   3. __mem_update__    → exec لا يستورد firebase — agent يحفظ
//   4. دعم Python         → lang="py"
//   5. fetch محسّن       → User-Agent + AbortSignal.timeout
//   6. helper functions  → تُحقَن من tools.md تلقائياً
// ================================================================
export async function executeCode(uid, code, currentMemory, lang = 'js') {
  const id = `ofoq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

  if (lang === 'py') {
    return executePython(id, code);
  }

  return executeJS(uid, id, code, currentMemory);
}

// ── JavaScript Execution ──────────────────────────────────────────
async function executeJS(uid, id, code, currentMemory) {
  const tmpFile = join(tmpdir(), `${id}.mjs`);

  // استخرج helper functions من tools.md
  const toolsMd   = readMd('tools.md');
  const helpersFn = extractJsBlocks(toolsMd);

  const escapedMem = JSON.stringify(currentMemory);
  const escapedUid = JSON.stringify(uid);

  const wrapper = `
// OFOQ JS Sandbox — Node.js ${process.version}
// project: ${PROJECT_DIR}

const __mem = ${escapedMem};
const __uid = ${escapedUid};

// ── fetch محسّن مع User-Agent تلقائي ─────────────────────────────
const _originalFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  const headers = {
    'User-Agent': 'OFOQ-Agent/6.0',
    ...(opts.headers || {}),
  };
  return _originalFetch(url, { ...opts, headers });
};

// ── Helper Functions من tools.md ─────────────────────────────────
${helpersFn}

// ── كود الـ AI ────────────────────────────────────────────────────
async function __run__() {
${code}
}

let __result__;
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
      cwd:       PROJECT_DIR,   // ← FIX 1: node_modules موجودة هنا
      env: {
        ...process.env,
        NODE_PATH: join(PROJECT_DIR, 'node_modules'), // ← FIX 2: resolver صح
      },
    });
  } catch (e) {
    stderr = e.stdout || e.stderr || e.message || '';
    if (e.stdout) stdout = e.stdout;
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  return parseExecOutput(stdout, stderr);
}

// ── Python Execution ──────────────────────────────────────────────
async function executePython(id, code) {
  const tmpFile = join(tmpdir(), `${id}.py`);

  const wrapper = `
import json, sys

def __get_result__():
${code.split('\n').map(l => '    ' + l).join('\n')}

try:
    result = __get_result__()
    if result is not None:
        print('__RESULT__:' + json.dumps(result, ensure_ascii=False))
except Exception as e:
    print('__ERROR__:' + str(e))
    sys.exit(1)
`;

  writeFileSync(tmpFile, wrapper, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`python3 "${tmpFile}"`, {
      timeout:   30_000,
      maxBuffer: 1024 * 512,
      encoding:  'utf8',
    });
  } catch (e) {
    stderr = e.stdout || e.stderr || e.message || '';
    if (e.stdout) stdout = e.stdout;
  } finally {
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
  }

  return parseExecOutput(stdout, stderr);
}

// ── Parse exec output ─────────────────────────────────────────────
function parseExecOutput(stdout, stderr) {
  const combined    = stdout + stderr;
  const resultLine  = combined.split('\n').find(l => l.startsWith('__RESULT__:'));
  const errorLine   = combined.split('\n').find(l => l.startsWith('__ERROR__:'));
  const cleanOutput = combined.replace(/__RESULT__:.*|__ERROR__:.*/g, '').trim().slice(0, 2000);

  if (errorLine) {
    return {
      success: false,
      error:   errorLine.replace('__ERROR__:', '').trim(),
      output:  cleanOutput,
    };
  }

  let result = null;
  if (resultLine) {
    try   { result = JSON.parse(resultLine.replace('__RESULT__:', '')); }
    catch { result = resultLine.replace('__RESULT__:', '').trim(); }
  }

  return { success: true, result, output: cleanOutput };
}

// استخرج كتل ```js من tools.md
function extractJsBlocks(mdText) {
  const blocks = [];
  const re = /```js\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(mdText)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join('\n\n');
}
