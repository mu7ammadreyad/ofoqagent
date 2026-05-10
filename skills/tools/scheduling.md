# Scheduling Tools — جدولة المهام

## schedule_task action
```xml
<action type="schedule_task">
{
  "title": "آية قرآنية يومية",
  "message": "أرسل آية قرآنية عشوائية مع تفسيرها",
  "schedule_type": "daily",
  "hour": 7,
  "minute": 0,
  "timezone": "Africa/Cairo",
  "days": ["sat","sun","mon","tue","wed","thu","fri"]
}
</action>
```

## قيم schedule_type
- `"daily"` → كل يوم في الأيام المحددة
- `"weekly"` → أسبوعياً (حدد يوم أو أيام في days)
- `"hourly"` → كل ساعة

## إلغاء مهمة
```xml
<action type="cancel_task" task_id="task_1234_abc">
</action>
```

## بعد الجدولة — الرد الصحيح
```
===FINAL_ANSWER===
تم جدولة "{title}" ✅
التوقيت: كل يوم {hour}:{minute:02d} (القاهرة)
أول تنفيذ: {nextRun}
```

## message يجب أن تكون مكتفية ذاتياً
```
✅ "أرسل آية قرآنية عشوائية مع تفسيرها من تفسير الجلالين"
✅ "افحص GitHub repos وأعطني ملخصاً يومياً للـ commits الجديدة"
❌ "افعل ما قلناه"
❌ "راجع سياق المحادثة"
```
