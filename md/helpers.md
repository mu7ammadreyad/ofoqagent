# helpers.md — توثيق الـ Helpers

## OFOQ Agent v5.0 — Utility Functions Reference

---

## calcFajr(lat, lng, date?)

**الوظيفة:** حساب وقت الفجر الفلكي (18° قبل الشروق)

**Algorithm:** Solar position algorithm — Jean Meeus "Astronomical Algorithms"

**Parameters:**
```
lat:  number — خط العرض  (مثال: 30.0444 القاهرة)
lng:  number — خط الطول  (مثال: 31.2357 القاهرة)
date: Date   — التاريخ    (اختياري — افتراضي: اليوم)
```

**Returns:**
```javascript
{ hours: 4, minutes: 48, formatted: "04:48" }
// أو null إذا فشل الحساب (مناطق قطبية)
```

**مثال:**
```javascript
const fajr = calcFajr(30.0444, 31.2357);
console.log(fajr.formatted); // "04:48"
```

**ملاحظات:**
- يفترض توقيت مصر UTC+2 (بدون DST — مصر ألغت التوقيت الصيفي 2011)
- دقة الحساب: ±1 دقيقة من أوقات تطبيقات الصلاة المعتمدة
- زاوية الفجر: 18° (المعيار الأمريكي/الكندي والأكثر استخداماً)

---

## makeDefaultSlots(startH, startM, count)

**الوظيفة:** إنشاء مواعيد نشر موزّعة بشكل ذكي على مدار اليوم

**Parameters:**
```
startH: number — ساعة البداية (بعد الفجر مباشرة)
startM: number — دقيقة البداية
count:  number — عدد المواعيد المطلوبة (1-10)
```

**Returns:**
```javascript
["05:20", "08:15", "13:30", "17:45"] // مرتبة تصاعدياً
```

**الخوارزمية:**
1. يحسب الفترة الزمنية من البداية لـ 23:00
2. يوزّع الـ count على الفترة بالتساوي
3. يضيف jitter عشوائي (±9 دقائق) لتبدو طبيعية

---

## buildSlotTimestamp(dateStr, timeStr)

**الوظيفة:** تحويل تاريخ + وقت لـ Unix timestamp بتوقيت القاهرة

**Parameters:**
```
dateStr: "2025-04-12"  — ISO date
timeStr: "05:20"       — HH:MM
```

**Returns:** `number` — Unix timestamp بالـ milliseconds

**مثال:**
```javascript
const ts = buildSlotTimestamp("2025-04-12", "05:20");
// 2025-04-12T05:20:00+02:00 → UTC timestamp
```

---

## pad(n)

**الوظيفة:** تحويل رقم لـ string بـ leading zero (للأوقات)

```javascript
pad(5)  // "05"
pad(12) // "12"
pad(0)  // "00"
```

---

## sleep(ms)

**الوظيفة:** انتظار عدد من الـ milliseconds

```javascript
await sleep(1000); // انتظر ثانية
```

---

## readMarkdownFile(filename)

**الوظيفة:** قراءة ملف md من مجلد `md/` في الـ repo

**Parameters:**
```
filename: "soul.md" | "tools.md" | "memory.md" | "helpers.md"
```

**Returns:** `string` — محتوى الملف كاملاً

**مثال:**
```javascript
const soul = await readMarkdownFile('soul.md');
// يُستخدم كـ system instruction للـ AI
```

---

## formatCairoTime(date?)

**الوظيفة:** تنسيق التاريخ/الوقت بتوقيت القاهرة

**Returns:** `string` — مثال: "الأربعاء، 12 أبريل 2025، 05:20 ص"

---

## cairoToday()

**الوظيفة:** تاريخ اليوم بتوقيت القاهرة بصيغة ISO

**Returns:** `string` — مثال: "2025-04-12"

---

## stripThoughts(messages)

**الوظيفة:** حذف thought parts من الـ Gemini history قبل إرسالها مرة أخرى

**السبب:** Gemini يرفض thought parts في الـ history بدون thought_signature → هذه الدالة تحلّ الخطأ `thought_signature missing in functionCall parts`

**Parameters:**
```javascript
messages: GeminiMessage[] // الـ history الكاملة
```

**Returns:** نفس الـ messages لكن بدون أي `part.thought === true`

**مثال:**
```javascript
const cleanHistory = stripThoughts(conversationHistory);
// ← هذا يُرسَل لـ Gemini API بدون thought_signature error
```

---

## chunkify(text, size)

**الوظيفة:** تقسيم نص طويل لـ chunks لتجنب Firestore document size limit

**Parameters:**
```
text: string — النص الكامل
size: number — حجم الـ chunk (افتراضي: 800 حرف)
```

**ملاحظة:** Firestore document limit = 1 MB. الـ thinking text يمكن أن يكون طويلاً جداً.

---

## sanitizeForLog(obj)

**الوظيفة:** إزالة البيانات الحساسة من الـ object قبل الـ logging

**يحذف:** `token`, `client_secret`, `refresh_token`, `access_token`, `password`

```javascript
const safe = sanitizeForLog({ token: 'ghp_secret', name: 'Mohammed' });
// { token: '[REDACTED]', name: 'Mohammed' }
```
