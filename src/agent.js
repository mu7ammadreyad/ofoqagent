// agent.js — OFOQ Agent v6.2
// معمارية: Plan-and-Solve + Reflexion
// Actions: shell | browser | update_memory | schedule_task | cancel_task

import {
  log, sleep, readSkill,
  loadMemory, saveMemory,
  getConv, updateConv, saveConv, appendToConv,
  executeShell, executeBrowser,
  createScheduledTask, toggleScheduledTask,
} from './tools.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const UID        = process.env.CONV_UID;
const CONV_ID    = process.env.CONV_ID;

if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY missing'); process.exit(1); }
if (!UID)        { console.error('❌ CONV_UID missing');        process.exit(1); }
if (!CONV_ID)    { console.error('❌ CONV_ID missing');         process.exit(1); }

// ================================================================
// SECTION 1 — ACTION PARSER
// يدعم: shell | browser | update_memory | schedule_task | cancel_task
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

    if (type === 'shell')         actions.push({ type: 'shell',  script: body });
    if (type === 'update_memory') actions.push({ type: 'update_memory', content: body });
    if (type === 'browser') {
      try   { actions.push({ type: 'browser', config: JSON.parse(body) }); }
      catch { actions.push({ type: 'browser', config: null, parseError: 'JSON invalid' }); }
    }
    if (type === 'schedule_task') {
      try   { actions.push({ type: 'schedule_task', config: JSON.parse(body) }); }
      catch (e) { actions.push({ type: 'schedule_task', config: null, parseError: e.message }); }
    }
    if (type === 'cancel_task') {
      actions.push({ type: 'cancel_task', task_id: attrs.task_id || body.trim() });
    }
  }
  return actions;
}

function extractText(text) {
  return text.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '').trim();
}

// ================================================================
// SECTION 2 — MODEL CALL (بدون timeout)
// ================================================================
async function callModel(messages, systemInstruction, attempt = 0) {
  const model = 'gemma-4-26b-a4b-it';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
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
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, topP: 0.95 },
      }),
    });
  } catch (e) {
    if (attempt < 4) {
      const wait = [1000, 3000, 6000, 12000][attempt];
      log('warn', 'agent', `fetch failed → retry ${wait}ms`);
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`AI unreachable: ${e.message}`);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && attempt < 4) {
      const wait = [2000, 5000, 10000, 20000][attempt];
      log('warn', 'agent', `HTTP ${resp.status} → retry ${wait}ms`);
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`${model} ${resp.status}: ${JSON.stringify(err).slice(0, 150)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// SECTION 3 — PLAN PASS
// أول استدعاء للنموذج = وضع خطة كاملة قبل التنفيذ
// ================================================================
async function planPass(userMsg, systemMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  const planPrompt = `${systemMd}

---
## ذاكرتك الحالية:
\`\`\`
${currentMemory}
\`\`\`
**الوقت:** ${now}

---
## مرحلة التخطيط (Plan-and-Solve)

المستخدم طلب:
"${userMsg}"

ضع خطة واضحة قبل التنفيذ:
1. GOAL: ما الهدف النهائي بالضبط؟
2. STEPS: ما الخطوات المطلوبة بالترتيب؟
3. RISKS: ما الذي قد يفشل؟ كيف ستتعامل معه؟
4. FIRST_ACTION: ما أول action ستنفذه وهل هو shell, browser, schedule_task, أم update_memory؟

اكتب الخطة باختصار ثم ابدأ بأول action مباشرة.`;

  return callModel(
    [{ role: 'user', parts: [{ text: planPrompt }] }],
    systemMd.slice(0, 2000),  // system instruction مختصر للـ plan pass
  );
}

// ================================================================
// SECTION 4 — REFLEXION PROMPT
// بعد كل نتيجة، النموذج يتأمل ويقرر
// ================================================================
function buildReflexionPrompt(actionResults, round, maxRounds) {
  return `نتائج الـ actions (الجولة ${round}/${maxRounds}):
${JSON.stringify(actionResults, null, 2)}

[REFLEXION]
- هل النتائج منطقية وصحيحة؟
- هل الخطة اكتملت أم تبقى خطوات؟
- هل يجب تعديل الخطة بناءً على ما حدث؟

إذا اكتملت المهمة → اكتب الرد النهائي للمستخدم بدون أي <action>.
إذا تبقى خطوات → نفّذ الخطوة التالية.
إذا فشل شيء → حلّل السبب وجرّب البديل.`;
}

