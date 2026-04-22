# memory.md — هيكل الذاكرة

## OFOQ Agent v5.0 — Firebase Firestore Schema

---

## نظرة عامة

كل بيانات المستخدم مخزّنة في Firebase Firestore.
لا KV, لا D1, لا GitHub files — فقط Firestore.

**المبدأ:** كل مستخدم له مساحة معزولة تماماً بـ `uid` الخاص به.

---

## هيكل Firestore الكامل

```
/users/{uid}/
├── config/
│   └── main              ← الإعدادات والـ tokens
│       ├── github: { token, repo_owner, repo_name, status, last_verified }
│       ├── youtube: { client_id, client_secret, refresh_token, access_token, status }
│       └── settings: { location_lat, location_lng, posts_per_day, fajr_offset_minutes }
│
├── conversations/
│   └── {convId}/         ← محادثة واحدة
│       ├── status: 'pending' | 'thinking' | 'running' | 'done' | 'error'
│       ├── created_at: timestamp
│       ├── thinking_chunks: string[]  ← يُضاف chunk بـ chunk (real-time)
│       ├── tool_updates: string[]     ← "💾 حفظ البيانات..." إلخ
│       ├── final_response: string     ← الرد النهائي
│       ├── error: string | null
│       └── messages: [
│           { role: 'user', content: '...', timestamp },
│           { role: 'assistant', content: '...', timestamp }
│       ]
│
├── plan/
│   └── current           ← خطة اليوم الحالية
│       ├── date: "2025-04-12"
│       ├── fajr: "04:48"
│       ├── status: 'active' | 'idle' | 'completed'
│       ├── published_count: 2
│       └── slots: [
│           { time, platform, video, videoUrl, mdUrl, status: 'pending'|'published'|'failed' }
│       ]
│
└── log/
    └── entries           ← آخر 100 عملية
        └── items: [
            { ts, time, platform, video, status, detail }
        ]
```

---

## Config Schema (التفاصيل)

### github section:
```typescript
{
  token:         string  // GitHub Personal Access Token
  repo_owner:    string  // اسم المستخدم
  repo_name:     string  // اسم الـ repo للفيديوهات
  status:        'not_configured' | 'verified' | 'error'
  last_verified: ISO string | null
}
```

### youtube section:
```typescript
{
  client_id:     string  // OAuth 2.0 Client ID
  client_secret: string  // OAuth 2.0 Client Secret
  refresh_token: string  // Refresh Token (لا ينتهي)
  access_token:  string  // Access Token (ينتهي بعد ساعة)
  status:        'not_configured' | 'verified' | 'error'
  last_verified: ISO string | null
}
```

### settings section:
```typescript
{
  location_lat:        string  // "30.0444" — القاهرة
  location_lng:        string  // "31.2357"
  fajr_offset_minutes: string  // "30" — دقائق بعد الفجر
  posts_per_day:       string  // "4" — 1 to 10
}
```

---

## Conversation Flow في Firestore

### الخطوات:
```
1. Frontend يكتب conversation document بـ status: 'pending'
   ↓
2. GitHub Action يقرأ الـ conversation
   ↓
3. يُحدَّث status إلى 'thinking'
   ↓
4. Gemini thinking chunks تُكتب في thinking_chunks[] chunk بـ chunk
   ↓
5. Tool calls تُكتب في tool_updates[]
   ↓
6. يُحدَّث status إلى 'running' (بعد thinking)
   ↓
7. Final response تُكتب في final_response
   ↓
8. يُحدَّث status إلى 'done'
   ↓
9. Frontend onSnapshot يشوف status='done' ويعرض كل شيء
```

### Security Rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    // المستخدم يقرأ/يكتب بياناته فقط
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## Memory Operations في الكود

### قراءة الـ config:
```javascript
const config = await memory.getConfig(uid);
const ghToken = config.github.token;
```

### حفظ credentials:
```javascript
await memory.patchConfig(uid, { github: { token: 'ghp_...', status: 'verified' } });
```

### تحديث conversation:
```javascript
// إضافة thinking chunk
await memory.appendThinking(uid, convId, chunkText);

// إضافة tool update
await memory.appendUpdate(uid, convId, '💾 جارٍ الحفظ...');

// إنهاء الـ conversation
await memory.finishConversation(uid, convId, finalText);
```

### الـ Plan:
```javascript
await memory.savePlan(uid, { date, fajr, slots, status: 'active' });
await memory.updateSlotStatus(uid, slotIndex, 'published', result.url);
```

---

## القيم الافتراضية لمستخدم جديد

```javascript
const DEFAULT_CONFIG = {
  github:  { token: '', repo_owner: '', repo_name: '', status: 'not_configured', last_verified: null },
  youtube: { client_id: '', client_secret: '', refresh_token: '', access_token: '', status: 'not_configured', last_verified: null },
  settings: { location_lat: '30.0444', location_lng: '31.2357', fajr_offset_minutes: '30', posts_per_day: '4' }
};
```
