# OFOQ Agent — دليل الأدوات الشامل
> مرجع كامل للنموذج: Shell · Python · HTTP · Git · بيانات · ذاكرة · حل المشكلات

---

## فلسفة الكتابة الصحيحة

قبل أي action — **فكّر أولاً**:
1. ما المطلوب بالضبط؟
2. ما المعلومات الموجودة في memory.md؟
3. ما أفضل أسلوب تنفيذ؟ (shell ذرّي ← أفضل من سكريبت ضخم واحد)
4. كيف أتحقق من النتيجة؟
5. ماذا يحدث لو فشل؟

---

## SECTION A — Shell: القواعد الذهبية

```bash
# دائماً: set -eo pipefail في أول كل سكريبت
#!/bin/bash
set -eo pipefail
```

### A1. فحص المتغيرات قبل الاستخدام
```bash
# صح — تحقق أولاً
TOKEN="${MY_TOKEN}"
if [[ -z "$TOKEN" ]]; then
  echo "TOKEN غير موجود" >&2
  exit 1
fi
curl -sf -H "Authorization: token $TOKEN" https://api.example.com
```

### A2. التعامل مع أخطاء curl
```bash
response=$(curl -sf -w "\n%{http_code}" \
  -H "Authorization: token $TOKEN" \
  "https://api.example.com/endpoint")

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)

if [[ "$http_code" != "200" ]]; then
  echo "HTTP $http_code: $body" >&2
  exit 1
fi
echo "$body"
```

### A3. عمليات الملفات الأساسية
```bash
# قراءة ملف
cat /path/to/file

# كتابة ملف
cat > /tmp/output.txt << 'EOF'
محتوى الملف هنا
EOF

# فحص وجود ملف
if [[ -f "/tmp/myfile.txt" ]]; then echo "الملف موجود"; fi

# حجم ملف
ls -lh /tmp/myfile.txt
wc -l /tmp/myfile.txt
```

### A4. معالجة JSON من الـ CLI
```bash
# بدون jq — استخدم Python دائماً
VALUE=$(echo "$JSON_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")

# قائمة
echo "$JSON_RESPONSE" | python3 -c "
import sys, json
items = json.load(sys.stdin)
for item in items:
    print(item['id'], item['name'])
"
```

---

## SECTION B — Python: كيف تكتب كوداً صحيحاً

### B1. الهيكل الصحيح لأي Python script
```python
#!/usr/bin/env python3
import sys, json, os
from datetime import datetime

# ثوابت
TIMEOUT = 30
BASE_URL = "https://api.example.com"

def fetch_data(url: str, token: str) -> dict:
    """جلب البيانات من API مع معالجة الأخطاء"""
    import urllib.request
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"token {token}", "User-Agent": "OFOQ/6.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"خطأ: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("GITHUB_TOKEN غير موجود", file=sys.stderr)
        sys.exit(1)
    data = fetch_data(f"{BASE_URL}/user", token)
    print(json.dumps(data, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```

### B2. HTTP requests — بدون pip (stdlib فقط)
```python
import urllib.request, urllib.parse, json

def http_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))

def http_post(url, data, headers=None):
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json", **(headers or {})}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))
```

### B3. HTTP requests — مع requests library
```bash
pip install requests --quiet --break-system-packages
```
```python
import requests

session = requests.Session()
session.headers.update({"Authorization": f"token {TOKEN}", "User-Agent": "OFOQ/6.0"})

# GET
resp = session.get("https://api.github.com/user", timeout=30)
resp.raise_for_status()
user = resp.json()
print(user['login'])

# POST
resp = session.post(
    "https://api.github.com/repos/owner/repo/releases",
    json={"tag_name": "v1.0", "name": "Release 1.0"},
    timeout=30,
)
resp.raise_for_status()
print(f"Release ID: {resp.json()['id']}")
```

### B4. معالجة الأخطاء بشكل صحيح
```python
import sys, traceback

# لا تكتب except: pass أبداً
try:
    result = risky_operation()
except FileNotFoundError as e:
    print(f"الملف غير موجود: {e}", file=sys.stderr)
    sys.exit(1)
except json.JSONDecodeError as e:
    print(f"JSON غير صالح: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"خطأ غير متوقع: {type(e).__name__}: {e}", file=sys.stderr)
    traceback.print_exc()
    sys.exit(1)
```