// ================================================================
// SECTION 5 — SYSTEM INSTRUCTION BUILDER
// ================================================================
function buildSystemInstruction(systemMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return [
    systemMd,
    '\n\n---\n## ذاكرتك الحالية (memory.md):\n```\n',
    currentMemory,
    '\n```',
    `\n\n**الوقت الحالي:** ${now}`,
    '\n\n**تذكر:** Plan-and-Solve + Reflexion — فكّر قبل التنفيذ، تأمّل بعد كل نتيجة.',
  ].join('');
}

// ================================================================
// SECTION 6 — EXECUTE ONE ACTION
// ================================================================
async function executeAction(action, uid, convId) {
  // ── shell ──────────────────────────────────────────────────────
  if (action.type === 'shell') {
    log('info', 'agent', `[shell] ${action.script.slice(0, 60)}...`);
    await appendToConv(uid, convId, 'tool_updates', '⚙️ جارٍ التنفيذ...');
    const result = await executeShell(action.script);
    const label  = result.success
      ? `✅ ${result.stdout?.slice(0, 100) || 'تم'}`
      : `❌ ${result.error?.slice(0, 100)}`;
    await appendToConv(uid, convId, 'tool_updates', label);
    return { type: 'shell', success: result.success,
      stdout: result.stdout?.slice(0, 4000), stderr: result.stderr?.slice(0, 800),
      error: result.error, exit_code: result.exit_code };
  }

  // ── browser ────────────────────────────────────────────────────
  if (action.type === 'browser') {
    if (action.parseError) return { type: 'browser', success: false, error: action.parseError };
    log('info', 'agent', `[browser] ${action.config.url}`);
    await appendToConv(uid, convId, 'tool_updates', `🌐 جارٍ فتح ${action.config.url}...`);
    const result = await executeBrowser(action.config.url, action.config.task || '');
    const label  = result.success
      ? `✅ تم جلب الصفحة (${result.textLength || 0} حرف)`
      : `❌ ${result.error?.slice(0, 80)}`;
    await appendToConv(uid, convId, 'tool_updates', label);
    return result;
  }

  // ── update_memory ──────────────────────────────────────────────
  if (action.type === 'update_memory') {
    log('info', 'agent', `[update_memory] ${action.content.length}ch`);
    await appendToConv(uid, convId, 'tool_updates', '💾 تحديث الذاكرة...');
    try {
      await saveMemory(uid, action.content);
      await appendToConv(uid, convId, 'tool_updates', '✅ تم حفظ memory.md');
      return { type: 'update_memory', success: true, size: action.content.length };
    } catch (e) {
      await appendToConv(uid, convId, 'tool_updates', `❌ فشل الحفظ: ${e.message.slice(0, 60)}`);
      return { type: 'update_memory', success: false, error: e.message };
    }
  }

  // ── schedule_task ──────────────────────────────────────────────
  if (action.type === 'schedule_task') {
    if (action.parseError) return { type: 'schedule_task', success: false, error: action.parseError };
    log('info', 'agent', `[schedule_task] "${action.config.title}"`);
    await appendToConv(uid, convId, 'tool_updates', `📅 جدولة: "${action.config.title}"...`);
    try {
      const result = await createScheduledTask(uid, action.config);
      await appendToConv(uid, convId, 'tool_updates', `✅ جُدولت — التالية: ${result.nextRun}`);
      return { type: 'schedule_task', success: true, ...result, title: action.config.title };
    } catch (e) {
      await appendToConv(uid, convId, 'tool_updates', `❌ فشل: ${e.message.slice(0, 60)}`);
      return { type: 'schedule_task', success: false, error: e.message };
    }
  }

  // ── cancel_task ────────────────────────────────────────────────
  if (action.type === 'cancel_task') {
    log('info', 'agent', `[cancel_task] ${action.task_id}`);
    await appendToConv(uid, convId, 'tool_updates', `🛑 إيقاف ${action.task_id}...`);
    try {
      await toggleScheduledTask(uid, action.task_id, false);
      await appendToConv(uid, convId, 'tool_updates', '✅ تم الإيقاف');
      return { type: 'cancel_task', success: true, task_id: action.task_id };
    } catch (e) {
      return { type: 'cancel_task', success: false, error: e.message };
    }
  }

  return { type: action.type, success: false, error: 'نوع action غير معروف' };
}

