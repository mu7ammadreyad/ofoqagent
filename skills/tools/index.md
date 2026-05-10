# Tools Roadmap — خارطة طريق الأدوات
> هذا الملف يُرسَل في كل محادثة. لتحميل أي دليل: `<action type="read_tool" file="X.md">`

## القاعدة الذهبية
**قبل كتابة أي كود > 10 أسطر → اقرأ الدليل المناسب أولاً.**

## الملفات المتاحة

| الملف | متى تستخدمه | الأدوات |
|-------|-------------|---------|
| `shell.md` | bash, curl, JSON, grep, awk | bash, curl, python3 inline |
| `python.md` | Python scripts, HTTP, CSV, retry | urllib, requests, concurrent |
| `web.md` | scraping, browser, AX Tree | Camoufox, requests+html |
| `github.md` | repos, releases, actions, PRs | GitHub REST API |
| `cyber.md` | **اختبار أمني، ثغرات، pentesting** | nmap, ZAP, nuclei, sqlmap, nikto |
| `islamic.md` | قرآن، حديث، مواقيت الصلاة | alquran.cloud, ahadith API |
| `scheduling.md` | مهام متكررة، جدولة، cron | schedule_task action |

## متى تقرأ أي ملف؟

```
طلب يخص bash/shell         → read_tool shell.md
طلب يخص Python             → read_tool python.md
طلب يخص مواقع/scraping     → read_tool web.md
طلب يخص GitHub             → read_tool github.md
طلب يخص أمن/ثغرات/pentest  → read_tool cyber.md   ← مهم جداً
طلب يخص قرآن/حديث          → read_tool islamic.md
طلب يخص جدولة متكررة       → read_tool scheduling.md
```

## Actions المتاحة (مراجعة سريعة)

| Action | الاستخدام |
|--------|-----------|
| `shell` | تنفيذ bash/python |
| `browser` | جلب صفحة ويب بـ Camoufox |
| `read_tool` | تحميل دليل أدوات |
| `update_core_memory` | حفظ الذاكرة الأساسية |
| `add_episode` | إضافة حدث للسجل التاريخي |
| `update_tasks` | تحديث المهام المعلقة/المكتملة |
| `update_world` | تحديث نموذج العالم والمعتقدات |
| `schedule_task` | جدولة مهمة متكررة |
| `cancel_task` | إلغاء مهمة مجدولة |

## نموذج الاستخدام الصحيح

```xml
<!-- تحميل دليل الأمن قبل بدء اختبار -->
<action type="read_tool" file="cyber.md">
</action>

<!-- تحميل دليل GitHub قبل العمل مع repos -->
<action type="read_tool" file="github.md">
</action>
```