### B5. العمل مع الوقت والتاريخ
```python
from datetime import datetime, timedelta, timezone
import math

# الوقت الحالي
now_utc   = datetime.now(timezone.utc)
now_cairo = datetime.now(timezone(timedelta(hours=2)))
print(f"الوقت (القاهرة): {now_cairo.strftime('%Y-%m-%d %H:%M')}")

# timestamp ISO 8601
timestamp = datetime.now(timezone.utc).isoformat()

# حساب وقت الفجر
def calc_fajr(lat=30.0444, lng=31.2357):
    D2R = math.pi / 180
    d = datetime.now()
    JD = int(365.25*(d.year+4716)) + int(30.6001*(d.month+1)) + d.day - 1524.5
    n  = JD - 2451545.0
    L  = ((280.460 + 0.9856474 * n) % 360 + 360) % 360
    g  = ((357.528 + 0.9856003 * n) % 360) * D2R
    lam = (L + 1.915*math.sin(g) + 0.020*math.sin(2*g)) * D2R
    eps = 23.439 * D2R
    dec = math.asin(math.sin(eps) * math.sin(lam))
    RA  = math.atan2(math.cos(eps)*math.sin(lam), math.cos(lam))
    noon = 12 - lng/15 - ((L*D2R - RA)*12/math.pi) + 2
    cosH = (math.sin(-18*D2R) - math.sin(lat*D2R)*math.sin(dec)) / (math.cos(lat*D2R)*math.cos(dec))
    if abs(cosH) > 1: return None
    ft = ((noon - math.acos(cosH)*12/math.pi) % 24 + 24) % 24
    hh, mm = int(ft), int((ft - int(ft)) * 60)
    return f"{hh:02d}:{mm:02d}"

print("الفجر:", calc_fajr())
```

### B6. جدولة وتوزيع المواعيد
```python
import random

def make_schedule(start_hour, start_min, count, spread_hours=16):
    """توزيع count موعد على spread_hours ساعة"""
    start_mins = start_hour * 60 + start_min
    end_mins   = min(start_mins + spread_hours * 60, 23 * 60)
    if count <= 0: return []
    base_gap = (end_mins - start_mins) // count
    slots = []
    for i in range(count):
        t = start_mins + i * base_gap + random.randint(-5, 5)
        t = max(start_mins, min(end_mins - 1, t))
        slots.append(f"{t//60:02d}:{t%60:02d}")
    return sorted(slots)

# مثال: 4 مواعيد بعد الفجر 30 دقيقة
slots = make_schedule(5, 48, count=4)
for s in slots: print(s)
```

### B7. العمل مع الملفات
```python
import json, os

# قراءة JSON
with open("/tmp/data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# كتابة JSON
with open("/tmp/output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# كتابة نص عربي
with open("/tmp/arabic.txt", "w", encoding="utf-8") as f:
    f.write("بسم الله الرحمن الرحيم\n")

# متغيرات البيئة
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise EnvironmentError("API_KEY not set")
```

### B8. المعالجة المتوازية
```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def process_item(item):
    return {"item": item, "result": "done"}

items = ["item1", "item2", "item3", "item4"]

with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {executor.submit(process_item, i): i for i in items}
    for future in as_completed(futures):
        item = futures[future]
        try:
            result = future.result()
            print(f"{item}: {result}")
        except Exception as e:
            print(f"{item} فشل: {e}")
```

### B9. API مع Retry تلقائي
```python
import time, urllib.request, json

def api_call_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            wait = 2 ** attempt
            print(f"محاولة {attempt+1}/{max_retries} فشلت: {e}. انتظار {wait}s...")
            if attempt < max_retries - 1:
                time.sleep(wait)
            else:
                raise
```

---

## SECTION C — GitHub API

### C1. التحقق من Token
```bash
RESULT=$(curl -sf -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" "https://api.github.com/user")
LOGIN=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('login','FAILED'))")
echo "GitHub login: $LOGIN"
```

### C2. جلب Releases
```bash
curl -sf -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  | python3 -c "
import sys, json
for r in json.load(sys.stdin):
    print(f\"{r['tag_name']:<15} {r['id']:<12} {r['name']}\")
"
```

