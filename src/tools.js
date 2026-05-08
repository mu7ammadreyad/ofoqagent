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

// ================================================================
// BROWSER EXECUTION — AX Tree via Playwright
// ================================================================

// ================================================================
// BROWSER EXECUTION
// المستوى 1: Camoufox (Firefox متخفي — يتجاوز bot detection)
// المستوى 2: requests + html parsing (fallback للمواقع البسيطة)
// ================================================================

/**
 * تثبيت الأدوات المطلوبة مرة واحدة وتخزين النتيجة
 */
let _browserReady = false;
async function ensureBrowserTools() {
  if (_browserReady) return true;
  const check = await executeShell(`python3 -c "import camoufox; print('camoufox_ok')" 2>/dev/null || echo "camoufox_missing"`);
  if (check.stdout?.includes('camoufox_ok')) { _browserReady = true; return true; }

  log('info','browser','Installing camoufox...');
  const install = await executeShell(`
pip install camoufox[geoip] --break-system-packages -q 2>&1 | tail -3
python3 -m camoufox fetch --browser firefox 2>&1 | tail -5
echo "install_done"
`);
  _browserReady = install.stdout?.includes('install_done');
  return _browserReady;
}

/**
 * engine = "camoufox" | "requests"
 */
export async function executeBrowser(url, task = '', engine = 'camoufox') {
  // requests fallback — للمواقع البسيطة (أسرع، بدون browser)
  if (engine === 'requests') {
    return executeRequestsFetch(url, task);
  }

  // Camoufox — Firefox متخفي يتجاوز Cloudflare/bot detection
  await ensureBrowserTools();
  return executeCamoufox(url, task);
}

async function executeCamoufox(url, task) {
  const urlEsc  = url.replace(/'/g, "\\'");
  const taskEsc = task.replace(/'/g, "\\'");

  const script = `
import json, sys

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    print(json.dumps({"success": False, "error": "camoufox not available", "engine_used": "camoufox"}))
    sys.exit(0)

def extract_article(page):
    """استخراج محتوى المقال الرئيسي"""
    selectors = ['article', 'main', '[role=main]',
                 '.article-body', '.post-content',
                 '.entry-content', '.content', '#content']
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el:
                text = el.inner_text().strip()
                if len(text) > 300:
                    return text[:7000]
        except Exception:
            continue
    try:
        return page.inner_text('body').strip()[:5000]
    except Exception:
        return ''

def run():
    try:
        with Camoufox(headless=True) as browser:
            page = browser.new_page()

            # تجاهل الموارد الثقيلة
            def block_heavy(route, req):
                if req.resource_type in ('image', 'media', 'font', 'stylesheet'):
                    route.abort()
                else:
                    route.continue_()
            page.route('**/*', block_heavy)

            page.goto('${urlEsc}', wait_until='domcontentloaded', timeout=30000)
            try:
                page.wait_for_load_state('networkidle', timeout=6000)
            except Exception:
                pass

            title = ''
            try: title = page.title()
            except Exception: pass

            article_text = extract_article(page)

            headings = []
            try:
                headings = page.evaluate(
                    "() => [...document.querySelectorAll('h1,h2,h3')]"
                    ".map(h => ({tag:h.tagName,text:h.innerText.trim().substring(0,120)}))"
                    ".slice(0,15)"
                )
            except Exception: pass

            links = []
            try:
                links = page.evaluate(
                    "() => [...document.querySelectorAll('a[href]')]"
                    ".filter(a => a.innerText.trim().length > 2)"
                    ".map(a => ({text:a.innerText.trim().substring(0,60),href:a.href}))"
                    ".slice(0,20)"
                )
            except Exception: pass

            return {
                "success": True,
                "url": '${urlEsc}',
                "task": '${taskEsc}',
                "title": title,
                "article_text": article_text,
                "headings": headings,
                "links": links,
                "engine_used": "camoufox",
                "textLength": len(article_text),
            }
    except Exception as e:
        return {"success": False, "error": str(e), "engine_used": "camoufox"}

result = run()
print(json.dumps(result, ensure_ascii=False))
`;

  const r = await executeShell(`python3 << 'PYEOF'\n${script}\nPYEOF`);
  if (!r.success) {
    log('warn','browser',`Camoufox shell failed: ${r.error?.slice(0,80)} — falling back to requests`);
    return executeRequestsFetch(url, task);  // fallback تلقائي
  }

  try {
    const parsed = JSON.parse(r.stdout.trim());
    log('info','browser',`engine=${parsed.engine_used} textLen=${parsed.textLength} success=${parsed.success}`);
    if (!parsed.success) {
      log('warn','browser',`Camoufox failed: ${parsed.error} — falling back to requests`);
      return executeRequestsFetch(url, task);
    }
    return { type:'browser', ...parsed };
  } catch {
    log('warn','browser','JSON parse failed — falling back to requests');
    return executeRequestsFetch(url, task);
  }
}

async function executeRequestsFetch(url, task) {
  const urlEsc  = url.replace(/'/g, "\\'");
  const taskEsc = task.replace(/'/g, "\\'");

  const script = `
import json, sys, re

try:
    import urllib.request

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
        "Accept-Encoding": "identity",
    }
    req = urllib.request.Request('${urlEsc}', headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read().decode('utf-8', errors='ignore')

    # إزالة scripts و styles
    raw = re.sub(r'<script[^>]*>.*?</script>', ' ', raw, flags=re.DOTALL|re.IGNORECASE)
    raw = re.sub(r'<style[^>]*>.*?</style>',  ' ', raw, flags=re.DOTALL|re.IGNORECASE)

    # استخراج العنوان
    title_m = re.search(r'<title[^>]*>(.*?)</title>', raw, re.IGNORECASE|re.DOTALL)
    title = title_m.group(1).strip() if title_m else ''

    # إزالة باقي الـ tags
    text = re.sub(r'<[^>]+>', ' ', raw)
    text = re.sub(r'&[a-zA-Z]+;', ' ', text)
    text = re.sub(r'\\s+', ' ', text).strip()[:6000]

    # استخراج الروابط
    links = []
    for m in re.finditer(r'href=["\\'](https?://[^"\\'\\s]+)["\\'"]', raw):
        links.append({"href": m.group(1)})
    links = links[:15]

    print(json.dumps({
        "success": True,
        "url": '${urlEsc}',
        "task": '${taskEsc}',
        "title": title,
        "article_text": text,
        "text": text,
        "headings": [],
        "links": links,
        "engine_used": "requests",
        "textLength": len(text),
    }, ensure_ascii=False))

except Exception as e:
    print(json.dumps({"success": False, "error": str(e), "engine_used": "requests"}))
`;

  const r = await executeShell(`python3 << 'PYEOF'\n${script}\nPYEOF`);
  if (!r.success) {
    return { success:false, type:'browser', error:r.error, engine_used:'requests' };
  }

  try {
    const parsed = JSON.parse(r.stdout.trim());
    log('info','browser',`requests engine — textLen=${parsed.textLength} success=${parsed.success}`);
    return { type:'browser', ...parsed };
  } catch {
    return { success:false, type:'browser', error:'JSON parse failed', engine_used:'requests' };
  }
}
