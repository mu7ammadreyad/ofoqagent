// tools.js — OFOQ Agent v5.0
// Tool implementations — see md/tools.md for full documentation

import * as memory from './memory.js';
import { ghFetch, getPendingVideos } from './publishers/github.js';
import { ytGetAccessToken }         from './publishers/youtube.js';
import { calcFajr, makeDefaultSlots, cairoToday, log } from './helpers.js';

// ================================================================
// Tool: save_credentials
// ================================================================
export async function save_credentials(uid, { platform, data }) {
  const allowed = ['github', 'youtube', 'settings'];
  if (!platform || !data)         return { success: false, error: 'platform و data مطلوبان' };
  if (!allowed.includes(platform)) return { success: false, error: `v1 يدعم: ${allowed.join(', ')} فقط` };

  await memory.patchConfig(uid, { [platform]: data });
  log('ok', 'tools', `save_credentials: ${platform}`, { keys: Object.keys(data) });
  return { success: true, saved: Object.keys(data).join(', '), message: `تم حفظ بيانات ${platform} في Firebase` };
}

// ================================================================
// Tool: verify_connection
// ================================================================
export async function verify_connection(uid, { platform }) {
  const config = await memory.getConfig(uid);

  switch (platform) {
    case 'github': {
      const gh = config.github;
      if (!gh.token) return { success: false, error: 'GitHub token غير موجود — أضفه أولاً بـ save_credentials' };
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `token ${gh.token}`, 'User-Agent': 'OFOQ-Agent/5.0' },
      });
      if (!r.ok) return { success: false, error: `GitHub API فشل: ${r.status} — تحقق من الـ token` };
      const d = await r.json();
      await memory.patchConfig(uid, { github: { status: 'verified', last_verified: new Date().toISOString() } });
      log('ok', 'tools', 'verify_connection: github', { login: d.login });
      return { success: true, data: { login: d.login, name: d.name, public_repos: d.public_repos } };
    }

    case 'youtube': {
      const yt = config.youtube;
      if (!yt.client_id || !yt.refresh_token)
        return { success: false, error: 'YouTube يحتاج: client_id + client_secret + refresh_token' };
      const token = await ytGetAccessToken(yt);
      if (!token) return { success: false, error: 'فشل تجديد YouTube token — تحقق من client_id/secret/refresh_token' };
      await memory.patchConfig(uid, {
        youtube: { status: 'verified', last_verified: new Date().toISOString(), access_token: token },
      });
      log('ok', 'tools', 'verify_connection: youtube');
      return { success: true, data: { message: 'YouTube token صالح وتم تجديده' } };
    }

    default:
      return { success: false, error: `v1 يدعم: github, youtube فقط` };
  }
}

// ================================================================
// Tool: list_pending_videos
// ================================================================
export async function list_pending_videos(uid) {
  const config = await memory.getConfig(uid);
  const gh     = config.github;
  if (!gh.token) return { success: false, error: 'GitHub غير مُهيأ — أضف token أولاً' };

  const videos = await getPendingVideos(gh.repo_owner, gh.repo_name, gh.token);
  if (!videos.length) return { success: true, data: { count: 0, message: 'لا يوجد فيديوهات في pending release' } };

  log('info', 'tools', `list_pending_videos: found ${videos.length}`);
  return {
    success: true,
    data: {
      count:  videos.length,
      videos: videos.slice(0, 10).map(v => ({
        name:     v.base,
        size_mb:  (v.size / 1024 / 1024).toFixed(1),
        has_meta: !!v.mdUrl,
      })),
    },
  };
}