// ================================================================
// SECTION 7 — PLAN-AND-SOLVE + REFLEXION LOOP
// ================================================================
async function psrLoop(uid, convId, userMsg, history, systemMd) {
  let currentMemory = await loadMemory(uid);
  let memUpdated    = false;

  // ── Phase 1: PLAN ─────────────────────────────────────────────
  log('info', 'agent', 'Phase 1: PLAN');
  await appendToConv(uid, convId, 'tool_updates', '🧠 جارٍ وضع الخطة...');
  const planText = await planPass(userMsg, systemMd, currentMemory);
  const planActions = parseActions(planText);
  const planOnly    = extractText(planText);

  if (planOnly) await appendToConv(uid, convId, 'thinking_chunks', `[PLAN]\n${planOnly}`);
  log('info', 'agent', `Plan: ${planOnly.slice(0, 120)}`);

  // ── Phase 2: EXECUTE + REFLEXION LOOP ─────────────────────────
  const messages = [
    ...history.filter(m => m.content).map(m => ({
      role:  m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user',  parts: [{ text: userMsg }] },
    { role: 'model', parts: [{ text: planText }] },
  ];

  let finalText = '';
  const MAX_ROUNDS = 15;

  // إذا لم يكن في الـ plan actions → الـ plan نفسه هو الرد
  if (!planActions.length) {
    finalText = planText.trim();
    return buildResult(history, userMsg, finalText, memUpdated);
  }

  // نفّذ الـ actions من الـ plan
  let pendingActions = planActions;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    log('info', 'agent', `EXECUTE round ${round + 1}/${MAX_ROUNDS} — ${pendingActions.length} actions`);

    // تنفيذ جميع الـ actions
    const results = [];
    for (const action of pendingActions) {
      const result = await executeAction(action, uid, convId);
      results.push(result);

      // تحديث الذاكرة المحلية إذا نجح update_memory
      if (action.type === 'update_memory' && result.success) {
        currentMemory = action.content;
        memUpdated    = true;
      }
    }

    // ── REFLEXION ──────────────────────────────────────────────
    log('info', 'agent', `Phase REFLEXION — round ${round + 1}`);
    const reflexionMsg = buildReflexionPrompt(results, round + 1, MAX_ROUNDS);
    messages.push({
      role:  'user',
      parts: [{ text: reflexionMsg }],
    });

    const sysInst  = buildSystemInstruction(systemMd, currentMemory);
    const nextStep = await callModel(messages, sysInst);
    log('info', 'agent', `Reflexion response (${nextStep.length}ch): ${nextStep.slice(0, 80)}`);

    const nextActions = parseActions(nextStep);
    const nextText    = extractText(nextStep);

    if (nextText) await appendToConv(uid, convId, 'thinking_chunks', `[REFLEXION r${round+1}]\n${nextText}`);

    messages.push({ role: 'model', parts: [{ text: nextStep }] });

    // لا actions → رد نهائي
    if (!nextActions.length) {
      finalText = nextStep.trim();
      break;
    }

    pendingActions = nextActions;
  }

  if (!finalText) finalText = '⚠️ وصلت للحد الأقصى من الجولات — راجع tool_updates لتفاصيل ما تم.';
  return buildResult(history, userMsg, finalText, memUpdated);
}

function buildResult(history, userMsg, finalText, memUpdated) {
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
// MAIN
// ================================================================
async function main() {
  log('info', 'agent', `Starting — uid=${UID?.slice(0,8)} conv=${CONV_ID}`);

  const systemMd = readSkill('system.md');
  if (!systemMd) { log('error', 'agent', 'skills/system.md not found'); process.exit(1); }

  await updateConv(UID, CONV_ID, { status: 'thinking' });

  const conv = await getConv(UID, CONV_ID);
  if (!conv) { log('error', 'agent', 'Conversation not found'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  await updateConv(UID, CONV_ID, { status: 'running' });

  const { finalText, updatedHistory, memUpdated } = await psrLoop(
    UID, CONV_ID, userMsg, history, systemMd,
  );

  await saveConv(UID, CONV_ID, {
    status:         'done',
    final_response: finalText,
    history:        updatedHistory,
    finished_at:    new Date().toISOString(),
  });

  log('ok', 'agent', `Done — memUpdated=${memUpdated} history=${updatedHistory.length}`);
}

main().catch(async (e) => {
  log('error', 'agent', 'Fatal', { error: e.message });
  try {
    await saveConv(UID, CONV_ID, {
      status: 'error', error: e.message, finished_at: new Date().toISOString(),
    });
  } catch {}
  process.exit(1);
});
