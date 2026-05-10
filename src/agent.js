// agent.js — OFOQ BICAMERAL SOVEREIGN v3
// Actions: shell | browser | read_tool | update_core_memory |
//          add_episode | update_tasks | update_world |
//          schedule_task | cancel_task

import {
  log, sleep, readSkill, readTool,
  loadCoreMemory, saveCoreMemory,
  addEpisode, loadEpisodic,
  loadTasks, saveTasks,
  loadWorldModel, saveWorldModel,
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
async function callModel(messages, sysInst, opts={}, attempt=0) {
  const model  = 'gemma-4-26b-a4b-it';
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const clean  = messages.map(m=>({role:m.role,parts:(m.parts||[]).filter(p=>!p.thought)})).filter(m=>m.parts.length);
  let resp;
  try {
    resp = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      contents:clean,
      systemInstruction:{parts:[{text:sysInst}]},
      generationConfig:{temperature:opts.temperature??0.35,maxOutputTokens:opts.maxTokens??4096,topP:0.95},
    })});
  } catch(e) {
    if(attempt<4){await sleep([1000,3000,6000,12000][attempt]);return callModel(messages,sysInst,opts,attempt+1);}
    throw new Error(`AI unreachable: ${e.message}`);
  }
  if(!resp.ok){
    const err=await resp.json().catch(()=>({}));
    if((resp.status===429||resp.status===503)&&attempt<4){await sleep([2000,5000,10000,20000][attempt]);return callModel(messages,sysInst,opts,attempt+1);}
    throw new Error(`${model} ${resp.status}: ${JSON.stringify(err).slice(0,150)}`);
  }
  const data=await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}

// ── ACTION PARSER ───────────────────────────────────────────────
function parseActions(text) {
  const actions=[];
  const re=/<action\s+([^>]*)>([\s\S]*?)<\/action>/gi;
  let m;
  while((m=re.exec(text))!==null){
    const attrsStr=m[1],body=m[2].trim();
    const attrs={};
    const ar=/(\w+)=["']([^"']*)["']/g;let am;
    while((am=ar.exec(attrsStr))!==null) attrs[am[1]]=am[2];
    const type=(attrs.type||'').toLowerCase();
    if(type==='shell')              actions.push({type:'shell',script:body});
    if(type==='update_core_memory') actions.push({type:'update_core_memory',content:body});
    if(type==='read_tool')          actions.push({type:'read_tool',file:attrs.file||body.trim()});
    if(type==='add_episode'){
      try{actions.push({type:'add_episode',episode:JSON.parse(body)});}
      catch{actions.push({type:'add_episode',episode:{event:body,importance:'medium'}});}
    }
    if(type==='update_tasks'){
      try{actions.push({type:'update_tasks',tasks:JSON.parse(body)});}
      catch(e){actions.push({type:'update_tasks',tasks:null,parseError:e.message});}
    }
    if(type==='update_world'){
      try{actions.push({type:'update_world',world:JSON.parse(body)});}
      catch(e){actions.push({type:'update_world',world:null,parseError:e.message});}
    }
    if(type==='browser'){
      try{actions.push({type:'browser',config:JSON.parse(body)});}
      catch{actions.push({type:'browser',config:null,parseError:'JSON invalid'});}
    }
    if(type==='schedule_task'){
      try{actions.push({type:'schedule_task',config:JSON.parse(body)});}
      catch(e){actions.push({type:'schedule_task',config:null,parseError:e.message});}
    }
    if(type==='cancel_task') actions.push({type:'cancel_task',task_id:attrs.task_id||body.trim()});
  }
  return actions;
}
function extractText(t){return t.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi,'').trim();}

// ── BUILD SYSTEM INSTRUCTION ────────────────────────────────────
function buildSysInst(systemMd, toolsIndex, coreMemory, recentEpisodes, tasks) {
  const now = new Date().toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});
  const pendingTasks = (tasks.pending||[]).slice(0,5).map(t=>`  - [${t.id}] ${t.title} (${t.due||'no due'})`).join('\n');
  const episodes = recentEpisodes.slice(0,5).map(e=>`  - ${e.date?.slice(0,10)} | ${e.event?.slice(0,80)}`).join('\n');

  return `${systemMd}

---
## خارطة طريق الأدوات:
${toolsIndex}

---
## الذاكرة الأساسية (core):
\`\`\`
${coreMemory}
\`\`\`

## آخر الأحداث (episodic):
${episodes || '  (لا يوجد أحداث سابقة)'}

## المهام المعلقة:
${pendingTasks || '  (لا توجد مهام معلقة)'}

**الوقت:** ${now}
**تذكر:** LOGOS × PATHOS — فكّر، نفّذ، ثم ===FINAL_ANSWER===`;
}

