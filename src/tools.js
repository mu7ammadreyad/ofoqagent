// tools.js — OFOQ Agent v5.0
// Tool implementations + TOOL_SYSTEM_PROMPT for Custom FC

import * as memory from './memory.js';
import { ghFetch, getPendingVideos } from './publishers/github.js';
import { ytGetAccessToken } from './publishers/youtube.js';
import { calcFajr, makeDefaultSlots, cairoToday, log, pad } from './helpers.js';

// ================================================================
// TOOLS
// ================================================================

export async function save_credentials(uid, { platform, data }) {
  const allowed = ['github', 'youtube', 'settings'];
  if (!platform || !data)          return { success: false, error: 'platform و data مطلوبان' };
  if (!allowed.includes(platform)) return { success: false, error: `المنصات المدعومة: ${allowed.join(', ')}` };
  await memory.patchConfig(uid, { [platform]: data });
  log('ok', 'tools', `save_credentials: ${platform}`, { keys: Object.keys(data) });
  return { success: true, saved: Object.keys(data).join(', '), message: `✅ تم حفظ ${Object.keys(data).length} حقول لـ ${platform}` };
}

export async function verify_connection(uid, { platform }) {
  const config = await memory.getConfig(uid);
  switch (platform) {
    case 'github': {
      const gh = config.github;
      if (!gh.token) return { success: false, error: 'GitHub token غير موجود' };
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${gh.token}`, 'User-Agent': 'OFOQ/5.0' } });
      if (!r.ok) return { success: false, error: `GitHub ${r.status} — تحقق من الـ token` };
      const d = await r.json();
      await memory.patchConfig(uid, { github: { status: 'verified', last_verified: new Date().toISOString() } });
      log('ok', 'tools', 'verify github', { login: d.login });
      return { success: true, data: { login: d.login, name: d.name, public_repos: d.public_repos } };
    }
    case 'youtube': {
      const yt = config.youtube;
      if (!yt.client_id || !yt.refresh_token) return { success: false, error: 'YouTube: client_id + client_secret + refresh_token مطلوبان' };
      const token = await ytGetAccessToken(yt);
      if (!token) return { success: false, error: 'فشل تجديد YouTube token' };
      await memory.patchConfig(uid, { youtube: { status: 'verified', last_verified: new Date().toISOString(), access_token: token } });
      return { success: true, data: { message: 'YouTube token صالح' } };
    }
    default: return { success: false, error: `المنصات: github, youtube` };
  }
}

export async function list_pending_videos(uid) {
  const config = await memory.getConfig(uid);
  const gh     = config.github;
  if (!gh.token) return { success: false, error: 'GitHub غير مُهيأ' };
  const videos = await getPendingVideos(gh.repo_owner, gh.repo_name, gh.token);
  if (!videos.length) return { success: true, data: { count: 0, message: 'لا يوجد فيديوهات' } };
  return { success: true, data: { count: videos.length, videos: videos.slice(0, 10).map(v => ({ name: v.base, size_mb: (v.size / 1024 / 1024).toFixed(1), has_meta: !!v.mdUrl })) } };
}

export async function health_check(uid) {
  const config = await memory.getConfig(uid);
  const results = {}, warns = [];
  if (config.github.token) {
    const r = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${config.github.token}`, 'User-Agent': 'OFOQ/5.0' } });
    results.github = r.ok ? '✅ سليم' : '❌ فشل'; if (!r.ok) warns.push('⚠️ GitHub token');
  } else { results.github = '❌ غير مُهيأ'; }
  if (config.youtube.client_id && config.youtube.refresh_token) {
    const token = await ytGetAccessToken(config.youtube);
    results.youtube = token ? '✅ سليم' : '❌ منتهي'; if (!token) warns.push('⚠️ YouTube token');
  } else { results.youtube = '⚪ غير مُهيأ'; }
  return { success: true, data: { results, warnings: warns, all_ok: warns.length === 0 } };
}

