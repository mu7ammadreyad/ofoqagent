// agent.js — OFOQ BICAMERAL SOVEREIGN v7
// معمارية: LOGOS × PATHOS — عقلان يفكران معاً
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

if (!GEMINI_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
if (!UID)        { console.error('CONV_UID missing');        process.exit(1); }
if (!CONV_ID)    { console.error('CONV_ID missing');         process.exit(1); }

// ── MODEL CALL ──────────────────────────────────────────────────
async function callModel(messages, sysInst, opts = {}, attempt = 0) {
  const model  = opts.model || 'gemma-4-26b-a4b-it';
  const temp   = opts.temperature ?? 0.35;
  const tokens = opts.maxTokens    ?? 4096;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const clean  = messages
    .map(m => ({ role:m.role, parts:(m.parts||[]).filter(p=>!p.thought) }))
    .filter(m => m.parts.length);

  let resp;
  try {
    resp = await fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        contents: clean,
        systemInstruction: { parts:[{ text:sysInst }] },
        generationConfig: { temperature:temp, maxOutputTokens:tokens, topP:0.95 },
      }),
    });
  } catch(e) {
    if (attempt < 4) {
      const w = [1000,3000,6000,12000][attempt];
      await sleep(w);
      return callModel(messages, sysInst, opts, attempt+1);
    }
    throw new Error(`AI unreachable: ${e.message}`);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(()=>({}));
    if ((resp.status===429||resp.status===503) && attempt<4) {
      const w = [2000,5000,10000,20000][attempt];
      await sleep(w);
      return callModel(messages, sysInst, opts, attempt+1);
    }
    throw new Error(`${model} ${resp.status}: ${JSON.stringify(err).slice(0,150)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
}

// ── ACTION PARSER ───────────────────────────────────────────────
function parseActions(text) {
  const actions = [];
  const re = /<action\s+([^>]*)>([\s\S]*?)<\/action>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrsStr=m[1], body=m[2].trim();
    const attrs={};
    const ar=/(\w+)=["']([^"']*)["']/g; let am;
    while ((am=ar.exec(attrsStr))!==null) attrs[am[1]]=am[2];
    const type=(attrs.type||'').toLowerCase();
    if (type==='shell')         actions.push({type:'shell',script:body});
    if (type==='update_memory') actions.push({type:'update_memory',content:body});
    if (type==='browser') {
      try   { actions.push({type:'browser',config:JSON.parse(body)}); }
      catch { actions.push({type:'browser',config:null,parseError:'JSON invalid'}); }
    }
    if (type==='schedule_task') {
      try   { actions.push({type:'schedule_task',config:JSON.parse(body)}); }
      catch(e) { actions.push({type:'schedule_task',config:null,parseError:e.message}); }
    }
    if (type==='cancel_task') actions.push({type:'cancel_task',task_id:attrs.task_id||body.trim()});
  }
  return actions;
}
function extractText(t) { return t.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi,'').trim(); }

// ── BICAMERAL DELIBERATION ──────────────────────────────────────
// LOGOS (تحليل بارد) + PATHOS (فهم إنساني) يعملان بالتوازي
async function bicameralDeliberation(userMsg, systemMd, currentMemory, history) {
  const now = new Date().toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});
  const ctx = `الوقت: ${now}
ذاكرة الركيزة المعرفية (مختصر):
${currentMemory.slice(0,1800)}
آخر رسائل المحادثة:
${history.slice(-3).map(h=>`${h.role==='user'?'المستخدم':'أفق'}: ${(h.content||'').slice(0,180)}`).join('\n')}
طلب المستخدم الآن: "${userMsg}"`;

  const logosPrompt = `${systemMd}\n\n---\nأنت الآن LOGOS — العقل التحليلي الصارم.\n\n${ctx}\n\nحلّل الطلب منطقياً:\n[LOGOS]\n1. الهدف الحقيقي بالضبط\n2. الخطة خطوة بخطوة\n3. المخاطر (كن devil's advocate)\n4. نفّذ أول action إذا لزم الأمر\n\nابدأ بـ [LOGOS] مباشرة.`;

  const pathosPrompt = `${systemMd}\n\n---\nأنت الآن PATHOS — العقل الإنساني المتعاطف.\n\n${ctx}\n\n[PATHOS]\nما الذي يريده المستخدم حقاً خلف الكلمات؟\nما أسلوب التقديم الأنسب لشخصيته؟\nما البُعد الإنساني الذي يخدمه؟\n\nابدأ بـ [PATHOS] مباشرة. لا تكتب actions.`;

  log('info','agent','BICAMERAL: calling LOGOS + PATHOS in parallel');
  const [logosRaw, pathosRaw] = await Promise.all([
    callModel([{role:'user',parts:[{text:logosPrompt}]}], systemMd.slice(0,1500), {temperature:0.2,maxTokens:1500}),
    callModel([{role:'user',parts:[{text:pathosPrompt}]}], systemMd.slice(0,1500), {temperature:0.55,maxTokens:800}),
  ]);

  log('info','agent',`LOGOS(${logosRaw.length}ch) PATHOS(${pathosRaw.length}ch)`);
  await appendToConv(UID, CONV_ID, 'thinking_chunks', `${logosRaw}\n\n${pathosRaw}`);
  return { logosRaw, pathosRaw };
}

// ── SYSTEM INSTRUCTION ──────────────────────────────────────────
function buildSysInst(systemMd, currentMemory) {
  const now = new Date().toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});
  return `${systemMd}\n\n---\n## الذاكرة الحالية:\n\`\`\`\n${currentMemory}\n\`\`\`\n**الوقت:** ${now}\n**تذكر:** LOGOS × PATHOS — نفّذ بـ actions، وعند الاكتمال: ===FINAL_ANSWER===`;
}