// ── BICAMERAL DELIBERATION ──────────────────────────────────────
async function bicameralDeliberation(userMsg, systemMd, toolsIndex, coreMemory, recentEpisodes, tasks, history) {
  const now = new Date().toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});
  const ctx = `الوقت: ${now}
ذاكرة أساسية (مختصر): ${coreMemory.slice(0,1500)}
آخر أحداث: ${recentEpisodes.slice(0,3).map(e=>e.event?.slice(0,80)).join(' | ')||'لا يوجد'}
مهام معلقة: ${(tasks.pending||[]).slice(0,3).map(t=>t.title).join(', ')||'لا يوجد'}
آخر رسائل: ${history.slice(-3).map(h=>`${h.role==='user'?'المستخدم':'أفق'}: ${(h.content||'').slice(0,150)}`).join('\n')}
الطلب: "${userMsg}"`;

  const LOGOS = `${systemMd}\n${toolsIndex}\n\n---\nأنت LOGOS — العقل التحليلي الصارم.\n\n${ctx}\n\n[LOGOS]\n1. الهدف الحقيقي\n2. خطوات التنفيذ\n3. المخاطر (devil's advocate)\n4. هل تحتاج read_tool قبل التنفيذ؟\nنفّذ أول action. ابدأ بـ [LOGOS].`;
  const PATHOS = `${systemMd}\n\n---\nأنت PATHOS — العقل الإنساني.\n\n${ctx}\n\n[PATHOS]\n- ما يريده المستخدم حقاً خلف الكلمات\n- الأسلوب الأنسب لشخصيته\n- أي بُعد إنساني مفيد\nابدأ بـ [PATHOS]. لا actions.`;

  log('info','agent','BICAMERAL DELIBERATION — LOGOS + PATHOS parallel');
  const [logosRaw,pathosRaw] = await Promise.all([
    callModel([{role:'user',parts:[{text:LOGOS}]}],systemMd.slice(0,1200),{temperature:0.2,maxTokens:1500}),
    callModel([{role:'user',parts:[{text:PATHOS}]}],systemMd.slice(0,1200),{temperature:0.55,maxTokens:700}),
  ]);
  log('info','agent',`LOGOS(${logosRaw.length}ch) PATHOS(${pathosRaw.length}ch)`);
  await appendToConv(UID,CONV_ID,'thinking_chunks',`${logosRaw}\n\n${pathosRaw}`);
  return {logosRaw,pathosRaw};
}

