# OFOQ Tools — Helper Functions Reference
# هذه الدوال جاهزة للاستخدام المباشر في أي exec block

## كيفية الاستخدام
انسخ الدالة المطلوبة واستخدمها مباشرة في كودك.
المتغيرات المتاحة دائماً:
- `__mem`  → نص memory.md الحالي
- `__uid`  → Firebase UID للمستخدم
- `fetch`  → HTTP client

---

## 1. getMemVal(key) — قراءة قيمة من CONFIG

```js
function getMemVal(key) {
  const lines = __mem.split('\n');
  const line  = lines.find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  const val = line.slice(key.length + 1).trim();
  return val === 'null' ? null : val;
}
// مثال: const token = getMemVal('github_token');
```

---

## 2. updateMemSection(section, newContent) — تحديث section في memory

```js
async function updateMemSection(section, newContent) {
  const sectionRe = new RegExp(
    `(## ${section}\\n)[\\s\\S]*?(?=\\n## |$)`, 'g'
  );
  const updated = __mem.replace(sectionRe, `## ${section}\n${newContent}\n`);
  // احفظ في Firestore
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
  const db = getFirestore();
  await db.doc(`users/${__uid}/memory/doc`).set({ content: updated, updated_at: new Date().toISOString() });
  return updated;
}
// مثال:
// await updateMemSection('CONFIG', 'github_token: ghp_xxx\ngithub_status: verified\n...');
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
    body: body ? JSON.stringify(body) : null,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
// مثال: const { ok, data } = await ghFetch('/user', getMemVal('github_token'));
```

---

## 4. ytRefresh(clientId, secret, refreshToken) — تجديد YouTube Access Token

```js
async function ytRefresh(clientId, secret, refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: secret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token || null;
}
// مثال: const token = await ytRefresh(client_id, client_secret, refresh_token);
```

---

## 5. getPendingVideos(owner, repo, token) — فيديوهات GitHub pending

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
      const md   = assets.find(x => x.name === `${base}.md`);
      return { id: a.id, name: a.name, base, url: a.browser_download_url, size: a.size, mdUrl: md?.browser_download_url || null };
    });
}
```

---

## 6. calcFajr(lat, lng, date?) — حساب وقت الفجر

```js
function calcFajr(lat, lng, date = new Date()) {
  const D2R = Math.PI / 180;
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
  const JD = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + d - 1524.5;
  const n  = JD - 2451545.0;
  const L  = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g  = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = 23.439 * D2R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const RA  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const noon = 12 - lng / 15 - ((L * D2R - RA) * 12 / Math.PI) + 2;
  const cosH = (Math.sin(-18 * D2R) - Math.sin(lat * D2R) * Math.sin(dec)) / (Math.cos(lat * D2R) * Math.cos(dec));
  if (Math.abs(cosH) > 1) return null;
  const fTime = (((noon - Math.acos(cosH) * 12 / Math.PI) % 24) + 24) % 24;
  const hh = Math.floor(fTime), mm = Math.floor((fTime - hh) * 60);
  return { h: hh, m: mm, fmt: `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}` };
}
// مثال: const fajr = calcFajr(30.0444, 31.2357);
```

---

## 7. makeSlots(startH, startM, count) — توزيع مواعيد النشر

```js
function makeSlots(startH, startM, count) {
  let s = startH * 60 + startM;
  const e = 23 * 60;
  if (s >= e) s = 6 * 60 + 30;
  const base = Math.floor((e - s) / Math.max(count, 1));
  const out  = [];
  for (let i = 0; i < count; i++) {
    const jitter = Math.floor(Math.random() * 16) - 8;
    const t = Math.min(e - 1, Math.max(s, s + i * base + jitter));
    out.push(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`);
  }
  return out.sort();
}
// مثال: const slots = makeSlots(fajr.h, fajr.m + 30, 4);
```

---

## 8. fbDb() — Firestore instance

```js
async function fbDb() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore();
}
// مثال: const db = await fbDb(); const doc = await db.doc('users/uid/memory/doc').get();
```

---

## 9. sleep(ms) — انتظار

```js
const sleep = ms => new Promise(r => setTimeout(r, ms));
// مثال: await sleep(2000);
```

---

## 10. cairoNow() — الوقت الحالي بتوقيت القاهرة

```js
function cairoNow() {
  return new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
}
function cairoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // YYYY-MM-DD
}
```
