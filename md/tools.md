# tools.md — توثيق الـ Tools

## OFOQ Agent v5.0 — Tool Reference

---

## نظرة عامة

الـ Tools هي البديل الكامل لـ eval() وcode generation.
كل وظيفة يحتاجها الـ Agent موثّقة هنا بدقة كاملة.

**المبدأ:** الـ AI يختار الـ tool المناسبة → الكود يُنفَّذ محلياً → النتيجة ترجع للـ AI.

---

## 1. save_credentials

**الوظيفة:** حفظ بيانات تسجيل دخول منصة في Firebase Firestore

**متى تُستخدم:** فوراً عندما يعطي المستخدم أي token أو ID أو secret

**Parameters:**
```json
{
  "platform": "github | youtube | settings",
  "data": {
    "token":          "GitHub Personal Access Token",
    "repo_owner":     "اسم المستخدم على GitHub",
    "repo_name":      "اسم الـ repository",
    "client_id":      "YouTube OAuth Client ID",
    "client_secret":  "YouTube OAuth Client Secret",
    "refresh_token":  "YouTube Refresh Token",
    "access_token":   "YouTube Access Token (مؤقت)"
  }
}
```

**Returns:**
```json
{ "success": true, "saved": "token, repo_owner, repo_name", "message": "تم الحفظ في Firebase" }
```

**ملاحظات:**
- يدعم فقط: github, youtube, settings في v1
- البيانات مشفّرة في Firestore ومعزولة per-user
- لا يحفظ كلمات المرور أبداً — فقط tokens

---

## 2. verify_connection

**الوظيفة:** التحقق من صحة الـ token لمنصة معينة واختبار الاتصال فعلياً

**متى تُستخدم:** بعد أي `save_credentials` مباشرة

**Parameters:**
```json
{ "platform": "github | youtube" }
```

**What it does:**
- **github:** يستدعي `GET /user` على GitHub API
- **youtube:** يجرّب تجديد الـ access token بـ refresh_token

**Returns:**
```json
{
  "success": true,
  "data": {
    "login": "github_username",
    "name": "Full Name",
    "public_repos": 42
  }
}
```

**عند الفشل:**
```json
{
  "success": false,
  "error": "GitHub فشل: 401 — تحقق من الـ token"
}
```

---

## 3. list_pending_videos

**الوظيفة:** جلب قائمة الفيديوهات المعلقة من GitHub Release بعلامة `pending`

**متى تُستخدم:** عندما يسأل المستخدم عن الفيديوهات أو قبل بناء الخطة

**Parameters:** لا يوجد

**Returns:**
```json
{
  "success": true,
  "data": {
    "count": 5,
    "videos": [
      { "name": "quran_fajr_day45", "size_mb": "23.5", "has_meta": true },
      { "name": "hadith_morning_01", "size_mb": "18.2", "has_meta": false }
    ]
  }
}
```

**ملاحظات:**
- يبحث عن Release بعلامة `pending` في الـ repo المُهيأ
- كل فيديو يكون: `videoname.mp4` + `videoname.md` (اختياري للعنوان والوصف)
- يعرض أول 10 فيديوهات فقط في الـ response

---

## 4. build_daily_plan

**الوظيفة:** بناء خطة النشر اليومية الذكية وحفظها في Firestore + إطلاق GitHub Workflow للنشر

**متى تُستخدم:** عندما يطلب المستخدم بدء النشر أو بناء الخطة

**Parameters:** لا يوجد

**ما يفعله:**
1. يحسب وقت الفجر (حسب الموقع في settings)
2. يجلب الفيديوهات من GitHub pending release
3. يحسب أفضل مواعيد النشر (30 دق+ بعد الفجر، موزعة على اليوم)
4. يحفظ الخطة في Firestore
5. يُطلق GitHub Actions workflow للنشر التلقائي

**Returns:**
```json
{
  "success": true,
  "data": {
    "date": "2025-04-12",
    "fajr": "04:48",
    "slots": 4,
    "schedule": "• 05:20 → youtube  | quran_fajr_day45\n• 08:15 → youtube  | hadith_morning_01"
  }
}
```

---

## 5. health_check

**الوظيفة:** فحص صحة جميع التوكنز المُهيأة وعرض التقرير

**متى تُستخدم:** عندما يطلب المستخدم فحص الصحة أو قبل بناء الخطة

**Parameters:** لا يوجد

**Returns:**
```json
{
  "success": true,
  "data": {
    "results": {
      "github": "✅ سليم",
      "youtube": "❌ Token منتهي"
    },
    "warnings": ["⚠️ YouTube refresh_token منتهي — يحتاج تجديد"],
    "all_ok": false
  }
}
```

---

## 6. get_status

**الوظيفة:** عرض الحالة الكاملة للنظام

**متى تُستخدم:** عندما يسأل المستخدم "ما الوضع؟" أو "هل النظام شغّال؟"

**Parameters:** لا يوجد

**Returns:**
```json
{
  "success": true,
  "data": {
    "fajr": "04:48",
    "workflow": "completed",
    "plan_active": true,
    "published_today": 2,
    "github": "verified",
    "youtube": "verified"
  }
}
```

---

## 7. fetch_github

**الوظيفة:** استعلام GitHub API لجلب أي بيانات

**متى تُستخدم:** لأي سؤال عن الـ repo يحتاج بيانات live

**Parameters:**
```json
{ "path": "/repos/owner/repo/releases" }
```

**أمثلة على الـ path:**
- `/repos/{owner}/{repo}/releases` — كل الـ releases
- `/repos/{owner}/{repo}/contents/` — محتوى الـ root
- `/repos/{owner}/{repo}/releases/assets/{asset_id}` — أصل معين
- `/user` — معلومات المستخدم
- `/user/repos` — كل الـ repos

**Returns:**
```json
{
  "success": true,
  "data": { "count": 3, "items": ["pending", "published", "archive"] }
}
```

---

## 8. update_settings

**الوظيفة:** تحديث إعدادات الموقع وجدول النشر

**متى تُستخدم:** عندما يريد المستخدم تغيير الموقع أو عدد المنشورات

**Parameters:**
```json
{
  "location_lat": "30.0444",
  "location_lng": "31.2357",
  "posts_per_day": "4",
  "fajr_offset_minutes": "30"
}
```

**Returns:**
```json
{ "success": true, "updated": { "posts_per_day": "6" } }
```

---

## قواعد استخدام الـ Tools

### ترتيب الأولويات:
1. دائماً `save_credentials` → ثم `verify_connection` مباشرة
2. دائماً `health_check` → قبل `build_daily_plan`
3. دائماً `list_pending_videos` → قبل تأكيد الخطة

### عند فشل الـ Tool:
- أعد المحاولة مرة واحدة بنفس الـ parameters
- لو فشلت مرتين → أخبر المستخدم بالخطأ الدقيق
- لا تتجاهل الأخطاء أبداً

### الـ Tools المحظورة (لأسباب أمنية):
- لا توجد — لكن يُحظر استخدام أي tool بشكل يُضر ببيانات المستخدم
