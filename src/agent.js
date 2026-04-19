// ================================================================
//  agent.js — OFOQ Agent v6.0
//  بسم الله الرحمن الرحيم
//
//  العقل المدبر الكامل:
//  ┌──────────────────────────────────────────────────┐
//  │  ReAct + Plan-and-Solve + Reflexion               │
//  │  memory.js   مدمج هنا                            │
//  │  helpers.js  مدمج في tools.js                    │
//  │  publishers/ محذوف — AI يكتب الكود               │
//  │                                                  │
//  │  الذاكرة: memory.md نص واحد في Firestore          │
//  │  يُرسَل كـ context مع كل رسالة                    │
//  │  AI يُحدّثه عبر exec blocks                      │
//  └──────────────────────────────────────────────────┘
// ================================================================

import {
  log, sleep, readMd,
  loadMemory, saveMemory, patchMemSection, getMemVal,
  saveConv, updateConv, getConv,
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
// الـ AI يكتب نصاً فيه <action type="exec">كود</action>
// نحن نستخرجه وننفذه — بسيط وموثوق مع أي موديل
// ================================================================

function parseExecAction(text) {
  const re = /<action\s+type=["']exec["'][^>]*>([\s\S]*?)<\/action>/i;
  const m  = text.match(re);
  if (!m) return null;
  return {
    code: m[1].trim(),
    raw:  m[0],
  };
}

// استخرج النص قبل وبعد الـ action
function splitByAction(text) {
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
// SECTION 2 — THINKING PASS (SSE, بدون tools → thinkingConfig يعمل)
// ================================================================
async function streamThinking(userMsg, soul, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  const body = {
    contents:          [{ role: 'user', parts: [{ text: `فكّر باختصار: ${userMsg.slice(0, 300)}` }] }],
    systemInstruction: { parts: [{ text: soul.slice(0, 1500) }] },
    generationConfig:  { temperature: 0.5, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 400 } },
  };
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    log('warn', 'agent', 'thinking SSE failed (non-fatal)', { error: e.message });
  }
}

// ================================================================
// SECTION 3 — MAIN MODEL CALL (لا tools parameter → لا thought_signature)
// ================================================================
async function callModel(messages, systemInstruction, useGemma = false) {
  const model  = useGemma ? 'gemma-4-26b-a4b-it' : 'gemma-4-26b-a4b-it';
  const apiKey = useGemma ? GEMMA_KEY : GEMINI_KEY;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // حذف thought parts من الـ history (لا thought_signature error)
  const clean = messages.map(m => ({
    role:  m.role,
    parts: (m.parts || []).filter(p => !p.thought),
  })).filter(m => m.parts.length);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:          clean,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig:  { temperature: 0.3, maxOutputTokens: 2048 },
        // لا tools → لا thought_signature → يشتغل تماماً
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('AI timeout (30s)');
    if (!useGemma) { log('warn', 'agent', 'Gemini error → Gemma', { e: e.message }); return callModel(messages, systemInstruction, true); }
    throw e;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && !useGemma) {
      await sleep(500);
      return callModel(messages, systemInstruction, true);
    }
    throw new Error(`${useGemma ? 'Gemma' : 'Gemini'} ${resp.status}: ${JSON.stringify(err).slice(0, 100)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// SECTION 4 — SYSTEM INSTRUCTION BUILDER
// يدمج soul.md + tools.md + memory.md الحالي في prompt واحد
// ================================================================
function buildSystemInstruction(soul, toolsMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return [
    soul,
    '\n\n---\n## Helper Functions المتاحة في exec\n',
    'انسخ الدوال التالية واستخدمها في exec blocks:\n',
    // استخرج code blocks فقط من tools.md
    extractToolFunctions(toolsMd),
    '\n\n---\n## الذاكرة الحالية (memory.md)\n',
    '```\n', currentMemory, '\n```',
    `\n\n**الوقت الحالي:** ${now}`,
  ].join('');
}

function extractToolFunctions(toolsMd) {
  // استخرج عناوين الدوال فقط (بدون تفاصيل) لتوفير tokens
  const lines = toolsMd.split('\n');
  const out   = [];
  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('```js') || line.startsWith('// مثال') || line.startsWith('// ')) {
      out.push(line);
    } else if (line.startsWith('```') && out[out.length - 1]?.startsWith('```js')) {
      out.push(line); // closing ```
    }
  }
  return out.join('\n');
}