### C3. إنشاء Release
```bash
curl -sf -X POST \
  -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d "{\"tag_name\":\"v1.0\",\"name\":\"Release v1.0\",\"draft\":false}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('ID:', d['id'], 'URL:', d.get('html_url',''))"
```

### C4. رفع Asset لـ Release
```bash
curl -sf -X POST \
  -H "Authorization: token $TOKEN" -H "Content-Type: video/mp4" \
  --data-binary @"/tmp/video.mp4" \
  "https://uploads.github.com/repos/$OWNER/$REPO/releases/$RELEASE_ID/assets?name=video.mp4" \
  | python3 -c "import sys,json; print('URL:', json.load(sys.stdin).get('browser_download_url',''))"
```

### C5. تشغيل Workflow
```bash
curl -sf -X POST \
  -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$OWNER/$REPO/dispatches" \
  -d '{"event_type":"my-event","client_payload":{"key":"value"}}'
```

### C6. قراءة ملف من repo
```bash
curl -sf -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/contents/path/to/file.txt" \
  | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
print(base64.b64decode(d['content']).decode('utf-8')[:500])
"
```

---

## SECTION D — YouTube API

### D1. تجديد Access Token
```bash
NEW_TOKEN=$(curl -sf -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=$CLIENT_ID" -d "client_secret=$CLIENT_SECRET" \
  -d "refresh_token=$REFRESH_TOKEN" -d "grant_type=refresh_token" \
  | python3 -c "import sys,json; t=json.load(sys.stdin).get('access_token',''); print(t if t else 'FAILED')")

[[ "$NEW_TOKEN" == "FAILED" ]] && { echo "فشل تجديد YouTube token" >&2; exit 1; }
echo "Token: ${NEW_TOKEN:0:20}..."
```

---

## SECTION E — عمليات النظام

### E1. فحص الموارد
```bash
free -h                                # RAM
df -h /                                # قرص
nproc                                  # عدد cores
date "+%Y-%m-%d %H:%M:%S"             # الوقت
```

### E2. تثبيت الحزم
```bash
pip install requests pandas --quiet --break-system-packages
sudo apt-get install -y ffmpeg --quiet
npm install axios --save-quiet
```

---

## SECTION F — Git Operations

```bash
git clone "https://$TOKEN@github.com/$OWNER/$REPO.git" /tmp/myrepo
cd /tmp/myrepo
git config user.email "agent@ofoq.app"
git config user.name "OFOQ Agent"
git add -A
git commit -m "feat: تحديث تلقائي من OFOQ Agent"
git push origin main
```

---

## SECTION G — Quran & Islamic APIs

```bash
# جلب آية
curl -sf "https://api.alquran.cloud/v1/ayah/1:1/ar.alafasy" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(d['text'])
print(f\"سورة {d['surah']['name']} — الآية {d['numberInSurah']}\")
"

# جلب سورة كاملة
curl -sf "https://api.alquran.cloud/v1/surah/1" \
  | python3 -c "
import sys, json
for a in json.load(sys.stdin)['data']['ayahs']:
    print(f\"{a['numberInSurah']}. {a['text']}\")
"
```

---

## SECTION H — حل المشكلات والـ Debugging

### H1. تشخيص خطأ shell
```bash
bash -x /tmp/myscript.sh 2>&1 | head -50  # verbose
echo "Exit code: $?"                        # آخر exit code
curl -v "https://api.example.com" 2>&1 | head -40  # verbose curl
```

### H2. تشخيص Python
```python
import traceback
try:
    result = risky_operation()
except Exception as e:
    print(f"خطأ: {type(e).__name__}: {e}", file=sys.stderr)
    traceback.print_exc()
    sys.exit(1)
```

### H3. استراتيجية "افحص قبل تنفذ"
```bash
# افحص أولاً
ITEM=$(curl -sf "https://api.example.com/item/123")
echo "ستحذف: $ITEM"
# ثم نفّذ
curl -X DELETE "https://api.example.com/item/123"
```

---

## SECTION I — مهام متعددة الخطوات

### I1. نمط: جمع → خطة → تنفيذ → تحقق
```
shell (1): اقرأ الحالة الحالية
shell (2): أنشئ خطة بناءً على النتائج
update_memory: احفظ الخطة
shell (3): نفّذ الخطة
shell (4): تحقق من النتائج
update_memory: سجّل ما حدث
```

