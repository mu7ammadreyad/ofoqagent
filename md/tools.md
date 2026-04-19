# OFOQ Tools — Helper Functions Reference
# كل الدوال متاحة تلقائياً في exec blocks

## المتغيرات المتاحة دائماً
- `__mem`  → نص memory.md الحالي
- `__uid`  → Firebase UID
- `fetch`  → HTTP client محسّن

---

## 1. getMemVal(key) — قراءة قيمة من memory

```js
function getMemVal(key) {
  const line = __mem.split('\n').find(l => l.startsWith(key + ':'));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return (val === 'null' || val === '') ? null : val;
}
```

---

## 2. تحديث memory — عبر return فقط (لا firebase-admin)

```js
// لتحديث section في memory.md، أعد هذا الشكل:
return {
  __mem_update__: {
    section: 'CONFIG',
    content: [
      'github_token: ghp_xxx',
      'github_repo_owner: myuser',
      'github_repo_name: myrepo',
      'github_status: verified',
    ].join('\n')
  },
  message: 'تم الحفظ بنجاح'
};
// agent.js هو من يكتب في Firestore تلقائياً
```

---

## 3. ghFetch(path, token, method?, body?) — GitHub API

```js
async function ghFetch(path, token, method = 'GET', body = null) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'OFOQ-Agent/6.0',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
```

---

## 4. ytRefresh(clientId, secret, refreshToken) — YouTube Token

```js
async function ytRefresh(clientId, secret, refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token || null;
}
```

---

## 5. getPendingVideos(owner, repo, token) — فيديوهات pending

```js
async function getPendingVideos(owner, repo, token) {
  const { ok, data: releases } = await ghFetch(`/repos/${owner}/${repo}/releases`, token);
  if (!ok || !Array.isArray(releases)) return [];
  const rel = releases.find(r => r.tag_name === 'pending');
  if (!rel) return [];
  const { data: assets } = await ghFetch(`/repos/${owner}/${repo}/releases/${rel.id}/assets`, token);
  if (!Array.isArray(assets)) return [];
  return assets
    .filter(a => /\.(mp4|mov|webm|mkv)$/i.test(a.name))
    .map(a => {
      const base = a.name.replace(/\.[^.]+$/, '');
      const md = assets.find(x => x.name === `${base}.md`);
      return {
        id: a.id, name: a.name, base,
        url: a.browser_download_url,
        size: a.size,
        mdUrl: md?.browser_download_url || null,
      };
    });
}
```

---

## 6. calcFajr(lat, lng, date?) — حساب وقت الفجر

```js
function calcFajr(lat, lng, date = new Date()) {
  const D2R = Math.PI / 180;
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
  const JD = Math.floor(365.25*(y+4716)) + Math.floor(30.6001*(mo+1)) + d - 1524.5;
  const n = JD - 2451545.0;
  const L = ((280.460 + 0.9856474*n) % 360 + 360) % 360;
  const g = ((357.528 + 0.9856003*n) % 360) * D2R;
  const lam = (L + 1.915*Math.sin(g) + 0.020*Math.sin(2*g)) * D2R;
  const eps = 23.439 * D2R;
  const dec = Math.asin(Math.sin(eps)*Math.sin(lam));
  const RA = Math.atan2(Math.cos(eps)*Math.sin(lam), Math.cos(lam));
  const noon = 12 - lng/15 - ((L*D2R - RA)*12/Math.PI) + 2;
  const cosH = (Math.sin(-18*D2R) - Math.sin(lat*D2R)*Math.sin(dec)) / (Math.cos(lat*D2R)*Math.cos(dec));
  if (Math.abs(cosH) > 1) return null;
  const fTime = (((noon - Math.acos(cosH)*12/Math.PI) % 24) + 24) % 24;
  const hh = Math.floor(fTime), mm = Math.floor((fTime-hh)*60);
  const p = n => String(n).padStart(2,'0');
  return { h: hh, m: mm, fmt: `${p(hh)}:${p(mm)}` };
}
```

---

## 7. makeSlots(startH, startM, count) — مواعيد النشر

```js
function makeSlots(startH, startM, count) {
  let s = startH*60 + startM;
  const e = 23*60;
  if (s >= e) s = 6*60+30;
  const base = Math.floor((e-s) / Math.max(count,1));
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random()*16)-8;
    const t = Math.min(e-1, Math.max(s, s+i*base+j));
    const p = n => String(n).padStart(2,'0');
    out.push(`${p(Math.floor(t/60))}:${p(t%60)}`);
  }
  return out.sort();
}
```

---

## 8. sleep(ms) — انتظار

```js
const sleep = ms => new Promise(r => setTimeout(r, ms));
```

---

## 9. cairoDate() / cairoNow() — توقيت القاهرة

```js
function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}
function cairoNow() {
  return new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
}
```

---

## مثال كامل — حفظ GitHub token

```
// هذا مثال للـ AI — ليس كوداً يُحقَن في الـ sandbox
// اكتب كودك في exec block داخل المحادثة

const token = getMemVal('github_token');
const { ok, data } = await ghFetch('/user', token);
if (!ok) return { success: false, error: 'GitHub فشل: ' + data.message };

return {
  __mem_update__: {
    section: 'CONFIG',
    content: [
      'github_token: ' + token,
      'github_status: verified',
      // باقي الـ settings كما هي في memory
    ].join('\n')
  },
  message: '✅ تم التحقق من GitHub'
};
```