// ================================================================
// SECTION 5 — REACT LOOP
// دورة ReAct + Plan-and-Solve + Reflexion
// ================================================================
async function reactLoop(uid, convId, userMsg, history, soul, toolsMd) {
  // تحميل memory.md الحالي
  let currentMemory = await loadMemory(uid);

  // بناء الـ messages
  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText  = '';
  let memUpdated = false;

  for (let round = 0; round < 8; round++) {
    log('info', 'agent', `ReAct round ${round + 1}`);

    // بناء system instruction مع memory الحالي
    const sysInstruction = buildSystemInstruction(soul, toolsMd, currentMemory);

    // استدعاء الموديل
    const raw = await callModel(messages, sysInstruction);
    log('info', 'agent', `Model output (${raw.length}ch)`, { preview: raw.slice(0, 80) });

    // هل فيه exec action؟
    const action = parseExecAction(raw);
    const parts  = splitByAction(raw);

    // اعرض الـ thinking النصي (قبل الـ action) كـ update
    if (parts.before) {
      await appendUpdate(uid, convId, `🤔 ${parts.before.slice(0, 150)}`);
    }

    if (!action) {
      // لا exec → هذا هو الرد النهائي
      finalText = raw.trim();
      messages.push({ role: 'model', parts: [{ text: finalText }] });
      break;
    }

    // ── تنفيذ الكود ────────────────────────────────────────────
    log('info', 'agent', `Executing code (${action.code.length}ch)`);
    await appendUpdate(uid, convId, '⚙️ تنفيذ الكود...');

    const execResult = await executeCode(uid, action.code, currentMemory);

    if (execResult.success) {
      await appendUpdate(uid, convId, '✅ نجح التنفيذ');

      // هل تضمّن الكود تحديث memory؟ أعد تحميلها
      const newMemory = await loadMemory(uid);
      if (newMemory !== currentMemory) {
        currentMemory = newMemory;
        memUpdated    = true;
        log('ok', 'agent', 'Memory updated after exec');
      }
    } else {
      await appendUpdate(uid, convId, `❌ فشل: ${execResult.error?.slice(0, 80)}`);
    }

    // أضف الرد + النتيجة للـ history
    messages.push({ role: 'model',  parts: [{ text: raw }] });
    messages.push({
      role:  'user',
      parts: [{ text: `نتيجة التنفيذ:\n${JSON.stringify(execResult, null, 2)}\n\nأكمل ردك للمستخدم بالعربية.` }],
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

// ── appendUpdate helper (بدون firebase FieldValue) ───────────────
async function appendUpdate(uid, convId, text) {
  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const { FieldValue }   = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      tool_updates: FieldValue.arrayUnion(text),
    });
  } catch (e) {
    log('warn', 'agent', 'appendUpdate failed', { error: e.message });
  }
}

async function appendThinking(uid, convId, chunk) {
  try {
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = getFirestore();
    await db.doc(`users/${uid}/conversations/${convId}`).update({
      thinking_chunks: FieldValue.arrayUnion(chunk),
      status:          'thinking',
    });
  } catch (e) {
    log('warn', 'agent', 'appendThinking failed', { error: e.message });
  }
}

// ================================================================
// SECTION 6 — MAIN
// ================================================================
async function main() {
  log('info', 'agent', `Starting — uid=${UID} convId=${CONV_ID}`);

  // 1. Load md files
  const soul    = readMd('soul.md');
  const toolsMd = readMd('tools.md');

  if (!soul)    { log('error', 'agent', 'soul.md not found');  process.exit(1); }
  if (!toolsMd) { log('warn',  'agent', 'tools.md not found — continuing without helpers'); }

  // 2. Mark conversation as running
  await updateConv(UID, CONV_ID, { status: 'running' });

  // 3. Load conversation
  const conv = await getConv(UID, CONV_ID);
  if (!conv) { log('error', 'agent', 'Conversation not found'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // 4. Thinking pass (SSE → Firestore real-time)
  await updateConv(UID, CONV_ID, { status: 'thinking' });
  await streamThinking(userMsg, soul, async (chunk) => {
    await appendThinking(UID, CONV_ID, chunk);
  });

  // 5. ReAct loop
  await updateConv(UID, CONV_ID, { status: 'running' });
  const { finalText, updatedHistory, memUpdated } = await reactLoop(
    UID, CONV_ID, userMsg, history, soul, toolsMd,
  );

  // 6. Finish
  await saveConv(UID, CONV_ID, {
    status:         'done',
    final_response: finalText,
    history:        updatedHistory,
    finished_at:    new Date().toISOString(),
  });

  log('ok', 'agent', `Done — conv=${CONV_ID} memUpdated=${memUpdated}`);
}

main().catch(async (e) => {
  log('error', 'agent', 'Fatal error', { error: e.message });
  try {
    await saveConv(UID, CONV_ID, { status: 'error', error: e.message, finished_at: new Date().toISOString() });
  } catch {}
  process.exit(1);
});