### I2. معالجة قائمة
```python
items = ["item1", "item2", "item3"]
results = []

for i, item in enumerate(items, 1):
    print(f"معالجة {i}/{len(items)}: {item}")
    try:
        result = process(item)
        results.append({"item": item, "status": "ok"})
        print(f"  تم")
    except Exception as e:
        results.append({"item": item, "status": "error", "error": str(e)})
        print(f"  خطأ: {e}")

ok    = sum(1 for r in results if r['status'] == 'ok')
error = sum(1 for r in results if r['status'] == 'error')
print(f"النتيجة: {ok} نجح، {error} فشل")
```

---

## SECTION J — أنماط update_memory

### J1. متى تحدّث الذاكرة؟
- بعد أي تحقق ناجح (token، API، إلخ)
- بعد إنشاء مهمة أو جدول جديد
- عند تلقي معلومات جديدة من المستخدم
- بعد اكتمال أي مهمة مهمة

### J2. القالب الكامل — اكتبه كاملاً دائماً
```
<action type="update_memory">
## CONFIG
# إعدادات المنصات والمفاتيح

## TASKS
# المهام المطلوبة من المستخدم
# اكتب هنا الطلبات والأهداف

## SCHEDULE
# الجداول والمواعيد المتكررة

## CONTEXT
# معلومات سياقية مهمة يجب تذكرها

## RECENT LOG
2025-04-20 14:30 | عملية | نتيجة
2025-04-20 14:31 | عملية | نتيجة

## NOTES
# ملاحظات وتذكيرات
</action>
```

### J3. حفظ معلومات المستخدم
```
## TASKS
- المستخدم يريد نشر 4 فيديوهات يومياً بعد الفجر
- جدولة أسبوعية كل أحد لمراجعة الأداء
- تنبيه عند انتهاء الـ token

## CONTEXT
user_name: أحمد
user_timezone: Africa/Cairo
user_language: Arabic
preferred_schedule: after_fajr
```

---

## SECTION K — أمثلة end-to-end

### K1. تقرير يومي كامل
```bash
python3 << 'PYEOF'
import urllib.request, json
from datetime import datetime

req = urllib.request.Request(
    "https://api.github.com/repos/OWNER/REPO/releases",
    headers={"Authorization": "token TOKEN", "User-Agent": "OFOQ/6.0"}
)
with urllib.request.urlopen(req, timeout=30) as r:
    releases = json.loads(r.read().decode())

report = {
    "date": datetime.now().strftime("%Y-%m-%d"),
    "total_releases": len(releases),
    "latest": releases[0]['tag_name'] if releases else "لا يوجد",
}

print(json.dumps(report, ensure_ascii=False, indent=2))
PYEOF
```

### K2. سكريبت نشر كامل مع فحوصات
```bash
#!/bin/bash
set -eo pipefail

# فحص المدخلات
[[ -z "$TOKEN" ]] && { echo "TOKEN مفقود" >&2; exit 1; }
[[ -z "$OWNER" ]] && { echo "OWNER مفقود" >&2; exit 1; }

# فحص GitHub
echo "فحص GitHub Token..."
LOGIN=$(curl -sf -H "Authorization: token $TOKEN" "https://api.github.com/user" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('login','FAILED'))")
[[ "$LOGIN" == "FAILED" ]] && { echo "Token غير صالح" >&2; exit 1; }
echo "GitHub: $LOGIN"

# إنشاء Release
echo "إنشاء Release..."
RELEASE_ID=$(curl -sf -X POST \
  -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d "{\"tag_name\":\"v$(date +%Y%m%d%H%M)\",\"name\":\"فيديو $(date '+%Y-%m-%d')\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Release ID: $RELEASE_ID"
```

---

## SECTION L — أمان الكود

```bash
# لا تطبع tokens
# خطأ:
echo "Token: $GITHUB_TOKEN"

# صح — فقط أول 6 حروف
echo "Token: ${GITHUB_TOKEN:0:6}..."

# لا تضع credentials في ملفات الكود
# استخدم environment variables دائماً
TOKEN="${GITHUB_TOKEN}"
```

---

## SECTION M — معلومات بيئة GitHub Actions

```bash
# Ubuntu 22.04 — الأدوات المتاحة:
python3 --version    # Python 3.10+
node --version       # Node.js 20
npm --version
git --version
curl --version
ffmpeg -version      # مثبّت بالفعل
jq --version        # مثبّت بالفعل

# متغيرات البيئة التلقائية
echo $GITHUB_WORKSPACE   # مجلد الكود
echo $RUNNER_TEMP         # مجلد مؤقت
```