// ── EXECUTE ONE ACTION ──────────────────────────────────────────
async function executeAction(action, uid, convId, state) {
  // shell
  if(action.type==='shell'){
    log('info','agent',`[shell] ${action.script.slice(0,60)}...`);
    await appendToConv(uid,convId,'tool_updates','⚙️ تنفيذ...');
    const r=await executeShell(action.script);
    await appendToConv(uid,convId,'tool_updates',r.success?`✅ ${r.stdout?.slice(0,100)||'تم'}`:`❌ ${r.error?.slice(0,100)}`);
    return {type:'shell',success:r.success,stdout:r.stdout?.slice(0,4000),stderr:r.stderr?.slice(0,800),error:r.error,exit_code:r.exit_code};
  }

  // browser
  if(action.type==='browser'){
    if(action.parseError) return {type:'browser',success:false,error:action.parseError};
    const {url,task='',engine='camoufox'}=action.config;
    log('info','agent',`[browser:${engine}] ${url}`);
    await appendToConv(uid,convId,'tool_updates',`🌐 ${engine}: ${url.slice(0,55)}...`);
    const r=await executeBrowser(url,task,engine);
    await appendToConv(uid,convId,'tool_updates',r.success?`✅ ${engine} — ${r.textLength||0} حرف`:`❌ ${r.error?.slice(0,80)}`);
    return r;
  }

  // read_tool — يُعيد محتوى الملف مباشرة للنموذج
  if(action.type==='read_tool'){
    log('info','agent',`[read_tool] ${action.file}`);
    await appendToConv(uid,convId,'tool_updates',`📖 قراءة: ${action.file}...`);
    const content = readTool(action.file);
    await appendToConv(uid,convId,'tool_updates',`✅ تم تحميل ${action.file} (${content.length}ch)`);
    return {type:'read_tool',success:true,file:action.file,content:content.slice(0,8000)};
  }

  // update_core_memory
  if(action.type==='update_core_memory'){
    log('info','agent',`[update_core_memory] ${action.content.length}ch`);
    await appendToConv(uid,convId,'tool_updates','💾 حفظ الذاكرة الأساسية...');
    try{
      await saveCoreMemory(uid,action.content);
      state.coreMemory=action.content;
      state.memUpdated=true;
      await appendToConv(uid,convId,'tool_updates','✅ core memory محفوظ');
      return {type:'update_core_memory',success:true,size:action.content.length};
    }catch(e){
      await appendToConv(uid,convId,'tool_updates',`❌ ${e.message.slice(0,60)}`);
      return {type:'update_core_memory',success:false,error:e.message};
    }
  }

  // add_episode
  if(action.type==='add_episode'){
    log('info','agent',`[add_episode] ${action.episode.event?.slice(0,60)}`);
    await addEpisode(uid,action.episode);
    await appendToConv(uid,convId,'tool_updates',`📝 حدث مضاف: ${action.episode.event?.slice(0,50)}`);
    return {type:'add_episode',success:true};
  }

  // update_tasks
  if(action.type==='update_tasks'){
    if(action.parseError) return {type:'update_tasks',success:false,error:action.parseError};
    log('info','agent',`[update_tasks] pending:${action.tasks?.pending?.length} completed:${action.tasks?.completed?.length}`);
    await saveTasks(uid,action.tasks);
    state.tasks=action.tasks;
    await appendToConv(uid,convId,'tool_updates',`✅ مهام محدّثة — معلقة:${action.tasks?.pending?.length||0} مكتملة:${action.tasks?.completed?.length||0}`);
    return {type:'update_tasks',success:true};
  }

  // update_world
  if(action.type==='update_world'){
    if(action.parseError) return {type:'update_world',success:false,error:action.parseError};
    log('info','agent',`[update_world]`);
    await saveWorldModel(uid,action.world);
    await appendToConv(uid,convId,'tool_updates','🌍 World model محدّث');
    return {type:'update_world',success:true};
  }

  // schedule_task
  if(action.type==='schedule_task'){
    if(action.parseError) return {type:'schedule_task',success:false,error:action.parseError};
    log('info','agent',`[schedule_task] "${action.config.title}"`);
    await appendToConv(uid,convId,'tool_updates',`📅 جدولة: "${action.config.title}"...`);
    try{
      const r=await createScheduledTask(uid,action.config);
      await appendToConv(uid,convId,'tool_updates',`✅ جُدولت — التالية: ${r.nextRun}`);
      return {type:'schedule_task',success:true,...r,title:action.config.title};
    }catch(e){
      await appendToConv(uid,convId,'tool_updates',`❌ ${e.message.slice(0,60)}`);
      return {type:'schedule_task',success:false,error:e.message};
    }
  }

  // cancel_task
  if(action.type==='cancel_task'){
    log('info','agent',`[cancel_task] ${action.task_id}`);
    await appendToConv(uid,convId,'tool_updates',`🛑 إيقاف ${action.task_id}...`);
    try{
      await toggleScheduledTask(uid,action.task_id,false);
      await appendToConv(uid,convId,'tool_updates','✅ تم الإيقاف');
      return {type:'cancel_task',success:true,task_id:action.task_id};
    }catch(e){return {type:'cancel_task',success:false,error:e.message};}
  }

  return {type:action.type,success:false,error:'نوع action غير معروف'};
}

// ── REFLEXION PROMPT ────────────────────────────────────────────
function buildReflexion(results,round,max){
  // لو read_tool — أرفق المحتوى مباشرة
  const toolContents = results
    .filter(r=>r.type==='read_tool'&&r.success)
    .map(r=>`\n### محتوى ${r.file}:\n${r.content}`)
    .join('\n');

  return `نتائج الـ actions (جولة ${round}/${max}):
${JSON.stringify(results.map(r=>({...r,content:r.content?`[${r.content?.length}ch loaded]`:undefined})),null,2)}
${toolContents}

[REFLEXION — LOGOS × PATHOS]
LOGOS: هل النتيجة صحيحة؟ هل تبقى خطوات؟
PATHOS: هل يُرضي المستخدم حقاً؟

إذا تبقى خطوات → <action> مباشرة.
إذا فشل → جرّب البديل.
إذا اكتملت → ===FINAL_ANSWER=== ثم الرد بالعربية مباشرة.`;
}

// ── SYNTHESIS PASS ──────────────────────────────────────────────
async function synthesisPass(messages,sysInst){
  const synth=await callModel(
    [...messages,{role:'user',parts:[{text:'اكتب الرد النهائي الآن.\n- ابدأ مباشرة بالمحتوى\n- بالعربية فقط\n- markdown منسّق\n- لا تذكر الأدوات\n- لا <action>'}]}],
    sysInst,{temperature:0.4},
  );
  return synth.trim();
}