// ── REFLEXION PROMPT ────────────────────────────────────────────
function buildReflexion(results, round, max) {
  return `نتائج الـ actions (الجولة ${round}/${max}):\n${JSON.stringify(results,null,2)}\n\n[REFLEXION]\nLOGOS: هل النتيجة صحيحة؟ هل تبقى خطوات؟\nPATHOS: هل هذا سيُرضي المستخدم حقاً؟\n\nإذا تبقى خطوات → <action> مباشرة.\nإذا فشل → جرّب البديل بـ <action>.\nإذا اكتملت → ===FINAL_ANSWER=== ثم الرد بالعربية المباشرة.`;
}

// ── SYNTHESIS PASS ──────────────────────────────────────────────
async function synthesisPass(messages, systemMd, currentMemory) {
  const synth = await callModel(
    [...messages,{role:'user',parts:[{text:'اكتب الرد النهائي للمستخدم الآن.\n- ابدأ مباشرة بالمحتوى\n- بالعربية فقط\n- markdown منسّق\n- لا تذكر الأدوات أو shell\n- لا <action>'}]}],
    buildSysInst(systemMd, currentMemory),
    {temperature:0.4},
  );
  return synth.trim();
}

// ── EXECUTE ACTION ──────────────────────────────────────────────
async function executeAction(action, uid, convId) {
  if (action.type==='shell') {
    log('info','agent',`[shell] ${action.script.slice(0,60)}...`);
    await appendToConv(uid,convId,'tool_updates','⚙️ جارٍ التنفيذ...');
    const r = await executeShell(action.script);
    await appendToConv(uid,convId,'tool_updates', r.success?`✅ ${r.stdout?.slice(0,100)||'تم'}`:`❌ ${r.error?.slice(0,100)}`);
    return {type:'shell',success:r.success,stdout:r.stdout?.slice(0,4000),stderr:r.stderr?.slice(0,800),error:r.error,exit_code:r.exit_code};
  }

  if (action.type==='browser') {
    if (action.parseError) return {type:'browser',success:false,error:action.parseError};
    const {url,task='',engine='camoufox'} = action.config;
    log('info','agent',`[browser:${engine}] ${url}`);
    await appendToConv(uid,convId,'tool_updates',`🌐 ${engine}: ${url.slice(0,55)}...`);
    const r = await executeBrowser(url, task, engine);
    await appendToConv(uid,convId,'tool_updates', r.success?`✅ ${engine} — ${r.textLength||0} حرف`:`❌ ${r.error?.slice(0,80)}`);
    return r;
  }

  if (action.type==='update_memory') {
    log('info','agent',`[update_memory] ${action.content.length}ch`);
    await appendToConv(uid,convId,'tool_updates','💾 تحديث الذاكرة...');
    try {
      await saveMemory(uid, action.content);
      await appendToConv(uid,convId,'tool_updates','✅ تم حفظ الذاكرة');
      return {type:'update_memory',success:true,size:action.content.length};
    } catch(e) {
      await appendToConv(uid,convId,'tool_updates',`❌ ${e.message.slice(0,60)}`);
      return {type:'update_memory',success:false,error:e.message};
    }
  }

  if (action.type==='schedule_task') {
    if (action.parseError) return {type:'schedule_task',success:false,error:action.parseError};
    log('info','agent',`[schedule_task] "${action.config.title}"`);
    await appendToConv(uid,convId,'tool_updates',`📅 جدولة: "${action.config.title}"...`);
    try {
      const r = await createScheduledTask(uid, action.config);
      await appendToConv(uid,convId,'tool_updates',`✅ جُدولت — التالية: ${r.nextRun}`);
      return {type:'schedule_task',success:true,...r,title:action.config.title};
    } catch(e) {
      await appendToConv(uid,convId,'tool_updates',`❌ ${e.message.slice(0,60)}`);
      return {type:'schedule_task',success:false,error:e.message};
    }
  }

  if (action.type==='cancel_task') {
    log('info','agent',`[cancel_task] ${action.task_id}`);
    await appendToConv(uid,convId,'tool_updates',`🛑 إيقاف ${action.task_id}...`);
    try {
      await toggleScheduledTask(uid, action.task_id, false);
      await appendToConv(uid,convId,'tool_updates','✅ تم الإيقاف');
      return {type:'cancel_task',success:true,task_id:action.task_id};
    } catch(e) {
      return {type:'cancel_task',success:false,error:e.message};
    }
  }

  return {type:action.type,success:false,error:'نوع action غير معروف'};
}

