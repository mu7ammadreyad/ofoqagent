# أفق — OFOQ Agent v6.1

عميل ذكاء اصطناعي متكامل مبني على GitHub Actions + Firebase. يستطيع تنفيذ **أي مهمة برمجية أو تشغيلية** وجدولة المهام المتكررة تلقائياً.

---

## المميزات

- **محادثة طبيعية** — اكتب بالعربية وأفق يفهم ويُنفِّذ
- **جدولة مهام تلقائية** — "كل يوم الساعة 9 أرسل لي آية قرآنية" يعمل فعلاً
- **تنفيذ كود حقيقي** — shell, Python, curl, git, ffmpeg, أي شيء على Ubuntu
- **ذاكرة دائمة** — يتذكر المعلومات بين المحادثات عبر Firestore
- **محادثات مرتبطة بـ URL** — كل محادثة لها رابط فريد في المتصفح
- **المهام المجدولة** في قسم منفصل بالـ sidebar

---

## الهيكل

```
ofoqagent/
├── public/
│   └── index.html          # واجهة المستخدم (RTL، sidebar يمين)
├── skills/
│   ├── soul.md             # شخصية الـ agent ومنهج تفكيره
│   ├── tools.md            # مرجع الأدوات الشامل (shell, python, APIs)
│   └── memory.md           # قالب الذاكرة الأولية
├── src/
│   ├── agent.js            # ReAct loop — ينفذ المحادثات
│   ├── scheduler.js        # يفحص المهام المجدولة ويطلقها
│   └── tools.js            # أدوات: shell, memory, conversations, scheduled tasks
├── .github/workflows/
│   ├── agent.yml           # يشتغل عند كل رسالة (repository_dispatch)
│   └── scheduler.yml       # يشتغل كل ساعة (cron)
└── package.json
```

---

## الإعداد

### 1. Firebase

1. أنشئ مشروع Firebase من [console.firebase.google.com](https://console.firebase.google.com)
2. فعّل **Authentication** (Email/Password + Google)
3. فعّل **Firestore** في وضع production
4. من Project Settings → Service Accounts → Generate new private key → احفظ الـ JSON

### 2. GitHub Secrets

أضف في Settings → Secrets and variables → Actions:

| الاسم | القيمة |
|-------|--------|
| `GEMINI_API_KEY` | مفتاح Gemini API |
| `FIREBASE_SERVICE_ACCOUNT` | محتوى ملف JSON كاملاً |

### 3. Firestore Index (للمهام المجدولة)

أضف Collection Group Index لـ `scheduled_tasks`:
- Collection ID: `scheduled_tasks`
- Fields: `active` (Ascending) + `next_run` (Ascending)

أو شغّل المجدول مرة وستظهر رسالة خطأ بها رابط إنشاء الـ index تلقائياً.

### 4. index.html

عدّل القيم في أعلى `<script>` في `public/index.html`:
```javascript
const GITHUB_OWNER      = "username";    // اسم مستخدم GitHub
const GITHUB_AGENT_REPO = "ofoqagent";  // اسم الـ repo
const GITHUB_TOKEN      = "ghp_...";    // PAT بصلاحية workflow
```

---

## Actions المتاحة للـ Agent

### shell
```xml
<action type="shell">
curl -sf https://api.github.com/user
</action>
```

### update_memory
```xml
<action type="update_memory">
## CONFIG
github_token: ghp_xxx
...
</action>
```

### schedule_task
```xml
<action type="schedule_task">
{
  "title": "حكمة يومية",
  "message": "أعطني حكمة إسلامية جديدة",
  "schedule_type": "daily",
  "hour": 9,
  "minute": 0,
  "days": ["sat","sun","mon","tue","wed","thu","fri"]
}
</action>
```

### cancel_task
```xml
<action type="cancel_task" task_id="task_1234_abc1">
</action>
```

---

## كيف تعمل الجدولة

1. المستخدم يطلب: "كل يوم الساعة 7 أرسل لي آية قرآنية"
2. الـ agent يستخدم `schedule_task` لحفظ المهمة في Firestore
3. المهمة تظهر في الـ sidebar تحت "المهام المجدولة"
4. كل ساعة: `scheduler.yml` يشغّل `scheduler.js`
5. `scheduler.js` يقرأ المهام النشطة ويتحقق من `next_run`
6. للمهام الحانة: ينشئ محادثة جديدة في Firestore ويطلق `agent-chat`
7. الـ agent ينفذ المهمة ويكتب الرد في المحادثة
8. المحادثة تظهر في تطبيق المستخدم تلقائياً

---

## ملاحظات تقنية

- **لا timeout** على shell أو model calls — المهمة تكتمل مهما طالت
- **GitHub Actions timeout**: 360 دقيقة (6 ساعات)
- **ReAct loop**: حد أقصى 15 جولة لكل محادثة
- **Sidebar**: على اليمين (RTL)، بلون الخلفية
- **URL routing**: كل محادثة لها `?conv=conv_xxx` في المتصفح
