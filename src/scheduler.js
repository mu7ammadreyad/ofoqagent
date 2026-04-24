// scheduler.js — OFOQ Agent v6.1
// يشتغل كل ساعة عبر GitHub Actions cron
// يقرأ المهام المجدولة من Firestore وينشئ محادثات جديدة لكل مهمة حانت

import { log, sleep, getDb, getAllDueTasks, updateScheduledTask, calcNextRun } from './tools.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN_FOR_DISPATCH;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_AGENT_REPO;

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT missing');
  process.exit(1);
}

// ================================================================
// إنشاء محادثة مجدولة وإطلاق GitHub Action
// ================================================================
async function dispatchTaskConversation(uid, convId) {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    log('warn', 'scheduler', 'GitHub dispatch env missing — skipping dispatch');
    return false;
  }
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method:  'POST',
      headers: {
        Authorization:  `token ${GITHUB_TOKEN}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent':   'OFOQ-Scheduler/6.1',
      },
      body: JSON.stringify({
        event_type:     'agent-chat',
        client_payload: { uid, conv_id: convId },
      }),
    }
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    log('error', 'scheduler', `dispatch failed: ${resp.status}`, body);
    return false;
  }
  return true;
}

// ================================================================
// معالجة مهمة واحدة
// ================================================================
async function processTask(task) {
  const { uid, taskId, title, message, schedule_type, hour, minute, days, timezone, run_count = 0, ref } = task;

  log('info', 'scheduler', `Processing task: ${taskId} | "${title}" | uid=${uid?.slice(0,8)}`);

  const db = await getDb();

  // إنشاء conv_id فريد للمهمة المجدولة
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).replace(/-/g, '');
  const convId = `sched_${taskId}_${today}`;

  // تحقق — هل اتشغلت المهمة دي النهارده بالفعل؟
  const existing = await db.doc(`users/${uid}/conversations/${convId}`).get();
  if (existing.exists) {
    log('warn', 'scheduler', `Task ${taskId} already ran today — skipping`);
    // حدّث next_run للمرة القادمة
    const nextRun = calcNextRun({ schedule_type, hour, minute, days, timezone });
    await ref.update({ next_run: nextRun });
    return;
  }

  // الرسالة للـ Agent — تتضمن سياق المهمة المجدولة
  const agentMessage = [
    `[مهمة مجدولة تلقائية — "${title}"]`,
    ``,
    message,
    ``,
    `تعليمات التنفيذ التلقائي:`,
    `- هذه محادثة تلقائية لا يتدخل فيها المستخدم`,
    `- نفّذ المهمة وحدّث الذاكرة بعد الانتهاء`,
    `- اكتب ملخصاً موجزاً بالنتيجة في الرد النهائي`,
  ].join('\n');

  // إنشاء وثيقة المحادثة في Firestore
  await db.doc(`users/${uid}/conversations/${convId}`).set({
    status:          'pending',
    created_at:      new Date().toISOString(),
    user_message:    agentMessage,
    history:         [],
    thinking_chunks: [],
    tool_updates:    [],
    final_response:  null,
    error:           null,
    title:           `⏰ ${title}`,
    is_scheduled:    true,
    task_id:         taskId,
    task_title:      title,
    schedule_date:   today,
  });

  // تشغيل GitHub Action
  const dispatched = await dispatchTaskConversation(uid, convId);

  // حدّث المهمة: last_run + next_run + run_count
  const nextRun = calcNextRun({ schedule_type, hour, minute, days, timezone });
  await ref.update({
    last_run:  new Date().toISOString(),
    next_run:  nextRun,
    run_count: run_count + 1,
    last_conv_id: convId,
  });

  log('ok', 'scheduler', `Task ${taskId} dispatched — conv: ${convId} | next: ${nextRun}`);
}

// ================================================================
// MAIN
// ================================================================
async function main() {
  log('info', 'scheduler', `Starting — ${new Date().toISOString()}`);

  const dueTasks = await getAllDueTasks();
  log('info', 'scheduler', `Found ${dueTasks.length} due task(s)`);

  if (dueTasks.length === 0) {
    log('ok', 'scheduler', 'No due tasks — exiting');
    return;
  }

  let success = 0, failed = 0;
  for (const task of dueTasks) {
    try {
      await processTask(task);
      success++;
      await sleep(1500);  // تأخير بسيط بين المهام
    } catch (e) {
      failed++;
      log('error', 'scheduler', `Task ${task.taskId} failed`, { error: e.message });
    }
  }

  log('ok', 'scheduler', `Done — ${success} dispatched, ${failed} failed`);
}

main().catch(e => {
  log('error', 'scheduler', 'Fatal error', { error: e.message });
  process.exit(1);
});
