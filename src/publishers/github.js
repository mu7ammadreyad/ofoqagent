// publishers/github.js — OFOQ Agent v5.0
// GitHub API — videos from Releases only

export function ghHeaders(token) {
  return {
    Authorization:  `token ${token}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent':   'OFOQ-Agent/5.0',
  };
}

export async function ghFetch(method, path, token, body = null) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: ghHeaders(token),
    body:    body ? JSON.stringify(body) : null,
  });
  let data;
  try { data = await r.json(); } catch { data = {}; }
  return { ok: r.ok, status: r.status, data };
}

export async function getPendingVideos(owner, repo, token) {
  if (!token || !owner || !repo) return [];
  const { ok, data: releases } = await ghFetch('GET', `/repos/${owner}/${repo}/releases`, token);
  if (!ok || !Array.isArray(releases)) return [];
  const rel = releases.find(r => r.tag_name === 'pending');
  if (!rel) return [];
  const { data: assets } = await ghFetch('GET', `/repos/${owner}/${repo}/releases/${rel.id}/assets`, token);
  if (!Array.isArray(assets)) return [];
  return assets
    .filter(a => /\.(mp4|mov|avi|mkv|webm)$/i.test(a.name))
    .map(a => {
      const base = a.name.replace(/\.[^.]+$/, '');
      const md   = assets.find(x => x.name === `${base}.md`);
      return {
        id:    a.id,
        name:  a.name,
        base,
        url:   a.browser_download_url,
        size:  a.size,
        mdId:  md?.id                  || null,
        mdUrl: md?.browser_download_url || null,
      };
    });
}

export async function readVideoMeta(mdUrl, token) {
  if (!mdUrl) return { title: '', description: '', tags: [] };
  const r = await fetch(mdUrl, { headers: ghHeaders(token) });
  if (!r.ok) return { title: '', description: '', tags: [] };
  const text = await r.text();
  const meta = { title: '', description: '', tags: [] };
  let inDesc = false;
  for (const line of text.split('\n')) {
    if      (line.startsWith('# '))                       { meta.title = line.slice(2).trim(); inDesc = false; }
    else if (/^## (وصف|description)/i.test(line))        { inDesc = true; }
    else if (/^## /.test(line))                           { inDesc = false; }
    else if (/^(tags|وسوم|هاشتاقات)\s*:/i.test(line))    { meta.tags = line.split(':')[1]?.split(/[,،]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean) || []; }
    else if (inDesc && line.trim())                       { meta.description += (meta.description ? '\n' : '') + line.trim(); }
  }
  return meta;
}

export async function deleteReleaseAsset(owner, repo, token, assetId) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    method:  'DELETE',
    headers: ghHeaders(token),
  });
  return r.ok;
}

export async function removeFromPending(owner, repo, token, video) {
  for (const id of [video.id, video.mdId].filter(Boolean)) {
    await deleteReleaseAsset(owner, repo, token, id);
  }
}
