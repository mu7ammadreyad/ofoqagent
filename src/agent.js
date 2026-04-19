// ================================================================
//  agent.js — OFOQ Agent v5.0
//  Custom ReAct Engine — بُني من الصفر
//
//  ┌─────────────────────────────────────────────────────────────┐
//  │  Custom Function Calling — بدون Gemini Native API           │
//  │                                                             │
//  │  الفكرة: بدل ما نمرر tools schema لـ Gemini ونعاني من       │
//  │  thought_signature، الموديل يكتب XML actions في نصه:        │
//  │                                                             │
//  │  <action type="think">تفكير...</action>                     │
//  │  <action type="tool" name="save_credentials">              │
//  │    {"platform":"github","data":{"token":"ghp_xxx"}}        │
//  │  </action>                                                  │
//  │  <action type="exec" lang="js">                            │
//  │    const r=await fetch(...); return r.json();               │
//  │  </action>                                                  │
//  │                                                             │
//  │  Parser يستخرج كل action ويُنفّذها بالترتيب.               │
//  │  النص خارج الـ actions = الرد النهائي.                      │
//  │                                                             │
//  │  المزايا:                                                   │
//  │  ✅ يشتغل مع Gemini / Gemma / GPT / Claude / أي موديل       │
//  │  ✅ لا thought_signature error                               │
//  │  ✅ Thinking native SSE في pass منفصل                        │
//  │  ✅ Code Execution حقيقي في Node.js                         │
//  │  ✅ قراءة الملفات المرفوعة من Firestore                      │
//  └─────────────────────────────────────────────────────────────┘
// ================================================================

import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { execSync }  from 'child_process';
import { tmpdir }    from 'os';
import { join }      from 'path';

import * as memory from './memory.js';
import { executeTool, TOOL_LABELS, TOOL_SYSTEM_PROMPT } from './tools.js';
import { readMarkdownFile, log, sleep, sanitizeForLog } from './helpers.js';

// ── Env ───────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMMA_KEY  = process.env.GEMMA_API_KEY || GEMINI_KEY;
const UID        = process.env.CONV_UID;
const CONV_ID    = process.env.CONV_ID;

if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY not set'); process.exit(1); }
if (!UID)        { console.error('❌ CONV_UID not set');        process.exit(1); }
if (!CONV_ID)    { console.error('❌ CONV_ID not set');         process.exit(1); }

// ================================================================
// ──────────────────────────────────────────────────────────────────
//  SECTION 1 — CUSTOM FC PARSER
//  يقرأ نص الموديل ويستخرج كل الـ actions بالترتيب
// ──────────────────────────────────────────────────────────────────
// ================================================================

/**
 * Parse all <action> blocks from model output.
 * Returns array of action objects in document order.
 *
 * Supported action types:
 *   think  → { type:'think',  text }
 *   tool   → { type:'tool',   name, args:{} }
 *   exec   → { type:'exec',   lang, code }
 *   final  → { type:'final',  text }   ← implicit: text outside all tags
 */
function parseActions(raw) {
  const actions = [];

  // Regex to find ALL <action ...>...</action> tags
  const tagRe = /<action\s+([^>]*)>([\s\S]*?)<\/action>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRe.exec(raw)) !== null) {
    // Collect text before this tag as a "final" candidate
    const before = raw.slice(lastIndex, match.index).trim();
    if (before) actions.push({ type: 'text_fragment', text: before });

    const attrsStr = match[1];
    const body     = match[2].trim();
    const attrs    = parseAttrs(attrsStr);
    const aType    = attrs.type || 'unknown';

    if (aType === 'think') {
      actions.push({ type: 'think', text: body });

    } else if (aType === 'tool') {
      const name = attrs.name || '';
      let args   = {};
      if (body) {
        try {
          args = JSON.parse(body);
        } catch {
          // Try to repair common issues
          try {
            args = JSON.parse(
              body
                .replace(/,\s*([}\]])/g, '$1')         // trailing commas
                .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":') // unquoted keys
                .replace(/:\s*'([^']*)'/g, ': "$1"')   // single→double values
            );
          } catch {
            log('warn', 'parser', `Could not parse tool args for ${name}`, { body: body.slice(0, 120) });
          }
        }
      }
      actions.push({ type: 'tool', name, args });

    } else if (aType === 'exec') {
      const lang = attrs.lang || 'js';
      actions.push({ type: 'exec', lang, code: body });

    } else {
      // Unknown type — treat body as text
      actions.push({ type: 'text_fragment', text: body });
    }

    lastIndex = tagRe.lastIndex;
  }

  // Collect remaining text after last tag
  const tail = raw.slice(lastIndex).trim();
  if (tail) actions.push({ type: 'text_fragment', text: tail });

  return actions;
}

