// scheduler.js — OFOQ Agent v5.0
// يُشغَّل بواسطة scheduler.yml كل ساعة
// يقرأ Firestore → يجد المهام الحانة → يطلق agent-chat event لكل واحدة

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { log, cairoToday } from './helpers.js';
import { getDueSchedules, markScheduleRan, createConversation } from './memory.js';

// ── Init Firebase Admin ───────────────────────────────────────────
function initFirebase() {
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
}

// ── Dispatch GitHub Action for a user's conversation ─────────────
async function dispatchAgentChat(uid, convId, dispatchToken) {
  const resp = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_AGENT_REPO}/dispatches`,
    {
      method:  'POST',
      headers: {
        Authorization:  `token ${dispatchToken}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent':   'OFOQ-Scheduler/5.0',
      },
      body: JSON.stringify({
        event_type:     'agent-chat',
        client_payload: { uid, conv_id: convId },
      }),
    }
  );
  return resp.ok;
}

// ── Get user's dispatch token from Firestore config ───────────────
async function getUserDispatchToken(uid) {
  const db  = getFirestore();
  const doc = await db.doc(`users/${uid}/config/main`).get();
  if (!doc.exists) return null;
  return doc.data()?.settings?.github_dispatch_token || doc.data()?.github?.token || null;
}

// ================================================================
// MAIN
// ================================================================
async function main() {
  initFirebase();
  const nowCairo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const nowHour  = nowCairo.getHours();
  const nowMin   = nowCairo.getMinutes();
  const today    = cairoToday();

  log('info', 'scheduler', `Checking schedules — Cairo time: ${String(nowHour).padStart(2,'0')}:${String(nowMin).padStart(2,'0')}`);

  // جلب كل المهام الحانة من Firestore (next_run <= today)
  const dueSchedules = await getDueSchedules();
  log('info', 'scheduler', `Found ${dueSchedules.length} due schedules`);

  if (!dueSchedules.length) {
    log('info', 'scheduler', 'No due schedules — exiting');
    return;
  }

  let dispatched = 0;
  for (const sched of dueSchedules) {
    // تحقق إن الوقت حان فعلاً (±30 دقيقة tolerance عشان الـ cron كل ساعة)
    const schedTotalMin = sched.cron_hour * 60 + sched.cron_minute;
    const nowTotalMin   = nowHour * 60 + nowMin;
    const diff          = Math.abs(nowTotalMin - schedTotalMin);

    // لو الوقت مش قريب (بعيد بأكتر من 30 دقيقة) — تجاهل لهذه الساعة
    if (diff > 30 && diff < (24 * 60 - 30)) {
      log('info', 'scheduler', `Skip "${sched.label}" — time diff ${diff}min`);
      continue;
    }

    // جلب dispatch token الخاص بالمستخدم
    const dispatchToken = await getUserDispatchToken(sched.uid);
    if (!dispatchToken) {
      log('warn', 'scheduler', `No dispatch token for uid=${sched.uid} sched="${sched.label}"`);
      continue;
    }

    // بناء رسالة المستخدم للـ agent
    let userPrompt = sched.user_prompt || '';
    if (!userPrompt) {
      switch (sched.task) {
        case 'build_daily_plan':
          userPrompt = `بسم الله. قم ببناء خطة النشر اليومية الآن. [scheduled: ${sched.label}]`;
          break;
        case 'health_check':
          userPrompt = `قم بفحص صحة جميع التوكنز والاتصالات الآن. [scheduled: ${sched.label}]`;
          break;
        default:
          userPrompt = `[scheduled task: ${sched.label}]`;
      }
    }

    // إنشاء conversation في Firestore
    const convId = `sched_${sched.id}_${Date.now()}`;
    await createConversation(sched.uid, convId, userPrompt, []);

    // إطلاق GitHub Action
    const ok = await dispatchAgentChat(sched.uid, convId, dispatchToken);

    if (ok) {
      await markScheduleRan(sched.uid, sched.id);
      log('ok', 'scheduler', `Dispatched "${sched.label}" for uid=${sched.uid}`);
      dispatched++;
    } else {
      log('error', 'scheduler', `Failed to dispatch "${sched.label}" for uid=${sched.uid}`);
    }
  }

  log('ok', 'scheduler', `Done — dispatched ${dispatched}/${dueSchedules.length}`);
}

main().catch(e => {
  log('error', 'scheduler', 'Fatal error', { error: e.message });
  process.exit(1);
});
