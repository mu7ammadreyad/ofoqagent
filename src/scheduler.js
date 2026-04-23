// scheduler.js — OFOQ Scheduler v6.0
// يُشتغل كل دقيقة عبر GitHub Actions cron (`* * * * *`)
// يقرأ schedules النشطة من Firestore → يُنفّذ كل مهمة حانت مباشرة عبر Gemini API
//
// الفرق عن agent.js:
//   - لا يحتاج CONV_UID / CONV_ID من environment
//   - يقرأ جميع schedules النشطة عبر getDueSchedules()
//   - لكل schedule حانت: يستدعي Gemini مباشرة ويُضيف النتيجة لمحادثة الجدول

import { execSync }  from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath }   from 'url';

import {
  log, sleep,
  getDueSchedules, markScheduleRan,
  createConv, saveConv, appendScheduleMessage,
  loadMemory,
} from './tools.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR  = resolve(__dirname, '..');
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_AGENT_REPO;
const GH_TOKEN     = process.env.GITHUB_TOKEN_FOR_DISPATCH;

if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY missing'); process.exit(1); }

// ================================================================
// MAIN
// ================================================================
async function main() {
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

main().catch(e => {
  log('error', 'scheduler', 'Fatal', { error: e.message });
  process.exit(1);
});