/** Parse HTML-style attribute string into key-value object */
function parseAttrs(str) {
  const out = {};
  // Match: key="value" or key='value' or key=value
  const re = /(\w+)=["']?([^"'\s>]*)["']?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Extract clean final response: all text_fragments joined, no actions */
function extractFinal(actions) {
  return actions
    .filter(a => a.type === 'text_fragment')
    .map(a => a.text)
    .join('\n')
    .trim();
}

/** Check if any action in list requires further model invocation */
function hasContinuationAction(actions) {
  return actions.some(a => a.type === 'tool' || a.type === 'exec');
}

// ================================================================
// ──────────────────────────────────────────────────────────────────
//  SECTION 2 — CODE EXECUTOR
//  يشتغل في Node.js 20 داخل GitHub Actions
//  يكتب الكود في ملف مؤقت، يشغّله كـ subprocess، يرجع stdout
// ──────────────────────────────────────────────────────────────────
// ================================================================

async function executeCode(code, lang, convCtx) {
  const id      = `ofoq_exec_${CONV_ID.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`;
  const tmpPath = join(tmpdir(), `${id}.mjs`);

  // ── Build wrapper that exposes fetch, env, helpers ────────────
  const userConfig = await memory.getConfig(UID).catch(() => ({}));
  const configJson = JSON.stringify(sanitizeForLog(userConfig)); // no tokens in logs

  // Inject config (tokens available in code via __config__)
  const fullConfig = JSON.stringify(userConfig); // full — available in sandbox

  const wrapper = `
// OFOQ Code Execution Sandbox — Node.js ${process.version}
// globalThis.fetch available (Node 18+)
// globalThis.__config__ = user's Firestore config (github tokens etc.)

globalThis.__config__ = ${fullConfig};

// Capture return value from user code
let __result__ = undefined;

async function __run__() {
  ${code}
}

try {
  __result__ = await __run__();
  if (__result__ !== undefined) {
    console.log('__RESULT__:' + JSON.stringify(__result__));
  }
} catch (e) {
  console.error('__ERROR__:' + e.message);
  process.exit(1);
}
`;

  writeFileSync(tmpPath, wrapper, 'utf8');

  let stdout = '', stderr = '';
  try {
    stdout = execSync(`node --experimental-fetch "${tmpPath}"`, {
      timeout: 30_000,       // 30s max
      maxBuffer: 1024 * 512, // 512KB output
      encoding: 'utf8',
    });
  } catch (e) {
    stderr = e.message || String(e);
  } finally {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
  }

  // Parse result
  const resultLine = stdout.split('\n').find(l => l.startsWith('__RESULT__:'));
  const errorLine  = (stdout + stderr).split('\n').find(l => l.startsWith('__ERROR__:'));

  if (errorLine) {
    const errMsg = errorLine.replace('__ERROR__:', '').trim();
    return { success: false, error: errMsg, stdout: stdout.replace(/__RESULT__:.*/g, '').trim() };
  }

  let result = null;
  if (resultLine) {
    try { result = JSON.parse(resultLine.replace('__RESULT__:', '')); } catch { result = resultLine.replace('__RESULT__:', ''); }
  }

  const output = stdout.replace(/__RESULT__:.*/g, '').trim();
  return { success: true, result, stdout: output.slice(0, 3000) };
}

// ================================================================
// ──────────────────────────────────────────────────────────────────
//  SECTION 3 — GEMINI THINKING PASS
//  pass منفصل بدون tools → thinkingConfig يشتغل تماماً
//  لا thought_signature error لأن لا tools في الـ request
// ──────────────────────────────────────────────────────────────────
// ================================================================

async function streamThinking(messages, systemInstruction, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;

  const body = {
    contents:          messages.slice(-3), // last 3 messages for context
    systemInstruction: { parts: [{ text: systemInstruction.slice(0, 2000) }] },
    generationConfig:  {
      temperature:    0.5,
      maxOutputTokens: 600,
      thinkingConfig: { thinkingBudget: 400 },
      // ← NO tools → thinkingConfig works
    },
  };

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!resp.ok) return; // non-fatal

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
// ──────────────────────────────────────────────────────────────────
//  SECTION 4 — MAIN MODEL CALL
//  يُرسل الـ conversation للموديل ويستقبل الـ actions
//  لا tools parameter → لا thought_signature issues
// ──────────────────────────────────────────────────────────────────
// ================================================================

async function callModel(messages, systemInstruction, useGemma = false) {
  const modelId = useGemma ? 'gemma-3-27b-it' : 'gemini-2.5-flash-preview-04-17';
  const apiKey  = useGemma ? GEMMA_KEY : GEMINI_KEY;
  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  // Strip any thought parts from history (safety)
  const cleanMessages = messages.map(m => ({
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
      body: JSON.stringify({
        contents:          cleanMessages,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig:  {
          temperature:     0.3,
          maxOutputTokens: 2048,
          // NO tools, NO thinkingConfig → clean text output
        },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('AI timeout (30s) — جرب مرة أخرى');
    if (!useGemma) { log('warn', 'agent', 'Gemini error → Gemma', { error: e.message }); return callModel(messages, systemInstruction, true); }
    throw e;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if ((resp.status === 429 || resp.status === 503) && !useGemma) {
      log('warn', 'agent', `Gemini ${resp.status} → Gemma`);
      await sleep(400);
      return callModel(messages, systemInstruction, true);
    }
    throw new Error(`${useGemma ? 'Gemma' : 'Gemini'} ${resp.status}: ${JSON.stringify(err).slice(0, 120)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

// ================================================================
// ──────────────────────────────────────────────────────────────────
//  SECTION 5 — REACT LOOP
//  الدورة الكاملة: think → parse actions → execute → respond
// ──────────────────────────────────────────────────────────────────
// ================================================================

async function runReActLoop(uid, convId, userMsg, history, systemInstruction) {

  // Build conversation (Gemini format)
  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText = '';
  let round     = 0;
  const MAX_ROUNDS = 8;

  while (round < MAX_ROUNDS) {
    round++;
    log('info', 'agent', `ReAct round ${round}/${MAX_ROUNDS}`);

    // ── Call model ───────────────────────────────────────────────
    const rawResponse = await callModel(messages, systemInstruction);
    log('info', 'agent', `Model response (${rawResponse.length}ch)`, { preview: rawResponse.slice(0, 80) });

    // ── Parse actions ────────────────────────────────────────────
    const actions = parseActions(rawResponse);
    log('info', 'agent', `Parsed ${actions.length} actions`, { types: actions.map(a => a.type) });

    // Add model turn to history
    messages.push({ role: 'model', parts: [{ text: rawResponse }] });

    // ── Process actions ──────────────────────────────────────────
    const toolResults = [];
    let hasActions    = false;

    for (const action of actions) {

      // ① Think → write to Firestore thinking_chunks
      if (action.type === 'think') {
        await memory.appendThinking(uid, convId, action.text);
        log('info', 'agent', `[think] ${action.text.slice(0, 60)}`);
      }

      // ② Tool call → execute + collect result
      else if (action.type === 'tool') {
        hasActions = true;
        const label = TOOL_LABELS[action.name] || action.name;
        log('info', 'agent', `[tool] ${action.name}`, { args: sanitizeForLog(action.args) });
        await memory.appendUpdate(uid, convId, `${label}...`);

        const result = await executeTool(uid, action.name, action.args);
        const status = result.success ? `✅ ${label}` : `❌ ${label}: ${result.error}`;
        await memory.appendUpdate(uid, convId, status);

        toolResults.push({ tool: action.name, result });
      }

      // ③ Code execution → run in Node.js
      else if (action.type === 'exec') {
        hasActions = true;
        log('info', 'agent', `[exec] ${action.lang} (${action.code.length}ch)`);
        await memory.appendUpdate(uid, convId, `⚙️ تنفيذ كود ${action.lang}...`);

        const result = await executeCode(action.code, action.lang, { uid, convId });
        const status = result.success ? '✅ تنفيذ الكود نجح' : `❌ فشل التنفيذ: ${result.error}`;
        await memory.appendUpdate(uid, convId, status);

        toolResults.push({ tool: '__exec__', lang: action.lang, result });
      }
    }

    // ── If there were actions, inject results and continue ───────
    if (hasActions && toolResults.length > 0) {
      const resultText = toolResults
        .map(r => `نتيجة ${r.tool}:\n${JSON.stringify(r.result, null, 2)}`)
        .join('\n\n---\n\n');

      messages.push({
        role:  'user',
        parts: [{ text: `${resultText}\n\nبناءً على النتائج — أكمل إجابتك للمستخدم بالعربية.` }],
      });
      continue;
    }

    // ── No more actions → extract final response ─────────────────
    finalText = extractFinal(actions);
    if (!finalText && rawResponse) {
      // If model returned only actions and no text, ask for response
      if (round < MAX_ROUNDS && actions.some(a => a.type !== 'text_fragment')) continue;
      finalText = rawResponse.replace(/<action[\s\S]*?<\/action>/g, '').trim() || rawResponse;
    }
    break;
  }

  if (!finalText) finalText = '❌ لم أتمكن من إتمام الطلب — جرب مرة أخرى.';

  return {
    finalText,
    updatedHistory: [
      ...history,
      { role: 'user',      content: userMsg },
      { role: 'assistant', content: finalText },
    ],
  };
}

// ================================================================
// ──────────────────────────────────────────────────────────────────
//  SECTION 6 — MAIN ENTRY POINT
// ──────────────────────────────────────────────────────────────────
// ================================================================

async function main() {
  log('info', 'agent', `Starting — uid=${UID} convId=${CONV_ID}`);

  await memory.setConvStatus(UID, CONV_ID, 'running');

  // Load conversation
  const conv = await memory.getConversation(UID, CONV_ID);
  if (!conv) { log('error', 'agent', 'Conversation not found'); process.exit(1); }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // Build system instruction
  const soul     = readMarkdownFile('soul.md');
  const context  = await memory.buildContextSummary(UID);
  const systemInstruction = [
    soul,
    '\n\n',
    TOOL_SYSTEM_PROMPT,
    '\n\n## السياق الحالي\n',
    `الوقت: ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}\n`,
    context,
  ].join('');

  // Thinking pass (SSE streaming → Firestore, non-blocking)
  await memory.setConvStatus(UID, CONV_ID, 'thinking');
  const thinkMsg = [{ role: 'user', parts: [{ text: userMsg.slice(0, 400) }] }];
  await streamThinking(thinkMsg, soul, async (chunk) => {
    await memory.appendThinking(UID, CONV_ID, chunk);
  });

  // Main ReAct loop
  await memory.setConvStatus(UID, CONV_ID, 'running');
  const { finalText, updatedHistory } = await runReActLoop(
    UID, CONV_ID, userMsg, history, systemInstruction,
  );

  await memory.finishConversation(UID, CONV_ID, finalText, updatedHistory);
  await memory.appendLog(UID, {
    time: new Date().toISOString(), platform: 'agent', video: '—', status: '✅',
    detail: `conv ${CONV_ID} done (${round ?? '?'} rounds)`,
  });

  log('ok', 'agent', `Done — conv=${CONV_ID}`);
}

let round = 0; // track for log
main().catch(async (e) => {
  log('error', 'agent', 'Fatal', { error: e.message });
  try { await memory.failConversation(UID, CONV_ID, e.message); } catch {}
  process.exit(1);
});
