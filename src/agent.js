// agent.js — OFOQ Agent v6.1
// عميل ذكاء اصطناعي متكامل — يفعل أي شيء
// Actions: shell | update_memory | schedule_task

import {
  log, sleep, readSkill,
  loadMemory, saveMemory,
  getConv, updateConv, saveConv, appendToConv,
  executeShell, createScheduledTask, toggleScheduledTask,
} from './tools.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const UID        = process.env.CONV_UID;
const CONV_ID    = process.env.CONV_ID;

if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY missing'); process.exit(1); }
if (!UID)        { console.error('❌ CONV_UID missing');        process.exit(1); }
if (!CONV_ID)    { console.error('❌ CONV_ID missing');         process.exit(1); }

// ================================================================
// SECTION 1 — ACTION PARSER
// يدعم: shell | update_memory | schedule_task
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

    if (type === 'shell')         actions.push({ type: 'shell',         script:  body });
    if (type === 'update_memory') actions.push({ type: 'update_memory', content: body });
    if (type === 'schedule_task') {
      try {
        const config = JSON.parse(body);
        actions.push({ type: 'schedule_task', config });
      } catch (e) {
        actions.push({ type: 'schedule_task', config: null, parseError: e.message });
      }
    }
    if (type === 'cancel_task') actions.push({ type: 'cancel_task', task_id: attrs.task_id || body.trim() });
  }
  return actions;
}

function extractText(text) {
  return text.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '').trim();
}

// ================================================================
// SECTION 2 — THINKING PASS
// ================================================================
async function streamThinking(userMsg, soul, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `فكّر باختصار: ${userMsg.slice(0, 400)}` }] }],
        systemInstruction: { parts: [{ text: soul.slice(0, 1500) }] },
        generationConfig: { temperature: 0.5, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 500 } },
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
  } catch (e) { log('warn', 'agent', 'thinking pass failed', { error: e.message }); }
}

// ================================================================
// SECTION 3 — MODEL CALL (بدون timeout)
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
        generationConfig: { temperature: 0.35, maxOutputTokens: 4096, topP: 0.95 },
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
// SECTION 4 — SYSTEM INSTRUCTION BUILDER
// ================================================================
function buildSystemInstruction(soul, toolsMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return [
    soul,
    '\n\n---\n## مرجع الأدوات (skills/tools.md)\n',
    toolsMd,
    '\n\n---\n## ذاكرتك الحالية (memory.md)\n```\n',
    currentMemory,
    '\n```',
    `\n\n**الوقت الحالي:** ${now}`,
    '\n\n**تعليمات:**',
    '\n- استخدم actions مباشرة بدون شرح مطوّل',
    '\n- بعد كل shell — قرّر الخطوة التالية بناءً على النتيجة',
    '\n- الردود النهائية بالعربية المصرية البسيطة',
    '\n- لا تكرر البيانات الحساسة في الرد النهائي',
  ].join('');
}