export async function get_status(uid) {
  const [config, plan, schedules] = await Promise.all([memory.getConfig(uid), memory.getPlan(uid), memory.listSchedules(uid)]);
  const fajr = calcFajr(parseFloat(config.settings.location_lat) || 30.0444, parseFloat(config.settings.location_lng) || 31.2357);
  return {
    success: true,
    data: {
      fajr: fajr?.formatted || '?',
      plan_date: plan?.date || 'none', plan_status: plan?.status || 'idle',
      published_today: plan?.published_count || 0, total_slots: plan?.slots?.length || 0,
      github: config.github.status, youtube: config.youtube.status,
      active_schedules: schedules.length,
      schedules: schedules.map(s => `"${s.label}" ${pad(s.cron_hour)}:${pad(s.cron_minute)}`),
    },
  };
}

export async function fetch_github(uid, { path }) {
  const config = await memory.getConfig(uid);
  if (!config.github.token) return { success: false, error: 'GitHub غير مُهيأ' };
  const { ok, data } = await ghFetch('GET', path, config.github.token);
  if (!ok) return { success: false, error: `GitHub ${path} فشل` };
  if (Array.isArray(data)) return { success: true, data: { count: data.length, items: data.slice(0, 20).map(i => i.name || i.tag_name || i.id) } };
  return { success: true, data };
}

export async function update_settings(uid, args) {
  const fields  = ['location_lat', 'location_lng', 'posts_per_day', 'fajr_offset_minutes', 'github_dispatch_token'];
  const updates = {};
  for (const f of fields) { if (args[f] != null) updates[f] = String(args[f]); }
  if (!Object.keys(updates).length) return { success: false, error: 'لا إعدادات مُرسَلة' };
  await memory.patchConfig(uid, { settings: updates });
  return { success: true, updated: updates };
}

export async function build_daily_plan(uid) {
  const config = await memory.getConfig(uid);
  const cfg    = config.settings;
  const fajr   = calcFajr(parseFloat(cfg.location_lat) || 30.0444, parseFloat(cfg.location_lng) || 31.2357);
  if (!fajr) return { success: false, error: 'تعذّر حساب الفجر' };
  const yt  = config.youtube;
  const platforms = [];
  if (yt.status === 'verified' || (yt.client_id && yt.refresh_token)) platforms.push('youtube');
  if (!platforms.length) return { success: false, error: 'YouTube غير مُهيأ' };
  const gh = config.github;
  if (!gh.token) return { success: false, error: 'GitHub token غير موجود' };
  const videos = await getPendingVideos(gh.repo_owner, gh.repo_name, gh.token);
  if (!videos.length) return { success: false, error: 'لا فيديوهات في pending' };
  const off   = parseInt(cfg.fajr_offset_minutes) || 30;
  const ppd   = Math.min(10, parseInt(cfg.posts_per_day) || 4);
  const slots = makeDefaultSlots(fajr.hours, fajr.minutes + off, ppd);
  const schedule = slots.map((t, i) => ({
    time: t, platform: platforms[i % platforms.length],
    video: videos[i]?.base || `video_${i + 1}`, videoUrl: videos[i]?.url || null,
    mdUrl: videos[i]?.mdUrl || null, assetId: videos[i]?.id || null,
    mdAssetId: videos[i]?.mdId || null, status: 'pending',
  }));
  const today = cairoToday();
  await memory.savePlan(uid, { date: today, fajr: fajr.formatted, status: 'active', published_count: 0, slots: schedule });
  return { success: true, data: { date: today, fajr: fajr.formatted, slots: schedule.length, schedule: schedule.map(s => `• ${s.time} → ${s.platform} | ${s.video}`).join('\n') } };
}

