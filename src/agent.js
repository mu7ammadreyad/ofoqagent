// agent.js — OFOQ Agent v6.0
// العقل المدبر — ReAct + Plan-and-Solve + Reflexion
// memory.js مدمج هنا عبر tools.js

import {
  log, sleep, readMd,
  loadMemory, saveMemory, patchMemSection, getMemVal,
  loadMdDoc, saveMdDoc,
  saveConv, updateConv, getConv,
  appendFirestoreArray,
  executeShell,
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
// صيغتان فقط:
//
//   <action type="shell">
//   bash commands here
//   </action>
//
//   <action type="memory" section="CONFIG">
//   github_token: ghp_xxx
//   github_status: verified
//   </action>
//
// النص خارج الـ actions = تفكير / رد نهائي
// ================================================================

function parseActions(text) {
  const actions = [];
  // استخرج كل <action ...>...</action> مرتبة حسب الظهور
  const re = /<action\s+([^>]*)>([\s\S]*?)<\/action>/gi;
  let   m;
  while ((m = re.exec(text)) !== null) {
    const attrsStr = m[1];
    const body     = m[2].trim();

    // parse attributes: type="shell" section="CONFIG"
    const attrs = {};
    const attrRe = /(\w+)=["']([^"']*)["']/g;
    let   am;
    while ((am = attrRe.exec(attrsStr)) !== null) attrs[am[1]] = am[2];

    const type = attrs.type || 'unknown';
    if (type === 'shell')  actions.push({ type: 'shell',  script: body,              raw: m[0] });
    if (type === 'memory') actions.push({ type: 'memory', section: attrs.section || 'CONFIG', content: body, raw: m[0] });
  }
  return actions;
}

// كل شيء خارج action tags = thinking + final text
function extractNonActionText(text) {
  return text.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '').trim();
}

// ================================================================
// SECTION 2 — MEMORY ACTION HANDLER
// يُطبَّق مباشرة في Firestore — بدون shell ولا أي تعقيد
// ================================================================
async function applyMemoryAction(uid, currentMemory, section, content) {
  const newMemory = patchMemSection(currentMemory, section, content);
  await saveMemory(uid, newMemory);
  log('ok', 'agent', `Memory saved — section: [${section}]`);
  return newMemory;
}

// ================================================================
// SECTION 3 — THINKING PASS (SSE بدون tools → thinkingConfig يعمل)
// ================================================================

async function streamThinking(userMsg, soul, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  const body = {
    contents:          [{ role: 'user', parts: [{ text: `فكّر باختصار: ${userMsg.slice(0, 300)}` }] }],
    systemInstruction: { parts: [{ text: soul.slice(0, 1000) }] },
    generationConfig:  {
      temperature:    0.5,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingBudget: 400 },
      // NO tools → thinkingConfig يعمل تماماً
    },
  };

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
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
// SECTION 4 — MODEL CALL
// retry مع exponential backoff لحل مشكلة "fetch failed"
// ================================================================

