# OFOQ Agent v6.0

مساعد ذكي متكامل قادر على تنفيذ **أي مهمة** — برمجة، بحث، تحليل، جدولة، نشر، وأتمتة.

بُني على: **GitHub Actions** (Ubuntu VM) + **Firebase Firestore** + **Gemma 4**

---

## المعمارية

```
Frontend (index.html)
   │ repository_dispatch
   ▼
GitHub Actions → agent.js          ← محادثات عادية
GitHub Actions → scheduler.js      ← مهام مجدولة (كل دقيقة)

Firestore:
  users/{uid}/conversations/{convId}   ← المحادثات
  users/{uid}/schedules/{schedId}      ← الجداول (per-user)
  users/{uid}/config/memory            ← ذاكرة المستخدم
  schedules/{schedId}                  ← الجداول (global للـ scheduler)
```

---

## الملفات

| الملف | الدور |
|---|---|
| `src/agent.js` | ReAct loop — 15 round، بدون timeout |
| `src/scheduler.js` | يشتغل كل دقيقة، ينفذ المهام الحانة |
| `src/tools.js` | Shell + Memory + Scheduling functions |
| `skills/soul.md` | شخصية الـ AI ومنهجية تفكيره |
| `skills/tools.md` | دليل shell شامل (1300+ سطر) |
| `skills/memory.md` | قالب الذاكرة الابتدائي |
| `public/index.html` | واجهة المستخدم |
| `.github/workflows/agent.yml` | GitHub Action للمحادثات |
| `.github/workflows/scheduler.yml` | GitHub Action للجدولة (كل دقيقة) |

---

## الإعداد

### 1. Firebase
- أنشئ مشروع في Firebase Console
- فعّل **Authentication** (Email/Password + Google)
- فعّل **Firestore**
- حمّل **Service Account** JSON

### 2. GitHub Secrets
أضف هذه الـ Secrets في `Settings → Secrets → Actions`:

| Secret | القيمة |
|---|---|
| `GEMINI_API_KEY` | مفتاح Gemini API |
| `FIREBASE_SERVICE_ACCOUNT` | محتوى ملف Service Account JSON |

### 3. Frontend
في `public/index.html` عدّل:
```js
const FIREBASE_CONFIG = { /* من Firebase Console */ };
const GITHUB_OWNER      = "your-username";
const GITHUB_AGENT_REPO = "ofoqagent";
const GITHUB_TOKEN      = "ghp_...";  // PAT بصلاحية workflow
```

### 4. Firestore Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /schedules/{schedId} {
      allow read, write: if false; // فقط Service Account
    }
  }
}
```

---

## Actions المتاحة للـ AI

| Action | الوظيفة |
|---|---|
| `<action type="shell">` | تنفيذ bash script (بدون timeout) |
| `<action type="update_memory">` | تحديث ذاكرة المستخدم في Firestore |
| `<action type="create_schedule">` | إنشاء مهمة مجدولة متكررة |
| `<action type="list_schedules">` | عرض الجداول النشطة |
| `<action type="pause_schedule">` | إيقاف جدول |

---

## مثال على الجدولة

**المستخدم يكتب:** "أريد حكمة جديدة كل يوم الساعة 9 صباحاً"

**الـ AI يُنشئ:**
```json
{
  "name": "حكمة يومية",
  "cron": "0 9 * * *",
  "taskPrompt": "اكتب حكمة عربية أصيلة مع شرحها في سطرين",
  "timezone": "Africa/Cairo"
}
```

**النتيجة:**
- تظهر محادثة جديدة في قسم "المهام المجدولة" في الـ sidebar
- كل يوم الساعة 9 ينشئ الـ scheduler رسالة جديدة في تلك المحادثة تلقائياً
- المستخدم يفتح المحادثة ويجد كل الحكم المتراكمة

---

## الفرق عن v5

| v5 | v6 |
|---|---|
| مخصص للنشر الإسلامي فقط | general-purpose — أي مهمة |
| Sidebar يسار | Sidebar يمين (RTL) |
| إعدادات في الـ header | إعدادات في أسفل الـ sidebar |
| لا جدولة حقيقية | جدولة Firestore كاملة |
| timeout 55s للـ shell | بدون timeout |
| 8 ReAct rounds | 15 ReAct rounds |
| tools.md 141 سطر | tools.md 1300+ سطر |
| محادثات localStorage | محادثات Firestore دائمة |

---

## التحديثات في v7.0

| الميزة | التفاصيل |
|---|---|
| **ملف موحّد** | `agent.js` واحد — 1043 سطر يحتوي Tools + Agent + Scheduler |
| **AGENT_MODE** | `agent` (default) أو `scheduler` عبر env var |
| **task.md** | مفكّرة مؤقتة محلية في `/tmp` — تُحذف بنهاية الـ job |
| **write_task** | action جديدة — الـ AI يكتب خطته ونتائجه محلياً |
| **بحث عميق** | 10 أنماط في tools.md: BeautifulSoup / Playwright / Stealth / Wikipedia / Finance |
