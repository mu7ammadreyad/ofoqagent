// publishers/youtube.js — OFOQ Agent v5.0
// YouTube Data API v3 — resumable upload

import { ghHeaders } from './github.js';

export async function ytGetAccessToken(yt) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     yt.client_id,
      client_secret: yt.client_secret,
      refresh_token: yt.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token || null;
}

export async function publishYouTube(config, videoUrl, meta) {
  const yt = config.youtube;
  if (!yt.refresh_token) return { success: false, error: 'YouTube refresh_token غير موجود' };

  // Refresh access token
  const access = await ytGetAccessToken(yt);
  if (!access) return { success: false, error: 'فشل تجديد YouTube access token — تحقق من client_id/secret/refresh_token' };

  const title = meta.title || 'فيديو إسلامي';

  // Step 1: Initiate resumable upload
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method:  'POST',
      headers: {
        Authorization:          `Bearer ${access}`,
        'Content-Type':         'application/json',
        'X-Upload-Content-Type':'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: meta.description || '',
          tags:        meta.tags        || [],
          categoryId:  '27', // Education
        },
        status: { privacyStatus: 'public' },
      }),
    }
  );
  if (!init.ok) return { success: false, error: `YouTube init فشل: ${init.status}` };

  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) return { success: false, error: 'YouTube لم يُرجع upload URL' };

  // Step 2: Download video from GitHub and stream to YouTube
  const vidResp = await fetch(videoUrl, { headers: ghHeaders(config.github.token) });
  if (!vidResp.ok) return { success: false, error: `فشل جلب الفيديو من GitHub: ${vidResp.status}` };

  const up = await fetch(uploadUrl, {
    method:  'PUT',
    headers: {
      'Content-Type':   'video/mp4',
      'Content-Length': vidResp.headers.get('content-length') || '',
    },
    body:   vidResp.body,
    duplex: 'half',
  });

  if (!up.ok) return { success: false, error: `YouTube upload فشل: ${up.status}` };

  const d = await up.json();
  return { success: true, videoId: d.id, url: `https://youtu.be/${d.id}` };
}