// ── MAIN BICAMERAL LOOP ─────────────────────────────────────────
async function bicameralLoop(uid,convId,userMsg,history,systemMd,toolsIndex){
  // تحميل الطبقات الأربع
  const [coreMemory,recentEpisodes,tasks] = await Promise.all([
    loadCoreMemory(uid),
    loadEpisodic(uid,10),
    loadTasks(uid),
  ]);

  // state قابل للتحديث أثناء الحلقة
  const state = {coreMemory,tasks,memUpdated:false};

  // Phase 1: BICAMERAL DELIBERATION
  await updateConv(uid,convId,{status:'thinking'});
  await appendToConv(uid,convId,'tool_updates','🧠 LOGOS × PATHOS...');
  const {logosRaw,pathosRaw} = await bicameralDeliberation(
    userMsg,systemMd,toolsIndex,coreMemory,recentEpisodes,tasks,history
  );

  await updateConv(uid,convId,{status:'running'});

  let pendingActions = parseActions(logosRaw);
  const messages = [
    ...history.filter(m=>m.content).map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.content}]})),
    {role:'user',  parts:[{text:userMsg}]},
    {role:'model', parts:[{text:`[LOGOS]\n${logosRaw}\n\n[PATHOS]\n${pathosRaw}`}]},
  ];

  if(!pendingActions.length){
    const sysInst=buildSysInst(systemMd,toolsIndex,state.coreMemory,recentEpisodes,state.tasks);
    const finalText=await synthesisPass(messages,sysInst);
    return {finalText,updatedHistory:[...history,{role:'user',content:userMsg},{role:'assistant',content:finalText}],memUpdated:state.memUpdated};
  }

  let finalText='';
  const MAX=15;

  for(let round=0;round<MAX;round++){
    log('info','agent',`EXECUTE r${round+1}/${MAX} — ${pendingActions.length} actions`);

    const results=[];
    for(const action of pendingActions){
      const r=await executeAction(action,uid,convId,state);
      results.push(r);
    }

    log('info','agent',`REFLEXION r${round+1}`);
    const sysInst=buildSysInst(systemMd,toolsIndex,state.coreMemory,recentEpisodes,state.tasks);
    messages.push({role:'user',parts:[{text:buildReflexion(results,round+1,MAX)}]});
    const nextStep=await callModel(messages,sysInst,{temperature:0.3});
    log('info','agent',`Reflexion(${nextStep.length}ch): ${nextStep.slice(0,80)}`);

    const nextActions=parseActions(nextStep);
    const nextText=extractText(nextStep);
    if(nextText) await appendToConv(uid,convId,'thinking_chunks',`[r${round+1}]\n${nextText}`);
    messages.push({role:'model',parts:[{text:nextStep}]});

    const markerIdx=nextStep.indexOf('===FINAL_ANSWER===');
    if(markerIdx!==-1){
      const candidate=nextStep.slice(markerIdx+18).replace(/<action[\s\S]*?<\/action>/gi,'').trim();
      finalText=candidate||await synthesisPass(messages,sysInst);
      break;
    }
    if(!nextActions.length){finalText=await synthesisPass(messages,sysInst);break;}
    pendingActions=nextActions;
  }

  if(!finalText) finalText='⚠️ وصلت للحد الأقصى — راجع tool_updates.';

  return {
    finalText,
    updatedHistory:[...history,{role:'user',content:userMsg},{role:'assistant',content:finalText}],
    memUpdated:state.memUpdated,
  };
}

// ── MAIN ────────────────────────────────────────────────────────
async function main(){
  log('info','agent',`BICAMERAL v3 — uid=${UID?.slice(0,8)} conv=${CONV_ID}`);

  const systemMd  = readSkill('system.md');
  const toolsIndex = readTool('index.md');
  if(!systemMd){log('error','agent','system.md not found');process.exit(1);}

  await updateConv(UID,CONV_ID,{status:'thinking'});
  const conv=await getConv(UID,CONV_ID);
  if(!conv){log('error','agent','Conversation not found');process.exit(1);}

  const {finalText,updatedHistory,memUpdated}=await bicameralLoop(
    UID,CONV_ID,conv.user_message,conv.history||[],systemMd,toolsIndex
  );

  await saveConv(UID,CONV_ID,{
    status:'done',final_response:finalText,
    history:updatedHistory,finished_at:new Date().toISOString(),
  });
  log('ok','agent',`Done v3 — memUpdated=${memUpdated} msgs=${updatedHistory.length}`);
}

main().catch(async e=>{
  log('error','agent','Fatal',{error:e.message});
  try{await saveConv(UID,CONV_ID,{status:'error',error:e.message,finished_at:new Date().toISOString()});}catch{}
  process.exit(1);
});
