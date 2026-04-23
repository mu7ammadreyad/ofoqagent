// agent.js — OFOQ Agent v6.0
// العقل المدبر — ReAct + Plan-and-Solve + Reflexion
//
// Actions المدعومة:
//   <action type="shell">bash script</action>
//   <action type="update_memory">memory.md كامل</action>
//
// Memory: يُحمَّل مع كل رسالة بغض النظر عن الـ conversation
// Conversations: history كامل في Firestore per-user per-conversation

import {
  log, sleep, readSkill,
  loadMemory, saveMemory, getMemVal,
  createConv, getConv, updateConv, saveConv, appendToConv,
  executeShell,
  createSchedule, getSchedules, deactivateSchedule, parseCronNext,
} from './tools.js';

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
function buildSystemInstruction(soul, toolsMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return [
    soul,
    '\n\n---\n## Shell Examples (skills/tools.md)\n',
    toolsMd,
    '\n\n---\n## ذاكرتك الحالية (memory.md)\n```\n',
    currentMemory,
    '\n```',
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

    // أعد بناء sysInstruction في كل round مع أحدث memory
    const sysInst = buildSystemInstruction(soul, toolsMd, currentMemory);
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

      // ── create_schedule ──────────────────────────────────────────
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
async function main() {
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
}

main().catch(async (e) => {
  log('error', 'agent', 'Fatal error', { error: e.message });
  try {
    await saveConv(UID, CONV_ID, {
      status:      'error',
      error:       e.message,
      finished_at: new Date().toISOString(),
    });
  } catch {}
  process.exit(1);
});