export async function create_schedule(uid, { label, task, task_args = {}, user_prompt = '', cron_hour, cron_minute, days = null }) {
  if (!label) return { success: false, error: 'label مطلوب' };
  if (cron_hour == null || cron_minute == null) return { success: false, error: 'cron_hour و cron_minute مطلوبان' };
  const h = parseInt(cron_hour), m = parseInt(cron_minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) return { success: false, error: 'الساعة 0-23، الدقيقة 0-59' };
  const result = await memory.createSchedule(uid, { label, task: task || 'custom', task_args, user_prompt, cron_hour: h, cron_minute: m, days });
  return { success: true, data: { message: `✅ جدول "${label}" كل يوم ${pad(h)}:${pad(m)}`, sid: result.sid, next_run: result.next_run, days: days ? `${days} يوم` : 'بلا نهاية' } };
}

export async function list_schedules(uid) {
  const scheds = await memory.listSchedules(uid);
  if (!scheds.length) return { success: true, data: { count: 0, message: 'لا جداول نشطة' } };
  return { success: true, data: { count: scheds.length, schedules: scheds.map(s => ({ id: s.id, label: s.label, time: `${pad(s.cron_hour)}:${pad(s.cron_minute)}`, task: s.task, days_left: s.days_left, next_run: s.next_run })) } };
}

export async function delete_schedule(uid, { sid }) {
  if (!sid) return { success: false, error: 'sid مطلوب' };
  await memory.deleteSchedule(uid, sid);
  return { success: true, data: { message: `تم إلغاء ${sid}` } };
}

// read_file — يقرأ ملفاً مرفوعاً من Firestore
export async function read_file(uid, { file_id, extract = 'text' }) {
  if (!file_id) return { success: false, error: 'file_id مطلوب' };
  const fileData = await memory.getUploadedFile(uid, file_id);
  if (!fileData) return { success: false, error: `ملف ${file_id} غير موجود` };
  return {
    success: true,
    data: {
      name:     fileData.name,
      type:     fileData.mimeType,
      size:     fileData.size,
      content:  fileData.textContent || null,
      encoding: fileData.encoding    || 'base64',
      message:  `ملف "${fileData.name}" (${fileData.mimeType}) — ${fileData.size} bytes`,
    },
  };
}

// ================================================================
// DISPATCHER
// ================================================================
export const TOOL_LABELS = {
  save_credentials:    '💾 حفظ البيانات',
  verify_connection:   '🔍 التحقق',
  list_pending_videos: '📹 الفيديوهات',
  build_daily_plan:    '📅 الخطة',
  health_check:        '🏥 فحص الصحة',
  get_status:          '📊 الحالة',
  fetch_github:        '🔗 GitHub',
  update_settings:     '⚙️ الإعدادات',
  create_schedule:     '🗓️ جدول جديد',
  list_schedules:      '📋 الجداول',
  delete_schedule:     '🗑️ حذف جدول',
  read_file:           '📄 قراءة ملف',
};

export async function executeTool(uid, name, args = {}) {
  try {
    switch (name) {
      case 'save_credentials':    return await save_credentials(uid, args);
      case 'verify_connection':   return await verify_connection(uid, args);
      case 'list_pending_videos': return await list_pending_videos(uid);
      case 'build_daily_plan':    return await build_daily_plan(uid);
      case 'health_check':        return await health_check(uid);
      case 'get_status':          return await get_status(uid);
      case 'fetch_github':        return await fetch_github(uid, args);
      case 'update_settings':     return await update_settings(uid, args);
      case 'create_schedule':     return await create_schedule(uid, args);
      case 'list_schedules':      return await list_schedules(uid);
      case 'delete_schedule':     return await delete_schedule(uid, args);
      case 'read_file':           return await read_file(uid, args);
      default:                    return { success: false, error: `tool غير معروف: "${name}". المتاح: ${Object.keys(TOOL_LABELS).join(', ')}` };
    }
  } catch (e) {
    log('error', 'tools', `${name} threw`, { error: e.message });
    return { success: false, error: `${name}: ${e.message}` };
  }
}

