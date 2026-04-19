# OFOQ Publisher Agent v5.0
### نظام النشر الإسلامي الذكي — بسم الله الرحمن الرحيم

```
  ██████╗ ███████╗ ██████╗  ██████╗     ███████╗ ██████╗ ██╗
 ██╔═══██╗██╔════╝██╔═══██╗██╔═══██╗   ██╔════╝██╔════╝ ██║
 ██║   ██║█████╗  ██║   ██║██║   ██║   █████╗  ██║  ███╗██║
 ██║   ██║██╔══╝  ██║   ██║██║▄▄ ██║   ██╔══╝  ██║   ██║██║
 ╚██████╔╝██║     ╚██████╔╝╚██████╔╝   ███████╗╚██████╔╝███████╗
  ╚═════╝ ╚═╝      ╚═════╝  ╚══▀▀═╝   ╚══════╝ ╚═════╝ ╚══════╝
```

---

## الفهرس
1. [ما هو OFOQ Agent؟](#1-ما-هو-ofoq-agent)
2. [هيكل المشروع](#2-هيكل-المشروع)
3. [كيف يعمل من الصفر](#3-كيف-يعمل-من-الصفر)
4. [Custom Function Calling](#4-custom-function-calling)
5. [Code Execution](#5-code-execution)
6. [Firestore Schema](#6-firestore-schema)
7. [إعداد المشروع](#7-إعداد-المشروع)
8. [GitHub Secrets](#8-github-secrets)
9. [قبل كل deploy](#9-قبل-كل-deploy)
10. [الـ Tools المتاحة](#10-الـ-tools-المتاحة)
11. [الجدولة التلقائية](#11-الجدولة-التلقائية)
12. [رفع الملفات](#12-رفع-الملفات)
13. [استكشاف الأخطاء](#13-استكشاف-الأخطاء)

---

## 1. ما هو OFOQ Agent؟

نظام ذكاء اصطناعي يساعدك على نشر المحتوى الإسلامي تلقائياً على يوتيوب.

**المستخدم يتكلم مع الـ Agent بالعربية → الـ Agent يفكر ويخطط ويُنفَّذ تلقائياً.**

### مثال:
```
المستخدم: ابدأ النشر اليومي الساعة 6 صباحاً لمدة شهر

Agent (يفكر): سأحسب الفجر، أجلب الفيديوهات، أبني خطة، أنشئ جدولاً متكرراً...
Agent (ينفذ): ✅ خطة اليوم جاهزة | ✅ جدول "نشر الفجر" كل يوم 06:00 لـ 30 يوم
```

---

## 2. هيكل المشروع

```
ofoq-agent/
│
├── public/                      ← Firebase Hosting (Frontend)
│   └── index.html               ← التطبيق كاملاً — React-free single file
│
├── src/                         ← GitHub Actions (Backend — Node.js 20)
│   ├── agent.js                 ← Entry point + Custom FC Engine + Code Executor
│   ├── tools.js                 ← كل الـ tools + TOOL_SYSTEM_PROMPT
│   ├── memory.js                ← Firebase Admin Firestore operations
│   ├── helpers.js               ← calcFajr + utilities + logging
│   ├── scheduler.js             ← يقرأ Firestore ويُطلق المهام المجدولة
│   └── publishers/
│       ├── github.js            ← GitHub API (videos, releases)
│       └── youtube.js           ← YouTube Data API v3 (upload)
│
├── md/                          ← توثيق وإعدادات الـ AI
│   ├── soul.md                  ← شخصية الـ Agent + منهج التفكير
│   ├── tools.md                 ← توثيق الـ tools
│   ├── memory.md                ← Firestore schema
│   └── helpers.md               ← utilities documentation
│
├── .github/workflows/
│   ├── agent.yml                ← يُطلَق عند إرسال رسالة (repository_dispatch)
│   └── scheduler.yml            ← cron كل ساعة لتنفيذ المهام المجدولة
│
├── firebase.json                ← Firebase Hosting config
├── package.json                 ← Node.js 20, firebase-admin فقط
└── README.md                    ← هذا الملف
```

---

## 3. كيف يعمل من الصفر

### الرحلة الكاملة لرسالة المستخدم:

```
┌─────────────────────────────────────────────────────────────┐
│  1. المستخدم يكتب رسالة في index.html                       │
│     (Firebase Hosting — يُسرَّف من CDN مجاناً)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Frontend يكتب document في Firestore                     │
│     /users/{uid}/conversations/{convId}                     │
│     { status: "pending", user_message: "...", ... }         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Frontend يُطلق GitHub Actions بـ repository_dispatch    │
│     → GITHUB_TOKEN (في index.html) + { uid, conv_id }       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  4. GitHub Actions يُشغّل src/agent.js (Node.js 20)          │
│                                                             │
│   a) يقرأ conversation من Firestore                         │
│   b) يبني system instruction (soul.md + TOOL_SYSTEM_PROMPT) │
│   c) Thinking pass → Gemini SSE → يكتب chunks لـ Firestore │
│   d) ReAct loop → callModel() → parseActions() → execute   │
│      - <action type="think"> → appendThinking()            │
│      - <action type="tool">  → executeTool()               │
│      - <action type="exec">  → executeCode() Node.js        │
│   e) finishConversation() → status: "done"                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Frontend onSnapshot يُراقب Firestore                    │
│     - thinking_chunks جديدة → تُعرض live في bubble          │
│     - tool_updates → تُعرض كـ pills مؤقتة                   │
│     - status === "done" → يعرض final_response               │
└─────────────────────────────────────────────────────────────┘
```

### لماذا GitHub Actions بدل Server/Workers؟

| السبب | التفاصيل |
|-------|---------|
| **مجاني** | 2000 دقيقة/شهر مجاناً على الـ free plan |
| **Node.js حقيقي** | تنفيذ أي كود، أي مكتبة |
| **لا cold start** | يشتغل خلال 5-10 ثوانٍ |
| **موثوق** | 99.9% uptime من GitHub |
| **Firestore real-time** | المستخدم يشوف التفكير live |

---

## 4. Custom Function Calling

### لماذا Custom وليس Gemini Native?

**Gemini Native FC** يُرجع `thought` parts في الـ response. لو أعدتها في الـ history تحصل على خطأ:
```
"Function call is missing a thought_signature in functionCall parts"
```

**الحل** — نبني FC يدوياً:

### Format الـ Actions

الموديل يكتب XML actions في نصه. لا Gemini tools API، لا schemas، لا thought_signature:

```xml
<action type="think">
سأتحقق من GitHub token أولاً ثم أبني الخطة
</action>

<action type="tool" name="verify_connection">
{"platform":"github"}
</action>

<action type="exec" lang="js">
const r = await fetch('https://api.github.com/repos/' + globalThis.__config__.github.repo_owner + '/' + globalThis.__config__.github.repo_name + '/releases');
return await r.json();
</action>

كل شيء جاهز! ✅ GitHub متصل والـ repo فيه فيديوهات.
```

### Parser في `agent.js`

```javascript
function parseActions(raw) {
  // يبحث عن كل <action type="..." name="...">...</action>
  // يُعيد array مرتبة حسب ترتيب الظهور
  // النص خارج الـ tags = final response
}
```

### مزايا هذا النظام

- ✅ يشتغل مع **Gemini / Gemma / GPT-4 / Claude** بدون تعديل
- ✅ لا `thought_signature` error
- ✅ الـ thinking في pass منفصل (SSE streaming)
- ✅ يمكن إضافة action types جديدة بسهولة
- ✅ قابل للتصحيح — نص عادي في الـ conversation history

---

## 5. Code Execution

الـ Agent يكتب JavaScript يُشغَّل **فعلاً** في Node.js 20 داخل GitHub Actions:

```javascript
// في system prompt الـ Agent يكتب:
<action type="exec" lang="js">
const config = globalThis.__config__;
const resp = await fetch(
  `https://api.github.com/repos/${config.github.repo_owner}/${config.github.repo_name}/contents/`,
  { headers: { Authorization: `token ${config.github.token}` } }
);
const files = await resp.json();
return files.filter(f => f.type === 'file').map(f => ({ name: f.name, size: f.size }));
</action>
```

### كيف يعمل؟

1. `agent.js` يكتب الكود في `/tmp/ofoq_exec_xxx.mjs`
2. يُشغّله بـ `execSync('node /tmp/ofoq_exec_xxx.mjs')`
3. يقرأ stdout ويُعيد النتيجة
4. يحذف الملف المؤقت

### المتغيرات المتاحة في الكود:
- `globalThis.__config__` — بيانات المستخدم (github.token, youtube.*, settings)
- `globalThis.fetch` — HTTP requests
- كل Node.js built-ins: `fs`, `path`, `crypto`, `child_process`, إلخ

---

## 6. Firestore Schema

```
/users/{uid}/
├── config/main
│   ├── github: { token, repo_owner, repo_name, status, last_verified }
│   ├── youtube: { client_id, client_secret, refresh_token, access_token, status }
│   └── settings: { location_lat, location_lng, posts_per_day, fajr_offset_minutes, github_dispatch_token }
│
├── conversations/{convId}
│   ├── status: pending | thinking | running | done | error
│   ├── user_message: string
│   ├── history: [{role, content}, ...]
│   ├── thinking_chunks: string[]   ← يُضاف chunk بـ chunk (real-time)
│   ├── tool_updates: string[]      ← "💾 حفظ البيانات..." إلخ
│   ├── final_response: string
│   └── error: string | null
│
├── plan/current
│   ├── date, fajr, status
│   ├── published_count
│   └── slots: [{time, platform, video, videoUrl, status}, ...]
│
├── schedules/{schedId}
│   ├── label, task, user_prompt
│   ├── cron_hour, cron_minute (Cairo time)
│   ├── days_left, active
│   ├── next_run (YYYY-MM-DD), last_run
│   └── task_args: {}
│
├── files/{fileId}
│   ├── name, mimeType, size
│   ├── textContent (max 500KB)
│   └── uploaded_at
│
└── log/entries
    └── items: [{ts, platform, video, status, detail}, ...]
```

### Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## 7. إعداد المشروع

### الخطوة 1 — Firebase

1. اذهب إلى [console.firebase.google.com](https://console.firebase.google.com)
2. أنشئ مشروعاً جديداً
3. فعّل **Authentication** → Google + Email/Password
4. فعّل **Firestore Database** → ابدأ في Production mode
5. أضف Security Rules من Section 6 بالأعلى
6. من **Project Settings** → **General** → **Your apps** → أضف Web App
7. انسخ `firebaseConfig` object

### الخطوة 2 — `public/index.html`

```javascript
// في أعلى الملف — 3 ثوابت مهمة:

const FIREBASE_CONFIG = {
  apiKey:            "AIza...",           // من Firebase Console
  authDomain:        "myapp.firebaseapp.com",
  projectId:         "myapp",
  storageBucket:     "myapp.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...",
};

const GITHUB_OWNER       = "mu7ammadreyad";  // اسم حسابك على GitHub
const GITHUB_AGENT_REPO  = "ofoqagent";      // اسم الـ repo
const GITHUB_TOKEN       = "ghp_xxxxx";      // PAT بصلاحية repo + workflow
```

### الخطوة 3 — GitHub Repository

```bash
# أنشئ repo جديد على GitHub، ثم:
git clone https://github.com/mu7ammadreyad/ofoqagent.git
cd ofoqagent

# ارفع كل الملفات
git add .
git commit -m "🚀 Initial OFOQ Agent v5.0"
git push origin main
```

---

## 8. GitHub Secrets

اذهب إلى GitHub Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| الاسم | القيمة | مصدرها |
|-------|-------|--------|
| `GEMINI_API_KEY` | `AIza...` | [aistudio.google.com](https://aistudio.google.com) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON كامل | Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `GEMMA_API_KEY` | `AIza...` (اختياري) | نفس مصدر Gemini |

### كيف تحصل على FIREBASE_SERVICE_ACCOUNT

1. Firebase Console → Project Settings → **Service Accounts**
2. اضغط **Generate new private key**
3. سيُنزَّل ملف JSON — انسخ محتواه كاملاً
4. الصقه كقيمة للـ Secret `FIREBASE_SERVICE_ACCOUNT`

---

## 9. قبل كل Deploy

### Firebase Hosting
```bash
# تثبيت Firebase CLI (مرة واحدة)
npm install -g firebase-tools
firebase login

# Deploy
firebase deploy --only hosting
# ← سيُرفع public/index.html على Firebase CDN
```

### تحديث الكود فقط (بدون frontend)
```bash
git add src/ md/
git commit -m "update agent logic"
git push
```

### تحديث الـ Frontend فقط
```bash
git add public/
git commit -m "update UI"
git push
firebase deploy --only hosting
```

---

## 10. الـ Tools المتاحة

| Tool | الوظيفة | Args |
|------|---------|------|
| `save_credentials` | حفظ tokens في Firebase | platform, data |
| `verify_connection` | اختبار الاتصال | platform |
| `list_pending_videos` | فيديوهات GitHub pending | — |
| `build_daily_plan` | خطة النشر + الجدول | — |
| `health_check` | فحص كل التوكنز | — |
| `get_status` | حالة النظام | — |
| `fetch_github` | أي استعلام GitHub API | path |
| `update_settings` | تحديث الإعدادات | مختلفة |
| `create_schedule` | جدولة مهمة يومية | label, task, cron_hour/minute, days |
| `list_schedules` | عرض الجداول | — |
| `delete_schedule` | إلغاء جدول | sid |
| `read_file` | قراءة ملف مرفوع | file_id |

### Code Execution (ليست tool — action مستقلة)
يكتب الـ Agent كود JavaScript يُشغَّل مباشرة في Node.js 20.

---

## 11. الجدولة التلقائية

### كيف يعمل؟

المستخدم يطلب من الـ Agent جدولة مهمة:
```
أريد خطة نشر يومية الساعة 12 ظهراً لمدة شهر
```

Agent يستدعي `create_schedule` → يُخزَّن في Firestore:
```json
{
  "label": "خطة يومية الظهر",
  "task": "build_daily_plan",
  "cron_hour": 12,
  "cron_minute": 0,
  "days": 30,
  "next_run": "2025-04-13"
}
```

`scheduler.yml` يشتغل كل ساعة → يقرأ Firestore → يُطلق `agent-chat` للمهام الحانة.

### مثال على مهام مدعومة:
- `build_daily_plan` — بناء خطة اليوم
- `health_check` — فحص التوكنز
- `custom` + `user_prompt` — أي رسالة للـ Agent

---

## 12. رفع الملفات

المستخدم يمكنه رفع ملفات (TXT, MD, JSON, CSV, JS...) والـ Agent يقرأ محتواها:

1. **Frontend:** المستخدم يختار ملف → يُرفع لـ Firestore تلقائياً
2. **Agent:** يتلقى `file_id` في الرسالة → يستخدم `read_file` tool
3. **تحليل:** يقرأ المحتوى ويُجيب بناءً عليه

### حدود الملفات:
- الحد الأقصى: **2MB**
- الأنواع المدعومة: نصية (txt, md, json, csv, js, py, html, ...)
- للملفات الثنائية: يُخزَّن الاسم والنوع فقط بدون محتوى

---

## 13. استكشاف الأخطاء

### ❌ GITHUB_TOKEN غير مُهيأ
**الحل:** افتح `public/index.html` وعدّل ثابت `GITHUB_TOKEN` في أعلى الكود.

### ❌ FIREBASE_SERVICE_ACCOUNT not found
**الحل:** تأكد من إضافة الـ Secret في GitHub → Settings → Secrets → Actions.

### ❌ GitHub Action لا يشتغل
1. تأكد إن الـ `GITHUB_TOKEN` في HTML عنده صلاحية `workflow`
2. تحقق من GitHub → repo → Actions → هل هو enabled؟
3. راجع Actions → agent.yml → آخر run

### ❌ Thinking لا يظهر
هذا طبيعي أحياناً — thinking pass قد يفشل بسبب rate limit لكنه non-fatal.

### ❌ Agent لا يجد tool_signature
هذا الخطأ حُلّ نهائياً في v5.0 بفضل Custom FC — لا Gemini Native tools.

### تشغيل يدوي للـ Agent
```bash
# للـ debugging
cd ofoqagent
CONV_UID=xxx CONV_ID=yyy GEMINI_API_KEY=zzz FIREBASE_SERVICE_ACCOUNT='{...}' node src/agent.js
```

---

## التكلفة التقديرية

| الخدمة | الخطة | التكلفة |
|--------|-------|--------|
| Firebase Hosting | Free | مجاني |
| Firebase Auth | Free | مجاني |
| Firestore | Free (1GB) | مجاني |
| GitHub Actions | Free (2000 min/month) | مجاني |
| Gemini API | Free (15 req/min) | مجاني |
| **الإجمالي** | | **$0/شهر** |

---

*بسم الله الرحمن الرحيم*
*OFOQ Agent v5.0 — GitHub Actions + Firebase + Custom FC*