// ── BICAMERAL MAIN LOOP ─────────────────────────────────────────
async function bicameralLoop(uid, convId, userMsg, history, systemMd) {
  let currentMemory = await loadMemory(uid);
  let memUpdated    = false;

  // Phase 1: DELIBERATION (متوازٍ)
  await updateConv(uid,convId,{status:'thinking'});
  await appendToConv(uid,convId,'tool_updates','🧠 LOGOS × PATHOS يتشاوران...');
  const {logosRaw,pathosRaw} = await bicameralDeliberation(userMsg,systemMd,currentMemory,history);

  await updateConv(uid,convId,{status:'running'});

  // جمع actions من LOGOS
  let pendingActions = parseActions(logosRaw);
  const messages = [
    ...history.filter(m=>m.content).map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.content}]})),
    {role:'user',  parts:[{text:userMsg}]},
    {role:'model', parts:[{text:`[LOGOS]\n${logosRaw}\n\n[PATHOS]\n${pathosRaw}`}]},
  ];

  if (!pendingActions.length) {
    const finalText = await synthesisPass(messages, systemMd, currentMemory);
    return {finalText, updatedHistory:[...history,{role:'user',content:userMsg},{role:'assistant',content:finalText}], memUpdated};
  }

  let finalText = '';
  const MAX = 15;

  for (let round = 0; round < MAX; round++) {
    log('info','agent',`EXECUTE round ${round+1}/${MAX} — ${pendingActions.length} actions`);

    const results = [];
    for (const action of pendingActions) {
      const r = await executeAction(action, uid, convId);
      results.push(r);
      if (action.type==='update_memory' && r.success) {
        currentMemory = action.content; memUpdated = true;
      }
    }

    log('info','agent',`REFLEXION round ${round+1}`);
    const sysInst = buildSysInst(systemMd, currentMemory);
    messages.push({role:'user',parts:[{text:buildReflexion(results,round+1,MAX)}]});
    const nextStep = await callModel(messages, sysInst, {temperature:0.3});
    log('info','agent',`Reflexion(${nextStep.length}ch): ${nextStep.slice(0,80)}`);

    const nextActions = parseActions(nextStep);
    const nextText    = extractText(nextStep);
    if (nextText) await appendToConv(uid,convId,'thinking_chunks',`[r${round+1}]\n${nextText}`);
    messages.push({role:'model',parts:[{text:nextStep}]});

    const markerIdx = nextStep.indexOf('===FINAL_ANSWER===');
    if (markerIdx !== -1) {
      const candidate = nextStep.slice(markerIdx+18).replace(/<action[\s\S]*?<\/action>/gi,'').trim();
      finalText = candidate || await synthesisPass(messages, systemMd, currentMemory);
      break;
    }
    if (!nextActions.length) {
      finalText = await synthesisPass(messages, systemMd, currentMemory);
      break;
    }
    pendingActions = nextActions;
  }

  if (!finalText) finalText = '⚠️ وصلت للحد الأقصى من الجولات — راجع tool_updates لتفاصيل ما تم.';

  return {
    finalText,
    updatedHistory:[...history,{role:'user',content:userMsg},{role:'assistant',content:finalText}],
    memUpdated,
  };
}

// ── MAIN ────────────────────────────────────────────────────────
async function main() {
  log('info','agent',`BICAMERAL v7 — uid=${UID?.slice(0,8)} conv=${CONV_ID}`);
  const systemMd = readSkill('system.md');
  if (!systemMd) { log('error','agent','skills/system.md not found'); process.exit(1); }

  await updateConv(UID,CONV_ID,{status:'thinking'});
  const conv = await getConv(UID,CONV_ID);
  if (!conv) { log('error','agent','Conversation not found'); process.exit(1); }

  const {finalText,updatedHistory,memUpdated} = await bicameralLoop(
    UID,CONV_ID, conv.user_message, conv.history||[], systemMd,
  );

  await saveConv(UID,CONV_ID,{
    status:'done', final_response:finalText,
    history:updatedHistory, finished_at:new Date().toISOString(),
  });
  log('ok','agent',`Done BICAMERAL — memUpdated=${memUpdated} msgs=${updatedHistory.length}`);
}

main().catch(async e => {
  log('error','agent','Fatal',{error:e.message});
  try { await saveConv(UID,CONV_ID,{status:'error',error:e.message,finished_at:new Date().toISOString()}); } catch {}
  process.exit(1);
});
