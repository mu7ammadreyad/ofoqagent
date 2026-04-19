// agent.js — OFOQ Agent v6.0
// العقل المدبر — ReAct + Plan-and-Solve + Reflexion
// memory.js مدمج هنا عبر tools.js

import {
  log, sleep, readMd,
  loadMemory, saveMemory, patchMemSection, getMemVal,
  loadMdDoc, saveMdDoc,
  saveConv, updateConv, getConv,
  appendFirestoreArray,
  executeCode,
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
// ── يستخرج <action type="exec" lang="js|py">...</action> ──
// ================================================================

function parseAction(text) {
  const re = /<action\s+type=["']exec["'][^>]*>([\s\S]*?)<\/action>/i;
  const m  = text.match(re);
  if (!m) return null;

  // استخرج lang attribute
  const langM = text.match(/<action[^>]+lang=["'](\w+)["']/i);
  const lang  = langM ? langM[1].toLowerCase() : 'js';

  return { code: m[1].trim(), lang, raw: m[0] };
}

function splitAroundAction(text) {
  const re = /<action\s+type=["']exec["'][^>]*>[\s\S]*?<\/action>/i;
  const m  = text.match(re);
  if (!m) return { before: text.trim(), after: '' };
  const idx = text.indexOf(m[0]);
  return {
    before: text.slice(0, idx).trim(),
    after:  text.slice(idx + m[0].length).trim(),
  };
}

// ================================================================
// SECTION 2 — MEMORY UPDATE HANDLER
// exec code يُعيد { __mem_update__: { section, content } }
// agent.js هو من يكتب في Firestore — لا firebase-admin في الـ sandbox
// ================================================================

async function handleMemUpdate(uid, currentMemory, execResult) {
  if (!execResult?.success || !execResult?.result?.__mem_update__) {
    return { changed: false, memory: currentMemory };
  }

  const { section, content } = execResult.result.__mem_update__;
  if (!section || content === undefined) {
    return { changed: false, memory: currentMemory };
  }

  const newMemory = patchMemSection(currentMemory, section, content);
  await saveMemory(uid, newMemory);
  log('ok', 'agent', `Memory updated — section: ${section}`);
  return { changed: true, memory: newMemory };
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
// SECTION 4 — MODEL CALL (NO tools param → NO thought_signature)
// ================================================================

async function callModel(messages, systemInstruction, useGemma = false) {
  const model  = useGemma ? 'gemma-4-26b-a4b-it' : 'gemma-4-26b-a4b-it';
  const apiKey = useGemma ? GEMMA_KEY : GEMINI_KEY;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // احذف thought parts من الـ history — يمنع thought_signature error
  const clean = messages
    .map(m => ({ role: m.role, parts: (m.parts || []).filter(p => !p.thought) }))
    .filter(m => m.parts.length);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000_000);

  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:          clean,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig:  { temperature: 0.3, maxOutputTokens: 2048 },
        // لا tools → لا thought_signature error
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('AI timeout (30s)');
    if (!useGemma) { log('warn','agent','Gemini error→Gemma',{e:e.message}); return callModel(messages, systemInstruction, true); }
    throw e;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && !useGemma) {
      await sleep(500);
      return callModel(messages, systemInstruction, true);
    }
    throw new Error(`${useGemma?'Gemma':'Gemini'} ${resp.status}: ${JSON.stringify(err).slice(0,100)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// SECTION 5 — SYSTEM INSTRUCTION BUILDER
// يدمج soul.md + tools.md (helper functions فقط) + memory.md الحالي
// ================================================================

function buildSystemInstruction(soul, toolsMd, currentMemory) {
  const now     = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  // استخرج الـ JS code blocks من tools.md لحقنها كـ reference
  const codeRef = extractCodeHeaders(toolsMd);

  return [
    soul,
    '\n\n---\n## الدوال المتاحة في exec (من tools.md)\n',
    codeRef,
    '\n\n---\n## الذاكرة الحالية (memory.md)\n```\n',
    currentMemory,
    '\n```',
    `\n\n**الوقت:** ${now}`,
  ].join('');
}

// استخرج عناوين الدوال فقط (توفيراً للـ tokens)
function extractCodeHeaders(toolsMd) {
  const lines = toolsMd.split('\n');
  const out   = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith('## '))          { out.push(line); inBlock = false; }
    else if (line.startsWith('```js'))   { inBlock = true; out.push(line); }
    else if (line.startsWith('```') && inBlock) { inBlock = false; out.push(line); }
    else if (inBlock && line.startsWith('function ')) out.push(line); // signature only
    else if (inBlock && line.startsWith('const ') && line.includes('=>')) out.push(line);
    else if (inBlock && line.startsWith('async function ')) out.push(line);
  }
  return out.join('\n');
}

// ================================================================
// SECTION 6 — REACT LOOP
// دورة ReAct + Plan-and-Solve + Reflexion
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

    // أعد بناء system instruction مع memory الحالي في كل round
    const sysInst = buildSystemInstruction(soul, toolsMd, currentMemory);
    const raw     = await callModel(messages, sysInst);
    log('info', 'agent', `Model (${raw.length}ch)`, { preview: raw.slice(0, 70) });

    const action = parseAction(raw);
    const parts  = splitAroundAction(raw);

    // النص قبل الـ action → thinking visible للمستخدم
    if (parts.before) {
      await appendFirestoreArray(uid, convId, 'thinking_chunks', parts.before);
      log('info', 'agent', `[think] ${parts.before.slice(0, 60)}`);
    }

    if (!action) {
      // لا exec → رد نهائي
      finalText = raw.trim();
      messages.push({ role: 'model', parts: [{ text: finalText }] });
      break;
    }

    // ── تنفيذ الكود ──────────────────────────────────────────────
    log('info', 'agent', `[exec:${action.lang}] ${action.code.length}ch`);
    await appendFirestoreArray(uid, convId, 'tool_updates', `⚙️ تنفيذ كود ${action.lang}...`);

    const execResult = await executeCode(uid, action.code, currentMemory, action.lang);

    if (execResult.success) {
      await appendFirestoreArray(uid, convId, 'tool_updates', '✅ نجح التنفيذ');

      // FIX: تحقق من __mem_update__ في النتيجة وحدّث memory
      const memResult = await handleMemUpdate(uid, currentMemory, execResult);
      if (memResult.changed) {
        currentMemory = memResult.memory;
        memUpdated    = true;
        await appendFirestoreArray(uid, convId, 'tool_updates', '💾 تم تحديث الذاكرة');
      }
    } else {
      const errMsg = execResult.error?.slice(0, 100) || 'خطأ غير معروف';
      await appendFirestoreArray(uid, convId, 'tool_updates', `❌ فشل: ${errMsg}`);
      log('warn', 'agent', `exec failed: ${errMsg}`);
    }

    // أضف الرد + النتيجة للـ history
    messages.push({ role: 'model', parts: [{ text: raw }] });

    // أرسل النتيجة للموديل بدون tokens حساسة
    const safeResult = JSON.parse(JSON.stringify(execResult));
    if (safeResult?.result?.__mem_update__) {
      // لا ترسل المحتوى الكامل للموديل — فقط التأكيد
      safeResult.result.__mem_update__ = { status: 'saved', section: safeResult.result.__mem_update__.section };
    }

    messages.push({
      role:  'user',
      parts: [{ text: `نتيجة التنفيذ:\n${JSON.stringify(safeResult, null, 2)}\n\nأكمل ردك للمستخدم بالعربية. لا تكرر tokens أو بيانات حساسة.` }],
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