// ================================================================
// Tool: health_check
// ================================================================
export async function health_check(uid) {
  const config  = await memory.getConfig(uid);
  const results = {}, warns = [];

  // GitHub
  if (config.github.token) {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${config.github.token}`, 'User-Agent': 'OFOQ-Agent/5.0' },
    });
    results.github = r.ok ? '✅ سليم' : '❌ فشل';
    if (!r.ok) warns.push('⚠️ GitHub token منتهي أو خاطئ');
  } else {
    results.github = '❌ غير مُهيأ';
  }

  // YouTube
  if (config.youtube.client_id && config.youtube.refresh_token) {
    const token = await ytGetAccessToken(config.youtube);
    results.youtube = token ? '✅ سليم' : '❌ Token منتهي';
    if (!token) warns.push('⚠️ YouTube refresh_token منتهي — يحتاج تجديد');
  } else {
    results.youtube = '⚪ غير مُهيأ';
  }

  log('info', 'tools', 'health_check done', results);
  return { success: true, data: { results, warnings: warns, all_ok: warns.length === 0 } };
}

// ================================================================
// Tool: get_status
// ================================================================
export async function get_status(uid) {
  const [config, plan] = await Promise.all([memory.getConfig(uid), memory.getPlan(uid)]);
  const fajr = calcFajr(
    parseFloat(config.settings.location_lat)  || 30.0444,
    parseFloat(config.settings.location_lng) || 31.2357,
  );
  return {
    success: true,
    data: {
      fajr:            fajr?.formatted || '?',
      plan_active:     plan?.status === 'active',
      published_today: plan?.published_count || 0,
      total_slots:     plan?.slots?.length   || 0,
      plan_date:       plan?.date            || 'none',
      github:          config.github.status,
      youtube:         config.youtube.status,
    },
  };
}

// ================================================================
// Tool: fetch_github
// ================================================================
export async function fetch_github(uid, { path }) {
  const config = await memory.getConfig(uid);
  if (!config.github.token) return { success: false, error: 'GitHub غير مُهيأ' };
  const { ok, data } = await ghFetch('GET', path, config.github.token);
  if (!ok) return { success: false, error: `GitHub ${path}: فشل` };
  // Simplify large arrays
  if (Array.isArray(data)) {
    return { success: true, data: { count: data.length, items: data.slice(0, 20).map(i => i.name || i.tag_name || i.id) } };
  }
  return { success: true, data };
}

// ================================================================
// Tool: update_settings
// ================================================================
export async function update_settings(uid, args) {
  const fields  = ['location_lat', 'location_lng', 'posts_per_day', 'fajr_offset_minutes'];
  const updates = {};
  for (const f of fields) {
    if (args[f] != null) updates[f] = String(args[f]);
  }
  if (!Object.keys(updates).length) return { success: false, error: 'لم تُرسَل أي إعدادات' };
  await memory.patchConfig(uid, { settings: updates });
  log('ok', 'tools', 'update_settings', updates);
  return { success: true, updated: updates };
}

// ================================================================
// Tool: build_daily_plan
// NOTE: This tool builds the plan and saves it to Firestore.
//       The actual workflow trigger happens in agent.js after
//       the tool returns success.
// ================================================================
export async function build_daily_plan(uid) {
  const config = await memory.getConfig(uid);
  const cfg    = config.settings;
  const lat    = parseFloat(cfg.location_lat)      || 30.0444;
  const lng    = parseFloat(cfg.location_lng)      || 31.2357;
  const off    = parseInt(cfg.fajr_offset_minutes) || 30;
  const ppd    = Math.min(10, parseInt(cfg.posts_per_day) || 4);

  const fajr = calcFajr(lat, lng);
  if (!fajr) return { success: false, error: 'تعذّر حساب وقت الفجر' };

  // Only YouTube in v1
  const platforms = [];
  const yt = config.youtube;
  if (yt.status === 'verified' || (yt.client_id && yt.refresh_token)) platforms.push('youtube');
  if (!platforms.length) return { success: false, error: 'YouTube غير مُهيأ — أضف credentials وتحقق منها أولاً' };

  const gh = config.github;
  if (!gh.token) return { success: false, error: 'GitHub token غير موجود' };

  const videos = await getPendingVideos(gh.repo_owner, gh.repo_name, gh.token);
  if (!videos.length) return { success: false, error: 'لا يوجد فيديوهات في GitHub Release pending' };

  const slots    = makeDefaultSlots(fajr.hours, fajr.minutes + off, ppd);
  const schedule = slots.map((t, i) => ({
    time:      t,
    platform:  platforms[i % platforms.length],
    video:     videos[i]?.base  || `video_${i + 1}`,
    videoUrl:  videos[i]?.url   || null,
    mdUrl:     videos[i]?.mdUrl || null,
    assetId:   videos[i]?.id    || null,
    mdAssetId: videos[i]?.mdId  || null,
    status:    'pending',
  }));

  const today = cairoToday();
  await memory.savePlan(uid, {
    date:            today,
    fajr:            fajr.formatted,
    status:          'active',
    published_count: 0,
    slots:           schedule,
  });

  log('ok', 'tools', `build_daily_plan: ${today}`, { slots: schedule.length, fajr: fajr.formatted });

  const lines = schedule.map(s => `• ${s.time} → ${s.platform.padEnd(8)} | ${s.video}`).join('\n');
  return {
    success: true,
    data: {
      date:     today,
      fajr:     fajr.formatted,
      slots:    schedule.length,
      schedule: lines,
    },
  };
}

// ================================================================
// Tool Dispatcher
// ================================================================
export const TOOL_LABELS = {
  save_credentials:    '💾 حفظ البيانات',
  verify_connection:   '🔍 التحقق من الاتصال',
  list_pending_videos: '📹 جلب الفيديوهات',
  build_daily_plan:    '📅 بناء الخطة',
  health_check:        '🏥 فحص الصحة',
  get_status:          '📊 حالة النظام',
  fetch_github:        '🔗 GitHub API',
  update_settings:     '⚙️ تحديث الإعدادات',
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
      default:                    return { success: false, error: `tool غير معروف: ${name}` };
    }
  } catch (e) {
    log('error', 'tools', `${name} exception`, { error: e.message });
    return { success: false, error: `${name}: ${e.message}` };
  }
}

// ================================================================
// Tool Declarations (Gemini Function Calling Schema)
// ================================================================
export const TOOL_DECLARATIONS = [
  {
    name:        'save_credentials',
    description: 'حفظ بيانات تسجيل دخول منصة في Firebase. استخدمها فوراً عند استقبال أي token أو ID.',
    parameters:  {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', description: 'github | youtube | settings' },
        data: {
          type: 'OBJECT',
          description: 'البيانات: token, repo_owner, repo_name, client_id, client_secret, refresh_token, access_token',
          properties: {
            token:         { type: 'STRING' }, repo_owner:    { type: 'STRING' },
            repo_name:     { type: 'STRING' }, client_id:     { type: 'STRING' },
            client_secret: { type: 'STRING' }, refresh_token: { type: 'STRING' },
            access_token:  { type: 'STRING' },
          },
        },
      },
      required: ['platform', 'data'],
    },
  },
  {
    name:        'verify_connection',
    description: 'التحقق من صحة الـ token لـ github أو youtube. استخدمها بعد أي save_credentials مباشرة.',
    parameters:  { type: 'OBJECT', properties: { platform: { type: 'STRING', description: 'github | youtube' } }, required: ['platform'] },
  },
  {
    name:        'list_pending_videos',
    description: 'عرض قائمة الفيديوهات المعلقة في GitHub Release pending وعدها.',
    parameters:  { type: 'OBJECT', properties: {} },
  },
  {
    name:        'build_daily_plan',
    description: 'بناء خطة النشر اليومية وحفظها. تستدعى عند طلب البدء في النشر.',
    parameters:  { type: 'OBJECT', properties: {} },
  },
  {
    name:        'health_check',
    description: 'فحص صحة جميع التوكنز وعرض التقرير.',
    parameters:  { type: 'OBJECT', properties: {} },
  },
  {
    name:        'get_status',
    description: 'عرض الحالة الكاملة للنظام: المنصات، الخطة، وقت الفجر، الإحصائيات.',
    parameters:  { type: 'OBJECT', properties: {} },
  },
  {
    name:        'fetch_github',
    description: 'استعلام GitHub API. مثال: /repos/owner/repo/releases',
    parameters:  { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'مسار API مثل /repos/owner/repo/releases' } }, required: ['path'] },
  },
  {
    name:        'update_settings',
    description: 'تحديث إعدادات الموقع وجدول النشر.',
    parameters:  {
      type: 'OBJECT',
      properties: {
        location_lat:        { type: 'STRING' },
        location_lng:        { type: 'STRING' },
        posts_per_day:       { type: 'STRING' },
        fajr_offset_minutes: { type: 'STRING' },
      },
    },
  },
];