// ================================================================
// SECTION 5 — REACT LOOP (15 جولة كحد أقصى)
// ================================================================
async function reactLoop(uid, convId, userMsg, history, soul, toolsMd) {
  let currentMemory = await loadMemory(uid);
  let memUpdated    = false;

  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText = '';

  for (let round = 0; round < 15; round++) {
    log('info', 'agent', `ReAct round ${round + 1}/15`);

    const sysInst = buildSystemInstruction(soul, toolsMd, currentMemory);
    const raw     = await callModel(messages, sysInst);
    log('info', 'agent', `Model (${raw.length}ch)`, { preview: raw.slice(0, 80) });

    const actions  = parseActions(raw);
    const textOnly = extractText(raw);

    if (textOnly) {
      await appendToConv(uid, convId, 'thinking_chunks', textOnly);
    }

    if (!actions.length) {
      finalText = raw.trim();
      messages.push({ role: 'model', parts: [{ text: finalText }] });
      break;
    }

    const resultParts = [];

    for (const action of actions) {

      // ── shell ────────────────────────────────────────────────
      if (action.type === 'shell') {
        log('info', 'agent', `[shell] executing`);
        await appendToConv(uid, convId, 'tool_updates', '⚙️ جارٍ التنفيذ...');
        const result = await executeShell(action.script);
        const label  = result.success
          ? `✅ ${result.stdout?.slice(0, 100) || 'تم'}`
          : `❌ ${result.error?.slice(0, 100)}`;
        await appendToConv(uid, convId, 'tool_updates', label);
        resultParts.push({
          type: 'shell', success: result.success,
          stdout: result.stdout?.slice(0, 4000),
          stderr: result.stderr?.slice(0, 800),
          error: result.error, exit_code: result.exit_code,
        });
      }

      // ── update_memory ────────────────────────────────────────
      else if (action.type === 'update_memory') {
        log('info', 'agent', `[update_memory] ${action.content.length}ch`);
        await appendToConv(uid, convId, 'tool_updates', '💾 تحديث الذاكرة...');
        try {
          await saveMemory(uid, action.content);
          currentMemory = action.content;
          memUpdated    = true;
          await appendToConv(uid, convId, 'tool_updates', '✅ تم حفظ memory.md');
          resultParts.push({ type: 'update_memory', success: true, size: action.content.length });
        } catch (e) {
          await appendToConv(uid, convId, 'tool_updates', `❌ فشل الحفظ: ${e.message.slice(0, 60)}`);
          resultParts.push({ type: 'update_memory', success: false, error: e.message });
        }
      }

      // ── schedule_task ─────────────────────────────────────────
      else if (action.type === 'schedule_task') {
        if (action.parseError) {
          await appendToConv(uid, convId, 'tool_updates', `❌ JSON غير صالح: ${action.parseError}`);
          resultParts.push({ type: 'schedule_task', success: false, error: `JSON parse error: ${action.parseError}` });
          continue;
        }
        log('info', 'agent', `[schedule_task] "${action.config.title}"`);
        await appendToConv(uid, convId, 'tool_updates', `📅 إنشاء مهمة: "${action.config.title}"...`);
        try {
          const result = await createScheduledTask(uid, action.config);
          await appendToConv(uid, convId, 'tool_updates', `✅ جُدولت: "${action.config.title}" — التالية: ${result.nextRun}`);
          resultParts.push({ type: 'schedule_task', success: true, ...result, title: action.config.title });
        } catch (e) {
          await appendToConv(uid, convId, 'tool_updates', `❌ فشل الجدولة: ${e.message.slice(0, 60)}`);
          resultParts.push({ type: 'schedule_task', success: false, error: e.message });
        }
      }

      // ── cancel_task ───────────────────────────────────────────
      else if (action.type === 'cancel_task') {
        log('info', 'agent', `[cancel_task] ${action.task_id}`);
        await appendToConv(uid, convId, 'tool_updates', `🛑 إيقاف المهمة ${action.task_id}...`);
        try {
          await toggleScheduledTask(uid, action.task_id, false);
          await appendToConv(uid, convId, 'tool_updates', `✅ تم إيقاف المهمة`);
          resultParts.push({ type: 'cancel_task', success: true, task_id: action.task_id });
        } catch (e) {
          resultParts.push({ type: 'cancel_task', success: false, error: e.message });
        }
      }
    }

    messages.push({ role: 'model', parts: [{ text: raw }] });
    messages.push({
      role:  'user',
      parts: [{ text: `نتائج:\n${JSON.stringify(resultParts, null, 2)}\n\nإذا اكتملت المهمة → اكتب الرد النهائي بدون action. إذا تبقى خطوات → نفّذها.` }],
    });
  }

  if (!finalText) finalText = '⚠️ وصلت للحد الأقصى من الجولات — راجع tool_updates لتفاصيل ما تم.';

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

  const soul    = readSkill('soul.md');
  const toolsMd = readSkill('tools.md');
  if (!soul) { log('error', 'agent', 'skills/soul.md not found'); process.exit(1); }

  await updateConv(UID, CONV_ID, { status: 'running' });

  const conv = await getConv(UID, CONV_ID);
  if (!conv) { log('error', 'agent', 'Conversation not found in Firestore'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // Thinking pass
  await updateConv(UID, CONV_ID, { status: 'thinking' });
  await streamThinking(userMsg, soul, async (chunk) => {
    await appendToConv(UID, CONV_ID, 'thinking_chunks', chunk);
  });

  await updateConv(UID, CONV_ID, { status: 'running' });
  const { finalText, updatedHistory, memUpdated } = await reactLoop(
    UID, CONV_ID, userMsg, history, soul, toolsMd,
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
  try { await saveConv(UID, CONV_ID, { status: 'error', error: e.message, finished_at: new Date().toISOString() }); } catch {}
  process.exit(1);
});