---

## ملخص سريع

| المهمة | الأمر |
|--------|-------|
| تحقق GitHub | `curl -sf -H "Authorization: token $T" https://api.github.com/user` |
| تحليل JSON | `\| python3 -c "import sys,json; print(json.load(sys.stdin)['key'])"` |
| كتابة ملف | `cat > /tmp/file.txt << 'EOF' ... EOF` |
| تثبيت Python pkg | `pip install pkg --quiet --break-system-packages` |
| الوقت الحالي | `date "+%Y-%m-%d %H:%M:%S"` |
| تنزيل ملف | `curl -sfL -o /tmp/file URL` |
| تشغيل Python heredoc | `python3 << 'PYEOF' ... PYEOF` |

---
*OFOQ Agent v6.0 — دليل شامل لكل المهام*

---

## SECTION P — schedule_task Action (الجدولة التلقائية)

> هذا action مُبرمَج في tools.js مباشرة — لا يحتاج shell

### P1. متى تستخدم schedule_task؟
- المستخدم يطلب شيئاً متكرراً: "كل يوم"، "كل أسبوع"، "يومياً"، "أسبوعياً"
- أمثلة: آية يومية، حديث أسبوعي، تقرير، نشر، تذكير، أي مهمة دورية

### P2. الصياغة الصحيحة
```xml
<action type="schedule_task">
{
  "title": "عنوان قصير يظهر في الـ sidebar",
  "message": "الرسالة الكاملة التي ستُرسَل للـ agent كل مرة",
  "schedule_type": "daily",
  "hour": 9,
  "minute": 0,
  "timezone": "Africa/Cairo",
  "days": ["sat","sun","mon","tue","wed","thu","fri"]
}
</action>
```

### P3. قيم schedule_type
```
"daily"   → كل يوم في الأيام المحددة
"weekly"  → كل أسبوع في الأيام المحددة
"hourly"  → كل ساعة (نادراً — استخدم بحذر)
```

### P4. أمثلة عملية
```xml
<!-- آية قرآنية يومياً الساعة 7 صباحاً -->
<action type="schedule_task">
{
  "title": "آية قرآنية يومية",
  "message": "أرسل لي آية قرآنية عشوائية من القرآن الكريم مع تفسيرها ومعناها باختصار",
  "schedule_type": "daily",
  "hour": 7,
  "minute": 0,
  "days": ["sat","sun","mon","tue","wed","thu","fri"]
}
</action>

<!-- حديث نبوي كل جمعة الساعة 12 -->
<action type="schedule_task">
{
  "title": "حديث جمعة",
  "message": "أرسل لي حديثاً نبوياً شريفاً مع شرحه",
  "schedule_type": "weekly",
  "hour": 12,
  "minute": 0,
  "days": ["fri"]
}
</action>

<!-- تقرير GitHub يومي أيام الأسبوع -->
<action type="schedule_task">
{
  "title": "تقرير GitHub اليومي",
  "message": "افحص آخر commits وissues في repo الرئيسي وأعطني ملخصاً يومياً",
  "schedule_type": "daily",
  "hour": 8,
  "minute": 30,
  "days": ["sun","mon","tue","wed","thu"]
}
</action>
```

### P5. إلغاء مهمة
```xml
<action type="cancel_task" task_id="task_1234567890_abc1">
</action>
```
- `task_id` يكون في نتيجة schedule_task الناجحة
- يوقف المهمة (active=false) بدون حذفها — المستخدم يقدر يعيد تفعيلها من الـ sidebar

### P6. الرد بعد الجدولة
بعد نجاح schedule_task، اكتب للمستخدم:
```
تم جدولة مهمة "آية قرآنية يومية" بنجاح ✅

التفاصيل:
- التوقيت: كل يوم الساعة 7:00 صباحاً (القاهرة)
- الأيام: كل أيام الأسبوع
- أول تنفيذ: غداً 7:00 صباحاً
- المهمة ستظهر في الـ sidebar تحت "المهام المجدولة"

كل يوم في الوقت المحدد سيُنشئ النظام محادثة جديدة تلقائياً بالآية والتفسير.
```