async function callModel(messages, systemInstruction, attempt = 0) {
  // أول محاولة Gemini، بعدها Gemma، بعدها Gemini مرة ثانية
  const useGemma = attempt === 1;
  const model    = useGemma ? 'gemma-4-26b-a4b-it' : 'gemma-4-26b-a4b-it';
  const apiKey   = useGemma ? GEMMA_KEY : GEMINI_KEY;
  const url      = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const clean = messages
    .map(m => ({ role: m.role, parts: (m.parts || []).filter(p => !p.thought) }))
    .filter(m => m.parts.length);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500_000);

  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents:          clean,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig:  { temperature: 0.3, maxOutputTokens: 2048 },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    // fetch failed / network error → retry
    if (attempt < 3) {
      const wait = [500, 2000, 5000][attempt] || 5000;
      log('warn', 'agent', `fetch failed (attempt ${attempt+1}) → retry in ${wait}ms`, { error: e.message });
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`AI unreachable after 3 attempts: ${e.message}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && attempt < 3) {
      const wait = [1000, 3000, 6000][attempt] || 6000;
      log('warn', 'agent', `HTTP ${resp.status} → retry in ${wait}ms`);
      await sleep(wait);
      return callModel(messages, systemInstruction, attempt + 1);
    }
    throw new Error(`${model} ${resp.status}: ${JSON.stringify(err).slice(0, 100)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// SECTION 5 — SYSTEM INSTRUCTION BUILDER
// يدمج soul.md + tools.md (helper functions فقط) + memory.md الحالي
// ================================================================

function buildSystemInstruction(soul, toolsMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return [
    soul,
    '\n\n---\n## أمثلة Shell (من tools.md)\n',
    toolsMd,
    '\n\n---\n## الذاكرة الحالية (memory.md)\n```\n',
    currentMemory,
    '\n```',
    `\n\n**الوقت:** ${now}`,
  ].join('');
}

// ================================================================
// SECTION 6 — REACT LOOP
// ================================================================
async function reactLoop(uid, convId, userMsg, history, soul, toolsMd) {
  let currentMemory = await loadMemory(uid);

  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText  = '';
  let memUpdated = false;

  for (let round = 0; round < 8; round++) {
    log('info', 'agent', `ReAct round ${round + 1}/8`);

    const sysInst = buildSystemInstruction(soul, toolsMd, currentMemory);
    const raw     = await callModel(messages, sysInst);
    log('info', 'agent', `Model (${raw.length}ch)`, { preview: raw.slice(0, 70) });

    const actions  = parseActions(raw);
    const textOnly = extractNonActionText(raw);

    // إرسال التفكير النصي (خارج الـ actions) للمستخدم
    if (textOnly) {
      await appendFirestoreArray(uid, convId, 'thinking_chunks', textOnly);
      log('info', 'agent', `[think] ${textOnly.slice(0, 60)}`);
    }

    // لا actions → رد نهائي
    if (!actions.length) {
      finalText = raw.trim();
      messages.push({ role: 'model', parts: [{ text: finalText }] });
      break;
    }

    // تنفيذ الـ actions بالترتيب
    const resultParts = [];

    for (const action of actions) {

      // ── shell action ──────────────────────────────────────────
      if (action.type === 'shell') {
        log('info', 'agent', `[shell] ${action.script.slice(0, 60)}`);
        await appendFirestoreArray(uid, convId, 'tool_updates', '⚙️ تنفيذ shell...');

        const result = await executeShell(action.script);

        if (result.success) {
          await appendFirestoreArray(uid, convId, 'tool_updates', '✅ shell نجح');
        } else {
          await appendFirestoreArray(uid, convId, 'tool_updates', `❌ shell: ${result.error?.slice(0, 60)}`);
        }

        resultParts.push({
          action:    'shell',
          success:   result.success,
          stdout:    result.stdout,
          stderr:    result.stderr,
          exit_code: result.exit_code,
          error:     result.error,
        });
      }

      // ── memory action ─────────────────────────────────────────
      else if (action.type === 'memory') {
        log('info', 'agent', `[memory] section=${action.section}`);
        await appendFirestoreArray(uid, convId, 'tool_updates', `💾 حفظ [${action.section}]...`);

        try {
          currentMemory = await applyMemoryAction(uid, currentMemory, action.section, action.content);
          memUpdated    = true;
          await appendFirestoreArray(uid, convId, 'tool_updates', `✅ تم حفظ [${action.section}]`);
          resultParts.push({ action: 'memory', section: action.section, success: true });
        } catch (e) {
          await appendFirestoreArray(uid, convId, 'tool_updates', `❌ فشل الحفظ: ${e.message.slice(0,60)}`);
          resultParts.push({ action: 'memory', section: action.section, success: false, error: e.message });
        }
      }
    }

    // أضف النتائج للـ history وتابع
    messages.push({ role: 'model', parts: [{ text: raw }] });
    messages.push({
      role:  'user',
      parts: [{ text: `نتائج التنفيذ:\n${JSON.stringify(resultParts, null, 2)}\n\nالذاكرة الحالية محدَّثة.\nأكمل ردك للمستخدم بالعربية بإيجاز. لا تكرر tokens أو بيانات حساسة.` }],
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
// SECTION 7 — MAIN
// ================================================================

async function main() {
  log('info', 'agent', `Starting — uid=${UID?.slice(0,8)} conv=${CONV_ID}`);

  await updateConv(UID, CONV_ID, { status: 'running' });

  const conv = await getConv(UID, CONV_ID);
  if (!conv) { log('error','agent','Conversation not found'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // تحميل MD files من Firestore per-uid
  // أول مرة: يُنسَخ من الملف المحلي ويُحفَظ في Firestore
  // المستخدم يستطيع تعديلها لاحقاً عبر الـ AI
  const [soul, toolsMd] = await Promise.all([
    loadMdDoc(UID, 'soul'),
    loadMdDoc(UID, 'tools'),
  ]);

  if (!soul) { log('error','agent','soul.md not found — check md/ folder'); process.exit(1); }

  // Thinking pass
  await updateConv(UID, CONV_ID, { status: 'thinking' });
  await streamThinking(userMsg, soul, async (chunk) => {
    await appendFirestoreArray(UID, CONV_ID, 'thinking_chunks', chunk);
  });

  // ReAct loop
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

  log('ok', 'agent', `Done — memUpdated=${memUpdated}`);
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