// ================================================================
// TOOL_SYSTEM_PROMPT
// يُحقَن في system instruction لكل موديل
// بناء FC يدوي بـ XML actions — يشتغل مع أي موديل
// ================================================================
export const TOOL_SYSTEM_PROMPT = `
## نظام الـ Actions — Custom Function Calling

أنت تتواصل مع المستخدم في حوار متعدد الأدوار.
عندما تحتاج تنفيذ عملية أو تفكير، استخدم XML actions:

### صيغة الـ Actions

**تفكير بصوت عالٍ:**
<action type="think">
تفكيرك الداخلي هنا — يُعرض للمستخدم
</action>

**استخدام tool:**
<action type="tool" name="اسم_التول">
{"arg1":"value1","arg2":"value2"}
</action>

**تنفيذ كود JavaScript في Node.js 20:**
<action type="exec" lang="js">
// كود يُنفَّذ فعلاً في Node.js
// متاح: globalThis.fetch, globalThis.__config__ (config المستخدم)
// مثال:
const r = await fetch('https://api.github.com/user', {
  headers: { Authorization: 'token ' + globalThis.__config__.github.token }
});
return await r.json();
</action>

**قواعد مهمة:**
1. النص خارج الـ actions = ردك النهائي للمستخدم
2. يمكنك مزج actions مع نص توضيحي
3. بعد كل action، تتلقى النتيجة وتكمل
4. لا تضع أكثر من action واحدة لكل نوع في نفس الرد
5. الكود في exec يشتغل فعلاً — استخدمه للمهام التي لا تغطيها الـ tools

---

## الـ Tools المتاحة

### save_credentials — حفظ tokens
args: { platform: "github|youtube|settings", data: { token?, repo_owner?, repo_name?, client_id?, client_secret?, refresh_token?, access_token?, github_dispatch_token? } }
مثال:
<action type="tool" name="save_credentials">
{"platform":"github","data":{"token":"ghp_xxx","repo_owner":"user","repo_name":"videos"}}
</action>

### verify_connection — اختبار الاتصال
args: { platform: "github|youtube" }
<action type="tool" name="verify_connection">
{"platform":"github"}
</action>

### list_pending_videos — قائمة الفيديوهات
args: {} (لا يوجد)

### build_daily_plan — خطة النشر اليومية
args: {} (يبني الخطة تلقائياً من الإعدادات)

### health_check — فحص التوكنز
args: {} (لا يوجد)

### get_status — حالة النظام الكاملة
args: {} (لا يوجد)

### fetch_github — استعلام GitHub API
args: { path: "/repos/owner/repo/releases" }
أمثلة: /repos/{owner}/{repo}/releases, /repos/{owner}/{repo}/contents/, /user

### update_settings — تحديث الإعدادات
args: { location_lat?, location_lng?, posts_per_day?, fajr_offset_minutes?, github_dispatch_token? }

### create_schedule — جدولة مهمة يومية
args: { label, task: "build_daily_plan|health_check|custom", user_prompt?, cron_hour: 0-23, cron_minute: 0-59, days?: number }
مثال: خطة يومية لمدة شهر الساعة 12:
<action type="tool" name="create_schedule">
{"label":"خطة يومية الظهر","task":"build_daily_plan","cron_hour":12,"cron_minute":0,"days":30}
</action>

### list_schedules — الجداول النشطة
args: {} (لا يوجد)

### delete_schedule — إلغاء جدول
args: { sid: "sched_xxx" }

### read_file — قراءة ملف مرفوع
args: { file_id: "file_xxx" }
يُستخدم عند رفع المستخدم ملفاً وطلب قراءته أو تحليله

---

## Code Execution — متى تستخدمه؟

استخدم <action type="exec" lang="js"> عندما تحتاج:
- جلب بيانات من API خارجي غير مغطى بالـ tools
- معالجة بيانات أو حسابات معقدة
- التحقق من شيء ما في GitHub أو YouTube مباشرة
- أي مهمة تحتاج كود مخصص

الكود يُنفَّذ في Node.js 20 مع:
- fetch() متاح (Node 18+)
- __config__ = بيانات المستخدم (github.token, youtube.*, إلخ)
- كل مكتبات Node.js المدمجة (fs, path, crypto, إلخ)
- return القيمة المطلوبة من الدالة الرئيسية
`;
