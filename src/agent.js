// agent.js — OFOQ Agent v5.0
// Entry point for GitHub Actions
// Reads conversation from Firestore → Gemini Function Calling → writes results back

import * as memory           from './memory.js';
import { executeTool, TOOL_DECLARATIONS, TOOL_LABELS } from './tools.js';
import { stripThoughts, readMarkdownFile, log, sleep } from './helpers.js';

// ── Env vars (set by GitHub Actions) ─────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const UID            = process.env.CONV_UID;
const CONV_ID        = process.env.CONV_ID;

if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
if (!UID)            { console.error('CONV_UID not set');       process.exit(1); }
if (!CONV_ID)        { console.error('CONV_ID not set');        process.exit(1); }

// ================================================================
// GEMINI — Thinking Pass (no tools → no thought_signature error)
// ================================================================
async function runThinkingPass(userMsg, systemInstruction, onChunk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: `فكّر بإيجاز عن: ${userMsg.slice(0, 300)}` }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature:    0.3,
      maxOutputTokens: 400,
      thinkingConfig: { thinkingBudget: 256 }, // ← works without function calling
    },
  };

  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) return; // Non-fatal — thinking is enhancement only
    const reader  = resp.body.getReader(), dec = new TextDecoder();
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
// GEMINI — Function Calling Pass
// ← stripThoughts() fixes thought_signature error
// ================================================================
async function callGeminiFC(messages, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

  // ← CRITICAL: strip thought parts before sending history
  const cleanMessages = stripThoughts(messages);

  const body = {
    contents:          cleanMessages,
    tools:             [{ functionDeclarations: TOOL_DECLARATIONS }],
    toolConfig:        { functionCallingConfig: { mode: 'AUTO' } },
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig:  {
      temperature:     0.3,
      maxOutputTokens: 2048,
      // NO thinkingConfig here — mixing it with function calling causes thought_signature error
    },
  };

  const controller = new AbortController();
  const tmId       = setTimeout(() => controller.abort(), 28_000);

  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (e) {
    clearTimeout(tmId);
    if (e.name === 'AbortError') throw new Error('AI timeout 28s');
    // Fallback to Gemma
    return callGemmaFallback(cleanMessages, systemInstruction);
  }
  clearTimeout(tmId);

  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 503) {
      log('warn', 'agent', `Gemini ${resp.status} → Gemma fallback`);
      await sleep(500);
      return callGemmaFallback(cleanMessages, systemInstruction);
    }
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Gemini ${resp.status}: ${JSON.stringify(err).slice(0, 120)}`);
  }

  const reader  = resp.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', funcCall = null;

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
        if      (part.functionCall)                 funcCall = part.functionCall;
        else if (part.text && !part.thought)        text += part.text;
      }
    }
  }

  return { text, funcCall };
}

// ================================================================
// GEMMA FALLBACK (no function calling — text only)
// ================================================================
async function callGemmaFallback(messages, systemInstruction) {
  const apiKey = process.env.GEMMA_API_KEY || GEMINI_API_KEY;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=${apiKey}`;
  const simple = messages
    .filter(m => !m.parts?.some(p => p.functionCall || p.functionResponse))
    .map(m => ({ role: m.role, parts: m.parts.filter(p => p.text && !p.thought) }))
    .filter(m => m.parts.length);
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ contents: simple, systemInstruction: { parts: [{ text: systemInstruction }] }, generationConfig: { temperature: 0.4, maxOutputTokens: 800 } }),
  });
  if (!resp.ok) throw new Error(`Gemma ${resp.status}`);
  const data = await resp.json();
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || '', funcCall: null };
}

// ================================================================
// AGENT LOOP
// ================================================================
async function runAgentLoop(uid, convId, userMsg, history, systemInstruction) {

  // Build Gemini conversation
  const messages = history
    .filter(m => m.content)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  messages.push({ role: 'user', parts: [{ text: userMsg }] });

  let finalText = '';

  for (let round = 0; round < 6; round++) {
    const { text, funcCall } = await callGeminiFC(messages, systemInstruction);

    const modelParts = [];
    if (funcCall) {
      modelParts.push({ text: "سأقوم بتنفيذ الأمر التالي:" }); 
      modelParts.push({ functionCall: funcCall });
    } else if (text) {
      modelParts.push({ text });
    }
    
    if (modelParts.length) messages.push({ role: 'model', parts: modelParts });
    if (funcCall) {
      const label = TOOL_LABELS[funcCall.name] || funcCall.name;
      log('info', 'agent', `tool call: ${funcCall.name}`);
      await memory.appendUpdate(uid, convId, `${label}...`);

      const result = await executeTool(uid, funcCall.name, funcCall.args ?? {});

      messages.push({
        role:  'user',
        parts: [{ functionResponse: { name: funcCall.name, response: result } }],
      });

      await memory.appendUpdate(uid, convId,
        result.success ? `✅ ${label} — نجح` : `❌ ${label} — ${result.error}`
      );
      continue;
    }

    if (text) { finalText = text; break; }
  }

  if (!finalText) finalText = '❌ لم أتمكن من إتمام الطلب. حاول مرة أخرى.';

  // Build updated history (OpenAI format for frontend storage)
  const updatedHistory = [
    ...history,
    { role: 'user',      content: userMsg },
    { role: 'assistant', content: finalText },
  ];

  return { finalText, updatedHistory };
}

// ================================================================
// MAIN
// ================================================================
async function main() {
  log('info', 'agent', `Starting — uid=${UID} convId=${CONV_ID}`);

  // 1. Mark as running
  await memory.setConvStatus(UID, CONV_ID, 'running');

  // 2. Load conversation data
  const conv = await memory.getConversation(UID, CONV_ID);
  if (!conv) {
    log('error', 'agent', 'Conversation not found in Firestore');
    process.exit(1);
  }

  const userMsg = conv.user_message;
  const history = conv.history || [];

  // 3. Load system instruction from soul.md + context
  const soul    = readMarkdownFile('soul.md');
  const context = await memory.buildContextSummary(UID);
  const systemInstruction = `${soul}\n\n[Context - ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}]\n${context}`;

  // 4. Thinking pass (non-blocking — streams to Firestore in real-time)
  await memory.setConvStatus(UID, CONV_ID, 'thinking');
  await runThinkingPass(userMsg, systemInstruction, async (chunk) => {
    await memory.appendThinking(UID, CONV_ID, chunk);
  });

  // 5. Function Calling loop
  await memory.setConvStatus(UID, CONV_ID, 'running');
  const { finalText, updatedHistory } = await runAgentLoop(UID, CONV_ID, userMsg, history, systemInstruction);

  // 6. Save result
  await memory.finishConversation(UID, CONV_ID, finalText, updatedHistory);
  await memory.appendLog(UID, { time: new Date().toISOString(), platform: 'agent', video: '—', status: '✅', detail: `conv ${CONV_ID} done` });

  log('ok', 'agent', `Done — conv=${CONV_ID}`);
}

main().catch(async (e) => {
  log('error', 'agent', 'Fatal error', { error: e.message });
  try { await memory.failConversation(UID, CONV_ID, e.message); } catch {}
  process.exit(1);
});
