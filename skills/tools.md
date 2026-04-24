# OFOQ Tools — Shell Reference Manual v6.0
# دليل شامل لكتابة كود صحيح في بيئة GitHub Actions Ubuntu

---

## ⚠️ قواعد أساسية لا تُخالَف

```bash
#!/bin/bash
set -eo pipefail   # أوقف عند أي خطأ — دائماً في البداية

# طباعة نتائج وسيطة للتحقق
echo "✓ البيئة: $(uname -a)"
echo "✓ Python: $(python3 --version)"
echo "✓ المجلد: $(pwd)"
```

---

## 1. Python — أساسيات كتابة كود صحيح

### 1.1 Heredoc الأنظف (بدون مشاكل indentation)

```bash
python3 << 'PYEOF'
import sys, json, os, datetime

# ✅ اطبع دائماً للتأكيد
print("Python يعمل")
print(f"Python version: {sys.version}")

# ✅ تعامل مع الأخطاء دائماً
try:
    result = 10 / 0
except ZeroDivisionError as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
```

### 1.2 Python مع إدخال من bash

```bash
# تمرير متغيرات bash لـ Python بشكل آمن
TOKEN="ghp_xxx"
REPO="my-repo"

python3 << PYEOF
import os, sys

# ✅ اقرأ من env — لا تضع credentials مباشرة في الكود
token = os.environ.get('TOKEN_VAR', '')
repo  = os.environ.get('REPO_VAR', '')

if not token:
    print("ERROR: TOKEN_VAR مش موجود", file=sys.stderr)
    sys.exit(1)

print(f"Repo: {repo}")
print(f"Token: {token[:8]}...")
PYEOF
```

**⚠️ إذا استخدمت PYEOF بدون quotes، المتغيرات `$VAR` تتوسّع داخل الكود — خطر على credentials!**

```bash
# ✅ آمن — الـ PYEOF بين quotes، متغيرات bash لا تتوسّع
TOKEN="$TOKEN" REPO_VAR="$REPO" python3 << 'PYEOF'
import os
token = os.environ['TOKEN']
repo  = os.environ['REPO_VAR']
print(f"Token: {token[:8]}...")
PYEOF
```

### 1.3 معالجة JSON في Python

```bash
python3 << 'PYEOF'
import json, sys

# قراءة JSON من string
raw = '{"name": "أفق", "version": 6, "active": true}'
data = json.loads(raw)
print(f"Name: {data['name']}")
print(f"Active: {data['active']}")

# قراءة JSON من ملف
try:
    with open('/tmp/data.json') as f:
        config = json.load(f)
    print(json.dumps(config, ensure_ascii=False, indent=2))
except FileNotFoundError:
    print("الملف غير موجود")

# كتابة JSON
output = {"status": "done", "count": 42, "items": ["a", "b"]}
with open('/tmp/output.json', 'w') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print("تم حفظ output.json")
PYEOF
```

### 1.4 معالجة CSV

```bash
python3 << 'PYEOF'
import csv, io, sys

# بيانات مثال
raw_csv = """name,score,date
أحمد,95,2025-01-15
محمد,87,2025-01-16
فاطمة,92,2025-01-17
"""

reader = csv.DictReader(io.StringIO(raw_csv))
rows = list(reader)

print(f"عدد الصفوف: {len(rows)}")
for row in rows:
    print(f"  {row['name']}: {row['score']}")

# كتابة CSV
with open('/tmp/output.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['name', 'score', 'date'])
    writer.writeheader()
    writer.writerows(rows)
print("تم حفظ output.csv")
PYEOF
```

### 1.5 HTTP requests في Python

```bash
pip install requests --quiet --break-system-packages

python3 << 'PYEOF'
import requests, json, sys

# GET request
try:
    resp = requests.get(
        'https://api.github.com/repos/torvalds/linux',
        headers={'User-Agent': 'OFOQ/6.0'},
        timeout=30
    )
    resp.raise_for_status()  # يرمي exception إذا status != 2xx
    data = resp.json()
    print(f"Stars: {data['stargazers_count']:,}")
    print(f"Language: {data['language']}")
except requests.Timeout:
    print("ERROR: timeout", file=sys.stderr)
    sys.exit(1)
except requests.HTTPError as e:
    print(f"ERROR: HTTP {e.response.status_code}", file=sys.stderr)
    sys.exit(1)

# POST request مع JSON body
payload = {"message": "hello", "active": True}
resp2 = requests.post(
    'https://httpbin.org/post',
    json=payload,
    headers={'Authorization': 'Bearer TOKEN_HERE'},
    timeout=30
)
print(f"POST status: {resp2.status_code}")
PYEOF
```

### 1.6 تواريخ وأوقات

```bash
python3 << 'PYEOF'
from datetime import datetime, timedelta, timezone
import zoneinfo

# توقيت القاهرة
cairo_tz = zoneinfo.ZoneInfo('Africa/Cairo')
now_cairo = datetime.now(cairo_tz)
print(f"الآن في القاهرة: {now_cairo.strftime('%Y-%m-%d %H:%M:%S %Z')}")
print(f"اليوم: {now_cairo.strftime('%A')} ({now_cairo.weekday()})")

# UTC
now_utc = datetime.now(timezone.utc)
print(f"UTC: {now_utc.isoformat()}")

# تواريخ مستقبلية
tomorrow = now_cairo + timedelta(days=1)
next_week = now_cairo + timedelta(weeks=1)
print(f"غداً: {tomorrow.strftime('%Y-%m-%d')}")
print(f"الأسبوع القادم: {next_week.strftime('%Y-%m-%d')}")

# كم يوم تبقى على نهاية السنة
year_end = datetime(now_cairo.year, 12, 31, tzinfo=cairo_tz)
days_left = (year_end - now_cairo).days
print(f"أيام متبقية على نهاية السنة: {days_left}")

# تحويل timestamp
ts = 1700000000
dt = datetime.fromtimestamp(ts, tz=cairo_tz)
print(f"Timestamp {ts} = {dt.strftime('%Y-%m-%d %H:%M')}")
PYEOF
```

### 1.7 نظام الملفات

```bash
python3 << 'PYEOF'
import os, shutil, pathlib

# قراءة ملف
try:
    content = pathlib.Path('/tmp/test.txt').read_text(encoding='utf-8')
    print(f"المحتوى: {content[:100]}")
except FileNotFoundError:
    print("الملف غير موجود")

# كتابة ملف
pathlib.Path('/tmp/output.txt').write_text(
    "محتوى الملف هنا\nسطر ثاني\n",
    encoding='utf-8'
)

# قراءة مجلد
for f in pathlib.Path('/tmp').iterdir():
    if f.is_file():
        print(f"  {f.name}: {f.stat().st_size:,} bytes")

# إنشاء مجلد وملفات
os.makedirs('/tmp/my_project', exist_ok=True)
(pathlib.Path('/tmp/my_project') / 'config.json').write_text('{}')

# حذف ملف/مجلد
try:
    os.remove('/tmp/old_file.txt')
    shutil.rmtree('/tmp/old_dir', ignore_errors=True)
except: pass

print("✓ عمليات الملفات تمت")
PYEOF
```

### 1.8 تثبيت حزم Python وفحص التوفر

```bash
# تثبيت حزمة واحدة
pip install requests --quiet --break-system-packages

# تثبيت عدة حزم
pip install requests pandas beautifulsoup4 --quiet --break-system-packages

# التحقق من التثبيت
python3 -c "import requests; print('requests OK:', requests.__version__)"

# تثبيت مشروط (إذا غير موجود)
python3 -c "import pandas" 2>/dev/null || pip install pandas --quiet --break-system-packages

# قراءة requirements.txt
echo "requests==2.31.0
pandas>=2.0.0
python-dotenv" > /tmp/requirements.txt
pip install -r /tmp/requirements.txt --quiet --break-system-packages
```

### 1.9 subprocess — تشغيل أوامر من Python

```bash
python3 << 'PYEOF'
import subprocess, sys

# تشغيل أمر وقراءة النتيجة
result = subprocess.run(
    ['git', 'rev-parse', '--short', 'HEAD'],
    capture_output=True, text=True, cwd='/tmp'
)
if result.returncode == 0:
    print(f"Git commit: {result.stdout.strip()}")
else:
    print(f"Git error: {result.stderr.strip()}", file=sys.stderr)

# تشغيل أمر بشكل آمن مع check=True
try:
    out = subprocess.check_output(
        ['python3', '--version'],
        stderr=subprocess.STDOUT,
        text=True
    )
    print(f"Python: {out.strip()}")
except subprocess.CalledProcessError as e:
    print(f"فشل: {e.output}", file=sys.stderr)
    sys.exit(1)

# تشغيل أمر معقد عبر shell
result2 = subprocess.run(
    'echo "hello" | tr a-z A-Z',
    shell=True, capture_output=True, text=True
)
print(f"نتيجة: {result2.stdout.strip()}")
PYEOF
```

---

## 2. curl — HTTP Requests

### 2.1 GET بسيط

```bash
# JSON response
curl -sf \
  -H "Accept: application/json" \
  -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/torvalds/linux" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Stars: {d[\"stargazers_count\"]:,}')"

# مع Authorization
TOKEN="ghp_xxx"
curl -sf \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/user" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login'), '|', d.get('name'))"
```

### 2.2 POST مع JSON body

```bash
TOKEN="ghp_xxx"
OWNER="myuser"
REPO="myrepo"

# إرسال JSON
curl -sf -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: OFOQ/6.0" \
  -d '{"title":"Issue جديد","body":"محتوى الـ issue"}' \
  "https://api.github.com/repos/$OWNER/$REPO/issues" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Issue #' + str(d.get('number')), d.get('html_url'))"
```

### 2.3 تنزيل ملف

```bash
URL="https://example.com/file.zip"

# تنزيل مع progress
curl -L -o /tmp/file.zip "$URL"
echo "الحجم: $(du -sh /tmp/file.zip | cut -f1)"

# تنزيل بـ token مع follow redirects
curl -sL \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/octet-stream" \
  -o /tmp/downloaded_file \
  "$URL"
ls -lh /tmp/downloaded_file
```

### 2.4 معالجة أخطاء curl

```bash
# -f يفشل عند HTTP error (4xx, 5xx)
# -s silent (بدون progress)
# -S اعرض الأخطاء رغم -s

response=$(curl -sfS \
  -H "Authorization: token $TOKEN" \
  "https://api.github.com/user" 2>&1) || {
  echo "فشل curl: $response"
  exit 1
}

echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['login'])"
```

---

## 3. Git Operations

### 3.1 إعداد Git في GitHub Actions

```bash
git config --global user.email "agent@ofoq.app"
git config --global user.name "OFOQ Agent"
git config --global init.defaultBranch main
echo "✓ Git configured"
```

### 3.2 Clone و Push

```bash
TOKEN="ghp_xxx"
OWNER="myuser"
REPO="myrepo"

# Clone
git clone "https://$TOKEN@github.com/$OWNER/$REPO.git" /tmp/repo
cd /tmp/repo

# إجراء تغييرات
echo "تغيير جديد $(date)" >> README.md

# Commit و Push
git add -A
git commit -m "تحديث تلقائي من OFOQ Agent $(date +%Y-%m-%d)"
git push origin main

echo "✓ تم Push بنجاح"
```

### 3.3 قراءة ملف من GitHub بدون clone

```bash
TOKEN="ghp_xxx"
OWNER="myuser"
REPO="myrepo"
FILE_PATH="config/settings.json"

# قراءة مباشرة عبر API
curl -sf \
  -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/contents/$FILE_PATH" \
  | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
content = base64.b64decode(data['content']).decode('utf-8')
print(content)
"
```

### 3.4 GitHub Releases

```bash
TOKEN="ghp_xxx"
OWNER="myuser"
REPO="myrepo"

# جلب كل الـ releases
curl -sf \
  -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  | python3 -c "
import sys, json
releases = json.load(sys.stdin)
for r in releases[:5]:
    print(f\"{r['tag_name']:20} | {r['name'][:40]:40} | assets: {len(r['assets'])}\")
"

# إنشاء release جديد
curl -sf -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d "{
    \"tag_name\": \"v1.0.0\",
    \"name\": \"الإصدار الأول\",
    \"body\": \"وصف الإصدار هنا\",
    \"draft\": false,
    \"prerelease\": false
  }" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Release ID:', d['id'], '|', d['html_url'])"
```

---

## 4. معالجة البيانات

### 4.1 jq — فلترة JSON في bash

```bash
# تثبيت إذا غير موجود
which jq || sudo apt-get install -y jq -q

# استخراج قيمة
echo '{"name": "أفق", "version": 6}' | jq -r '.name'

# فلترة array
echo '[{"id":1,"name":"a"},{"id":2,"name":"b"}]' | jq -r '.[].name'

# فلترة بشرط
echo '[{"score":95,"pass":true},{"score":40,"pass":false}]' \
  | jq -r '.[] | select(.pass==true) | .score'

# إنشاء JSON جديد
jq -n --arg name "أفق" --argjson ver 6 '{"name":$name,"version":$ver}'
```

### 4.2 معالجة text بدون Python

```bash
# استخراج سطر بـ grep
grep "pattern" file.txt || echo "لم يُوجد"

# بحث واستبدال بـ sed
sed 's/القديم/الجديد/g' file.txt

# طباعة عمود محدد بـ awk
echo "ahmed 95 pass" | awk '{print $1, $2}'

# عد الأسطر والكلمات
wc -l < file.txt  # عد الأسطر
wc -w < file.txt  # عد الكلمات

# أول N سطر / آخر N سطر
head -10 file.txt
tail -20 file.txt

# ترتيب وإزالة التكرار
sort file.txt | uniq -c | sort -rn | head -10
```

### 4.3 حسابات رياضية

```bash
# bash arithmetic
echo $((100 * 3 / 4))
echo $(( $(date +%s) - 1700000000 ))  # فرق بالثواني

# حسابات دقيقة بـ bc
echo "scale=4; 22/7" | bc
echo "scale=2; sqrt(144)" | bc -l

# Python للأرقام الكبيرة
python3 -c "
import math
n = 2**128
print(f'2^128 = {n:,}')
print(f'sqrt(2) = {math.sqrt(2):.10f}')
print(f'pi = {math.pi:.10f}')
"
```

---

## 5. شبكة وإنترنت

### 5.1 فحص اتصال

```bash
# ping
ping -c 3 google.com && echo "✓ الإنترنت يعمل" || echo "✗ لا يوجد اتصال"

# فحص port معين
nc -zv api.github.com 443 2>&1 && echo "✓ GitHub API متاح"

# فحص DNS
nslookup api.github.com | tail -3

# اختبار سرعة الاستجابة
time curl -sf -o /dev/null https://api.github.com
```

### 5.2 scraping مواقع

```bash
pip install beautifulsoup4 requests --quiet --break-system-packages

python3 << 'PYEOF'
import requests
from bs4 import BeautifulSoup

url = "https://example.com"
headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; OFOQ/6.0)',
    'Accept-Language': 'ar,en;q=0.9'
}

try:
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    
    soup = BeautifulSoup(resp.text, 'html.parser')
    
    # استخراج العنوان
    print(f"Title: {soup.title.string if soup.title else 'N/A'}")
    
    # استخراج كل الروابط
    links = soup.find_all('a', href=True)
    print(f"روابط: {len(links)}")
    for link in links[:5]:
        print(f"  {link['href']}: {link.text.strip()[:50]}")
    
    # استخراج نص معين
    paragraphs = soup.find_all('p')
    for p in paragraphs[:3]:
        print(f"  {p.text.strip()[:100]}")
        
except Exception as e:
    print(f"فشل: {e}")
PYEOF
```

---

## 6. أنظمة وملفات

### 6.1 معلومات النظام

```bash
# معلومات أساسية
echo "=== System Info ==="
echo "OS: $(cat /etc/os-release | grep PRETTY | cut -d'"' -f2)"
echo "CPU cores: $(nproc)"
echo "RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $4}') free"
echo "Uptime: $(uptime -p)"

# متغيرات البيئة المتاحة
env | grep -E "GITHUB|RUNNER|HOME|PATH" | sort
```

### 6.2 إدارة العمليات

```bash
# تشغيل في الخلفية
some_command &
PID=$!
echo "PID: $PID"

# انتظار انتهاء
wait $PID
echo "انتهى بـ exit code: $?"

# timeout لأمر محدد
timeout 30 long_running_command || echo "انتهت المهلة"
```

### 6.3 Zip وضغط الملفات

```bash
# ضغط مجلد
zip -r /tmp/output.zip /tmp/my_project
echo "حجم: $(du -sh /tmp/output.zip | cut -f1)"

# فك الضغط
unzip -o /tmp/output.zip -d /tmp/extracted

# tar
tar -czf /tmp/backup.tar.gz /tmp/my_project
tar -xzf /tmp/backup.tar.gz -C /tmp/
```

---

## 7. GitHub API — مرجع سريع

```bash
TOKEN="ghp_xxx"
OWNER="myuser"
REPO="myrepo"

# ── USER ──────────────────────────────────────────────────────
# معلومات المستخدم
curl -sf -H "Authorization: token $TOKEN" https://api.github.com/user \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['login'], '|', d['name'], '|', d['public_repos'], 'repos')"

# ── REPOS ─────────────────────────────────────────────────────
# قائمة الـ repos
curl -sf -H "Authorization: token $TOKEN" https://api.github.com/user/repos?per_page=50 \
  | python3 -c "import sys,json; [print(r['name'], r['private']) for r in json.load(sys.stdin)]"

# ── ISSUES ────────────────────────────────────────────────────
# جلب issues
curl -sf -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/issues?state=open" \
  | python3 -c "import sys,json; [print(f\"#{i['number']} {i['title'][:60]}\") for i in json.load(sys.stdin)]"

# إغلاق issue
ISSUE_NUMBER=5
curl -sf -X PATCH \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER" \
  -d '{"state":"closed"}'

# ── DISPATCH ──────────────────────────────────────────────────
# تشغيل workflow يدوياً
curl -sf -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$OWNER/$REPO/dispatches" \
  -d '{"event_type":"my-event","client_payload":{"key":"value"}}'

# ── CONTENTS ──────────────────────────────────────────────────
# كتابة/تحديث ملف في repo
CONTENT=$(echo "محتوى الملف" | base64 -w 0)

# جلب SHA الحالي للملف (مطلوب للتحديث)
SHA=$(curl -sf -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/contents/path/to/file.txt" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || echo "")

# إنشاء أو تحديث
BODY='{"message":"تحديث تلقائي","content":"'"$CONTENT"'"}'
[[ -n "$SHA" ]] && BODY='{"message":"تحديث تلقائي","content":"'"$CONTENT"'","sha":"'"$SHA"'"}'

curl -sf -X PUT \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/contents/path/to/file.txt" \
  -d "$BODY" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('✓', d['content']['path'])"
```

---

## 8. تحديث memory.md — أمثلة صحيحة كاملة

### 8.1 بعد التحقق من GitHub Token

```xml
<action type="update_memory">
## CONFIG
github_token: ghp_abc123
github_repo_owner: myuser
github_repo_name: myrepo
github_status: verified
github_last_verified: 2025-04-20T10:00:00Z

## TASKS
null

## SCHEDULES
null

## RECENT LOG
2025-04-20 10:00 | github verify | ✅ myuser (12 repos)

## USER PREFERENCES
null

## NOTES
null
</action>
```

### 8.2 بعد إضافة مهمة مجدولة

```xml
<action type="update_memory">
## CONFIG
github_token: ghp_abc123
github_repo_owner: myuser
github_repo_name: myrepo
github_status: verified
github_last_verified: 2025-04-20T10:00:00Z

## TASKS
task_001:
  title: نشر المحتوى اليومي
  status: active
  created: 2025-04-20

## SCHEDULES
SCHEDULE_001:
  name: نشر يومي
  cron: "0 8 * * *"
  action: نشر المحتوى الجديد من repo ofoq-videos
  last_run: null
  next_run: 2025-04-21
  status: active
  created: 2025-04-20

## RECENT LOG
2025-04-20 10:00 | github verify | ✅ myuser (12 repos)
2025-04-20 10:05 | schedule create | ✅ SCHEDULE_001 - نشر يومي الساعة 8 ص

## USER PREFERENCES
language: arabic_egyptian
timezone: Africa/Cairo

## NOTES
المستخدم يريد النشر صباحاً قبل بدء العمل
</action>
```

### 8.3 بعد فشل عملية — سجّل الخطأ

```xml
<action type="update_memory">
## CONFIG
[نفس القيم السابقة]

## TASKS
[نفس المهام]

## SCHEDULES
[نفس الجداول]

## RECENT LOG
2025-04-20 10:00 | github verify | ✅ myuser
2025-04-20 10:05 | schedule create | ✅ SCHEDULE_001
2025-04-20 11:00 | youtube upload | ❌ فشل — refresh_token منتهي الصلاحية

## USER PREFERENCES
language: arabic_egyptian

## NOTES
YouTube refresh_token انتهت صلاحيته في 2025-04-20
المستخدم يحتاج إعادة الـ OAuth flow لـ YouTube
</action>
```

---

## 9. اختبار API ومنصات مختلفة

### 9.1 YouTube Data API v3

```bash
ACCESS_TOKEN="ya29_xxx"

# رفع فيديو
python3 << 'PYEOF'
import requests, json, os

ACCESS_TOKEN = os.environ['YT_TOKEN']
VIDEO_FILE   = '/tmp/video.mp4'

# الخطوة 1: initiating upload (resumable)
metadata = {
    "snippet": {
        "title": "عنوان الفيديو",
        "description": "وصف تفصيلي",
        "tags": ["إسلام", "قرآن"],
        "categoryId": "22",
        "defaultLanguage": "ar"
    },
    "status": {
        "privacyStatus": "public",
        "selfDeclaredMadeForKids": False
    }
}

resp = requests.post(
    'https://www.googleapis.com/upload/youtube/v3/videos',
    params={'uploadType': 'resumable', 'part': 'snippet,status'},
    headers={
        'Authorization': f'Bearer {ACCESS_TOKEN}',
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4'
    },
    json=metadata,
    timeout=30
)

if resp.status_code == 200:
    upload_url = resp.headers['Location']
    print(f"Upload URL: {upload_url[:50]}...")
    
    # الخطوة 2: رفع الملف
    with open(VIDEO_FILE, 'rb') as f:
        video_data = f.read()
    
    upload_resp = requests.put(
        upload_url,
        data=video_data,
        headers={'Content-Type': 'video/mp4'},
        timeout=300
    )
    
    if upload_resp.status_code in (200, 201):
        vid_id = upload_resp.json()['id']
        print(f"✅ تم الرفع: https://youtu.be/{vid_id}")
    else:
        print(f"❌ فشل الرفع: {upload_resp.status_code}")
else:
    print(f"❌ فشل الـ initiation: {resp.status_code}: {resp.text[:200]}")
PYEOF
```

### 9.2 Telegram Bot API

```bash
BOT_TOKEN="xxx:yyy"
CHAT_ID="123456789"

# إرسال رسالة نصية
curl -sf -X POST \
  "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{
    \"chat_id\": \"$CHAT_ID\",
    \"text\": \"✅ تم تنفيذ المهمة بنجاح\",
    \"parse_mode\": \"HTML\"
  }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d['ok'] else d['description'])"

# إرسال ملف
curl -sf -X POST \
  "https://api.telegram.org/bot$BOT_TOKEN/sendDocument" \
  -F "chat_id=$CHAT_ID" \
  -F "document=@/tmp/report.pdf" \
  -F "caption=التقرير اليومي" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Sent!' if d['ok'] else d['description'])"
```

### 9.3 Notion API

```bash
NOTION_TOKEN="secret_xxx"
DATABASE_ID="yyy"

# إضافة entry لـ database
curl -sf -X POST \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  "https://api.notion.com/v1/pages" \
  -d "{
    \"parent\": {\"database_id\": \"$DATABASE_ID\"},
    \"properties\": {
      \"Name\": {\"title\": [{\"text\": {\"content\": \"عنوان المهمة\"}}]},
      \"Status\": {\"select\": {\"name\": \"Done\"}},
      \"Date\": {\"date\": {\"start\": \"$(date +%Y-%m-%d)\"}}
    }
  }" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','ERROR')[:8])"
```

---

## 10. حساب وقت الصلاة (خاص)

```bash
python3 << 'PYEOF'
import math, datetime, zoneinfo

def prayer_times(lat=30.0444, lng=31.2357, date=None):
    """حساب أوقات الصلاة لأي موقع جغرافي"""
    if date is None:
        date = datetime.date.today()
    
    D2R = math.pi / 180
    
    # Julian Day Number
    y, m, d = date.year, date.month, date.day
    JD = (int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d 
          - (2 - int(y/100) + int(int(y/100)/4)) - 1524.5)
    
    n = JD - 2451545.0
    L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360
    g = ((357.528 + 0.9856003 * n) % 360) * D2R
    lam = (L + 1.915 * math.sin(g) + 0.020 * math.sin(2*g)) * D2R
    eps = 23.439 * D2R
    dec = math.asin(math.sin(eps) * math.sin(lam))
    RA  = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    noon_utc = 12 - lng/15 - ((L * D2R - RA) * 12 / math.pi)
    noon_local = noon_utc + 2  # Cairo UTC+2
    
    def time_for_angle(angle_deg):
        cosH = ((math.sin(angle_deg * D2R) - math.sin(lat * D2R) * math.sin(dec))
                / (math.cos(lat * D2R) * math.cos(dec)))
        if abs(cosH) > 1: return None
        H = math.acos(cosH) * 12 / math.pi
        return H
    
    def fmt(h):
        if h is None: return "N/A"
        h = (h % 24 + 24) % 24
        return f"{int(h):02d}:{int((h - int(h))*60):02d}"
    
    fajr_H  = time_for_angle(-18)
    sunrise_H = time_for_angle(-0.833)
    sunset_H  = time_for_angle(-0.833)
    isha_H   = time_for_angle(-17)
    
    # Asr (Shafi'i: shadow = length + noon shadow)
    noon_alt = 90 - abs(lat - math.degrees(dec))
    asr_factor = math.atan2(1, math.tan(math.radians(noon_alt - 45 if noon_alt > 45 else noon_alt)))
    asr_H = math.acos((math.sin(asr_factor) - math.sin(lat*D2R)*math.sin(dec))
                       / (math.cos(lat*D2R)*math.cos(dec))) * 12 / math.pi if abs(
                       (math.sin(asr_factor) - math.sin(lat*D2R)*math.sin(dec))
                       / (math.cos(lat*D2R)*math.cos(dec))) <= 1 else None
    
    times = {
        "الفجر":   fmt(noon_local - fajr_H)  if fajr_H else "N/A",
        "الشروق":  fmt(noon_local - sunrise_H) if sunrise_H else "N/A",
        "الظهر":   fmt(noon_local),
        "العصر":   fmt(noon_local + asr_H)    if asr_H else "N/A",
        "المغرب":  fmt(noon_local + sunset_H) if sunset_H else "N/A",
        "العشاء":  fmt(noon_local + isha_H)   if isha_H else "N/A",
    }
    return times

times = prayer_times()
print(f"أوقات الصلاة في القاهرة — {datetime.date.today()}")
for name, time in times.items():
    print(f"  {name}: {time}")
PYEOF
```

---

## 11. جدولة المهام — بنية صحيحة

### 11.1 توزيع مواعيد النشر بعد الفجر

```bash
python3 << 'PYEOF'
import random, datetime, zoneinfo

def schedule_posts(fajr_time_str, count=4, spread_hours=12):
    """توزيع مواعيد النشر على مدار اليوم"""
    cairo = zoneinfo.ZoneInfo('Africa/Cairo')
    today = datetime.date.today()
    
    fh, fm = map(int, fajr_time_str.split(':'))
    start = datetime.datetime(today.year, today.month, today.day, fh, fm, tzinfo=cairo)
    
    # ابدأ 30 دقيقة بعد الفجر
    start += datetime.timedelta(minutes=30)
    end = start + datetime.timedelta(hours=spread_hours)
    
    total_minutes = int((end - start).total_seconds() / 60)
    interval = total_minutes // count
    
    slots = []
    for i in range(count):
        offset = i * interval + random.randint(-10, 10)
        offset = max(0, min(total_minutes - 1, offset))
        slot = start + datetime.timedelta(minutes=offset)
        slots.append(slot)
    
    slots.sort()
    return [s.strftime('%H:%M') for s in slots]

slots = schedule_posts("05:18", count=5)
print("مواعيد النشر المقترحة:")
for i, s in enumerate(slots, 1):
    print(f"  {i}. الساعة {s}")
PYEOF
```

---

## 13. create_schedule — أمثلة JSON صحيحة كاملة

### 13.1 حكمة يومية الساعة 9 صباحاً

```xml
<action type="create_schedule">
{
  "name": "حكمة يومية",
  "description": "حكمة عربية أصيلة كل صباح",
  "cron": "0 9 * * *",
  "taskPrompt": "اكتب حكمة عربية أصيلة ومختصرة في سطر واحد، ثم اشرحها في سطرين بأسلوب بسيط وعميق.",
  "timezone": "Africa/Cairo"
}
</action>
```

### 13.2 تقرير أسبوعي كل جمعة الساعة 8 مساءً

```xml
<action type="create_schedule">
{
  "name": "ملخص أسبوعي",
  "description": "ملخص للأحداث التقنية الأسبوع الماضي",
  "cron": "0 20 * * 5",
  "taskPrompt": "اكتب ملخصاً مختصراً لأبرز 5 أحداث في عالم التقنية خلال الأسبوع الماضي. استخدم shell لجلب أخبار حديثة من مصادر موثوقة إذا أمكن.",
  "timezone": "Africa/Cairo"
}
</action>
```

### 13.3 تذكير بالنشاط كل يومين الساعة 7 صباحاً

```xml
<action type="create_schedule">
{
  "name": "تذكير الصباح",
  "description": "تذكير بمهام اليوم",
  "cron": "0 7 */2 * *",
  "taskPrompt": "اكتب رسالة تحفيزية قصيرة لبدء يوم منتج، ثم ذكّر بـ3 نصائح عملية للتركيز والإنتاجية.",
  "timezone": "Africa/Cairo"
}
</action>
```

### 13.4 فحص تقني كل ساعة

```xml
<action type="create_schedule">
{
  "name": "فحص دوري",
  "description": "فحص حالة سيرفر أو API",
  "cron": "0 * * * *",
  "taskPrompt": "نفّذ shell لفحص حالة الـ GitHub API وأي سيرفر محفوظ في memory. أبلغ عن الحالة بـ ✅ أو ❌.",
  "timezone": "Africa/Cairo"
}
</action>
```

### 13.5 cron cheatsheet سريع

| النمط | المعنى |
|---|---|
| `0 9 * * *` | كل يوم الساعة 9:00 ص |
| `30 8 * * *` | كل يوم الساعة 8:30 ص |
| `0 9 * * 5` | كل جمعة الساعة 9:00 ص |
| `0 9 * * 1-5` | كل يوم عمل (إثنين–جمعة) |
| `0 9,18 * * *` | كل يوم 9 ص و6 م |
| `*/30 * * * *` | كل 30 دقيقة |
| `0 * * * *` | كل ساعة |
| `0 9 1 * *` | أول كل شهر الساعة 9 |
| `0 9 */2 * *` | كل يومين الساعة 9 |

**ملاحظة:** الدقة التقنية لـ scheduler في هذا النظام = كل دقيقة (GitHub Actions `* * * * *`). المهام المحددة بالدقيقة دقيقتها الفعلية ≈ ±1 دقيقة.

```bash
# ┌─ دقيقة (0-59)
# │ ┌─ ساعة (0-23)
# │ │ ┌─ يوم الشهر (1-31)
# │ │ │ ┌─ شهر (1-12)
# │ │ │ │ ┌─ يوم الأسبوع (0-6, 0=الأحد)
# │ │ │ │ │
# * * * * *

# أمثلة:
# "0 8 * * *"     كل يوم الساعة 8 صباحاً
# "0 8 * * 5"     كل جمعة الساعة 8 صباحاً
# "*/30 * * * *"  كل 30 دقيقة
# "0 0 1 * *"     أول كل شهر منتصف الليل
# "0 8,12,18 * * *" كل يوم الساعة 8 و12 و6 مساءً

# التحقق من cron expression
python3 -c "
from datetime import datetime
import zoneinfo

CRON = '0 8 * * *'
print(f'Cron: {CRON}')
# يمكن استخدام مكتبة croniter للحسابات الدقيقة
"
```

---

## 12. تثبيت أدوات متخصصة

### 12.1 ffmpeg — معالجة الوسائط

```bash
# تثبيت
sudo apt-get install -y ffmpeg -q

# فحص
ffmpeg -version | head -1

# تحويل فيديو
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -c:a aac output.mp4 -y

# استخراج صوت
ffmpeg -i video.mp4 -vn -acodec mp3 audio.mp3 -y

# thumbnail من فيديو
ffmpeg -i video.mp4 -ss 00:00:05 -vframes 1 thumbnail.jpg -y

# دمج فيديو وصوت
ffmpeg -i video_no_audio.mp4 -i audio.mp3 -c:v copy -c:a aac output.mp4 -y
```

### 12.2 Node.js و npm

```bash
# فحص
node --version && npm --version

# تثبيت حزمة
npm install -g some-package

# تشغيل script صغير
node -e "
const https = require('https');
https.get('https://api.github.com', {headers:{'User-Agent':'OFOQ/6.0'}}, r => {
  console.log('Status:', r.statusCode);
}).on('error', e => console.error(e.message));
"
```

### 12.3 ImageMagick — معالجة الصور

```bash
# تثبيت
sudo apt-get install -y imagemagick -q

# تغيير حجم صورة
convert input.jpg -resize 1280x720 output.jpg

# إضافة نص على صورة
convert input.jpg \
  -font /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
  -pointsize 36 \
  -fill white \
  -annotate +50+50 "OFOQ Agent" \
  output.jpg

# تحويل PDF لصور
convert -density 150 document.pdf -quality 90 page_%03d.jpg
```

---

---

## 14. البحث العميق في الإنترنت — Web Scraping & Research

### 14.1 الاستراتيجية العامة للبحث العميق

```
المستوى 1 — curl + python (سريع، للمواقع العادية)
المستوى 2 — Playwright headless (للمواقع التي تتطلب JavaScript)
المستوى 3 — Playwright + Stealth (للمواقع ذات الحماية المتقدمة)

اختر المستوى الأخف الذي يحقق النتيجة — لا تبدأ من 3 مباشرة.
```

---

### 14.2 المستوى 1 — curl + BeautifulSoup (للمواقع العادية)

```bash
pip install requests beautifulsoup4 lxml --quiet --break-system-packages

python3 << 'PYEOF'
import requests, time, random
from bs4 import BeautifulSoup

# Headers تقليد المتصفح الحقيقي
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
}

session = requests.Session()
session.headers.update(HEADERS)

def safe_get(url, retries=3):
    """جلب URL مع retry وtimeout"""
    for i in range(retries):
        try:
            resp = session.get(url, timeout=20, allow_redirects=True)
            resp.raise_for_status()
            return resp
        except Exception as e:
            if i < retries - 1:
                time.sleep(random.uniform(2, 5))
            else:
                print(f"❌ فشل {url}: {e}")
                return None

def extract_text(html):
    """استخرج النص النظيف من HTML"""
    soup = BeautifulSoup(html, 'lxml')
    # احذف scripts, styles, nav, footer
    for tag in soup(['script','style','nav','footer','header','aside','iframe']):
        tag.decompose()
    text = soup.get_text(separator='\n', strip=True)
    # احذف الأسطر الفارغة المتكررة
    lines = [l for l in text.split('\n') if l.strip()]
    return '\n'.join(lines)

# مثال بحث
url = "https://en.wikipedia.org/wiki/Artificial_intelligence"
resp = safe_get(url)
if resp:
    text = extract_text(resp.text)
    print(f"المحتوى ({len(text)} حرف):")
    print(text[:2000])
PYEOF
```

---

### 14.3 المستوى 2 — Playwright Headless (للمواقع التي تتطلب JavaScript)

```bash
# تثبيت Playwright مع Chromium فقط (أسرع)
pip install playwright --quiet --break-system-packages
python3 -m playwright install chromium --with-deps
echo "✓ Playwright جاهز"

python3 << 'PYEOF'
import asyncio
from playwright.async_api import async_playwright
import time

async def scrape_js_site(url, wait_for='networkidle', extract_selector=None):
    """جلب موقع يعتمد على JavaScript"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            locale='ar-EG',
        )
        
        page = await context.new_page()
        
        # حجب الموارد غير الضرورية للسرعة
        await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2}',
                         lambda route: route.abort())
        
        await page.goto(url, wait_until=wait_for, timeout=30000)
        
        if extract_selector:
            await page.wait_for_selector(extract_selector, timeout=10000)
            content = await page.text_content(extract_selector)
        else:
            content = await page.inner_text('body')
        
        await browser.close()
        return content

# تشغيل
content = asyncio.run(scrape_js_site(
    'https://news.ycombinator.com',
    wait_for='domcontentloaded',
))
print(f"المحتوى ({len(content)} حرف):")
print(content[:3000])
PYEOF
```

---

### 14.4 المستوى 3 — Playwright-Extra + Stealth (للمواقع ذات الحماية المتقدمة)

**متى تستخدم هذا المستوى؟**
- المواقع التي ترفض الـ headless browsers (Cloudflare، PerimeterX، DataDome)
- المواقع التي تتطلب تمرير اختبارات كـ CAPTCHA أو fingerprint checks
- البحث في المواقع التجارية الكبيرة

```bash
# تثبيت playwright-stealth (إخفاء علامات automation)
pip install playwright-stealth --quiet --break-system-packages
python3 -m playwright install chromium --with-deps
echo "✓ Playwright-Stealth جاهز"

python3 << 'PYEOF'
import asyncio
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async def stealth_scrape(url, selector=None, wait_ms=2000):
    """جلب موقع محمي مع إخفاء علامات الأتمتة"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ]
        )

        context = await browser.new_context(
            viewport={'width': 1366, 'height': 768},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            locale='en-US',
            timezone_id='Africa/Cairo',
            color_scheme='light',
        )
        
        page = await context.new_page()
        
        # تطبيق Stealth patches — يخفي navigator.webdriver وغيره
        await stealth_async(page)
        
        # محاكاة سلوك بشري — تأخير قبل الانتقال
        await asyncio.sleep(1)
        
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        
        # تأخير بشري بعد التحميل
        await asyncio.sleep(wait_ms / 1000)
        
        if selector:
            try:
                await page.wait_for_selector(selector, timeout=8000)
                text = await page.text_content(selector)
            except:
                text = await page.inner_text('body')
        else:
            text = await page.inner_text('body')

        await browser.close()
        return text

content = asyncio.run(stealth_scrape('https://example.com'))
print(content[:2000])
PYEOF
```

---

### 14.5 محرك بحث عميق متكامل — DuckDuckGo + Bing

```bash
pip install requests beautifulsoup4 lxml --quiet --break-system-packages

python3 << 'PYEOF'
import requests, time, re, json
from bs4 import BeautifulSoup
from urllib.parse import urlencode, urlparse, quote_plus

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.9',
}

def search_duckduckgo(query, max_results=10):
    """بحث عبر DuckDuckGo HTML"""
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.text, 'lxml')
        results = []
        for r in soup.select('.result__body')[:max_results]:
            title_el = r.select_one('.result__title')
            url_el   = r.select_one('.result__url')
            desc_el  = r.select_one('.result__snippet')
            if not title_el: continue
            results.append({
                'title':   title_el.get_text(strip=True),
                'url':     url_el.get_text(strip=True) if url_el else '',
                'snippet': desc_el.get_text(strip=True) if desc_el else '',
            })
        return results
    except Exception as e:
        print(f"DuckDuckGo error: {e}")
        return []

def fetch_page_content(url, max_chars=3000):
    """جلب محتوى صفحة ويب نظيفة"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'lxml')
        for tag in soup(['script','style','nav','footer','header','aside','form','iframe']):
            tag.decompose()
        # استخرج الـ article أو main أو body
        main = soup.find('article') or soup.find('main') or soup.find('body')
        text = main.get_text(separator='\n', strip=True) if main else ''
        lines = [l.strip() for l in text.split('\n') if len(l.strip()) > 30]
        return '\n'.join(lines)[:max_chars]
    except Exception as e:
        return f"فشل الجلب: {e}"

def deep_search(query, num_results=5, fetch_content=True):
    """بحث عميق: ابحث → جلب نتائج → اقرأ كل صفحة"""
    print(f"🔍 بحث: {query}")
    results = search_duckduckgo(query, max_results=num_results)
    print(f"✓ {len(results)} نتيجة")
    
    enriched = []
    for i, r in enumerate(results):
        print(f"  [{i+1}/{len(results)}] {r['title'][:60]}")
        content = ''
        if fetch_content and r['url']:
            url = r['url'] if r['url'].startswith('http') else 'https://' + r['url']
            content = fetch_page_content(url)
            time.sleep(1)  # احترم السيرفر
        enriched.append({ **r, 'content': content })
    
    return enriched

# مثال
results = deep_search("أفضل مكتبات Python لمعالجة اللغة العربية 2025", num_results=5)
for r in results:
    print(f"\n=== {r['title']} ===")
    print(f"URL: {r['url']}")
    print(f"Snippet: {r['snippet']}")
    if r['content']:
        print(f"Content preview: {r['content'][:300]}")
PYEOF
```

---

### 14.6 استخراج بيانات منظّمة (JSON-LD + Meta + OpenGraph)

```bash
python3 << 'PYEOF'
import requests, json
from bs4 import BeautifulSoup

def extract_structured_data(url):
    """استخرج كل البيانات المنظّمة من الصفحة"""
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)'}
    resp = requests.get(url, headers=headers, timeout=15)
    soup = BeautifulSoup(resp.text, 'lxml')
    
    result = {}
    
    # JSON-LD — أغنى مصدر
    for script in soup.find_all('script', type='application/ld+json'):
        try:
            data = json.loads(script.string)
            result['json_ld'] = data
            break
        except: pass
    
    # Open Graph
    og = {}
    for tag in soup.find_all('meta', attrs={'property': lambda p: p and p.startswith('og:')}):
        og[tag.get('property','').replace('og:','')] = tag.get('content','')
    if og: result['open_graph'] = og
    
    # Twitter Card
    tw = {}
    for tag in soup.find_all('meta', attrs={'name': lambda n: n and n.startswith('twitter:')}):
        tw[tag.get('name','').replace('twitter:','')] = tag.get('content','')
    if tw: result['twitter'] = tw
    
    # Meta description + keywords
    desc = soup.find('meta', attrs={'name':'description'})
    if desc: result['description'] = desc.get('content','')
    kw = soup.find('meta', attrs={'name':'keywords'})
    if kw: result['keywords'] = kw.get('content','')
    
    # Canonical URL
    canon = soup.find('link', rel='canonical')
    if canon: result['canonical'] = canon.get('href','')
    
    # Title
    result['title'] = soup.find('title').text.strip() if soup.find('title') else ''
    
    return result

data = extract_structured_data('https://en.wikipedia.org/wiki/Cairo')
print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
PYEOF
```

---

### 14.7 Wikipedia API — بحث مجاني وسريع بدون scraping

```bash
python3 << 'PYEOF'
import requests, json

def wiki_search(query, lang='ar', limit=5):
    """بحث في Wikipedia عبر API الرسمي"""
    # API بحث
    search_url = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        'action': 'query',
        'list':   'search',
        'srsearch': query,
        'srlimit': limit,
        'format': 'json',
        'utf8':   1,
    }
    resp = requests.get(search_url, params=params, timeout=10)
    results = resp.json().get('query', {}).get('search', [])
    return results

def wiki_extract(title, lang='ar', sentences=5):
    """جلب ملخص مقال Wikipedia"""
    url    = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        'action': 'query',
        'titles': title,
        'prop':   'extracts',
        'exsentences': sentences,
        'exintro': True,
        'explaintext': True,
        'format': 'json',
        'utf8':   1,
    }
    resp  = requests.get(url, params=params, timeout=10)
    pages = resp.json().get('query', {}).get('pages', {})
    page  = next(iter(pages.values()))
    return page.get('extract', '')

# مثال
results = wiki_search('الذكاء الاصطناعي', lang='ar')
for r in results[:3]:
    print(f"- {r['title']}: {r['snippet'][:100]}")

print("\n=== ملخص أول نتيجة ===")
if results:
    extract = wiki_extract(results[0]['title'], lang='ar')
    print(extract[:1000])
PYEOF
```

---

### 14.8 جلب أسعار من Yahoo Finance / CoinGecko

```bash
python3 << 'PYEOF'
import requests, json

def get_crypto_prices(coins=['bitcoin','ethereum','binancecoin','solana']):
    """أسعار العملات المشفرة من CoinGecko (مجاني بدون API key)"""
    ids = ','.join(coins)
    url = f"https://api.coingecko.com/api/v3/simple/price"
    params = {
        'ids': ids,
        'vs_currencies': 'usd,sar',
        'include_24hr_change': 'true',
        'include_market_cap': 'true',
    }
    resp = requests.get(url, params=params, timeout=15,
                        headers={'Accept': 'application/json'})
    data = resp.json()
    for coin, info in data.items():
        change = info.get('usd_24h_change', 0)
        arrow  = '📈' if change > 0 else '📉'
        print(f"{arrow} {coin.upper()}: ${info['usd']:,.2f} ({change:+.2f}%) | SAR {info.get('sar',0):,.2f}")
    return data

def get_stock_quote_yahoo(symbol):
    """سعر سهم من Yahoo Finance (بدون API key)"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
    }
    resp = requests.get(url, headers=headers, timeout=10)
    data = resp.json()
    meta = data.get('chart',{}).get('result',[{}])[0].get('meta',{})
    return {
        'symbol':   meta.get('symbol'),
        'price':    meta.get('regularMarketPrice'),
        'currency': meta.get('currency'),
        'exchange': meta.get('exchangeName'),
        'change':   meta.get('regularMarketPrice',0) - meta.get('previousClose',0),
    }

# أسعار عملات
print("=== أسعار العملات ===")
get_crypto_prices()

print("\n=== Apple ===")
aapl = get_stock_quote_yahoo('AAPL')
print(f"AAPL: ${aapl['price']} ({aapl['currency']}) on {aapl['exchange']}")
PYEOF
```

---

### 14.9 استخراج بيانات من ملفات PDF على الإنترنت

```bash
pip install pdfplumber requests --quiet --break-system-packages

python3 << 'PYEOF'
import requests, io, pdfplumber

def extract_pdf_from_url(url, pages=None):
    """تنزيل PDF من URL واستخراج نصه"""
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)'}
    resp    = requests.get(url, headers=headers, timeout=30, stream=True)
    resp.raise_for_status()
    
    pdf_bytes = io.BytesIO(resp.content)
    
    with pdfplumber.open(pdf_bytes) as pdf:
        total_pages = len(pdf.pages)
        print(f"PDF: {total_pages} صفحات")
        
        target_pages = pages or range(min(5, total_pages))  # أول 5 صفحات افتراضياً
        
        text_parts = []
        for i in target_pages:
            page  = pdf.pages[i]
            text  = page.extract_text()
            if text:
                text_parts.append(f"=== صفحة {i+1} ===\n{text}")
        
        return '\n\n'.join(text_parts)

# مثال: بحث أكاديمي
pdf_url = "https://arxiv.org/pdf/2307.09288"  # أي ورقة بحثية
try:
    content = extract_pdf_from_url(pdf_url, pages=range(3))
    print(content[:3000])
except Exception as e:
    print(f"فشل: {e}")
PYEOF
```

---

### 14.10 نمط البحث العميق المتكامل — كيف يستخدمه الـ AI

```
عندما يُطلب منك بحث عميق:

STEP 1 — write_task: سجّل الخطة
<action type="write_task">
## بحث: [موضوع البحث]
## الخطة
1. بحث في DuckDuckGo
2. جلب أبرز 3-5 مواقع
3. استخراج البيانات المطلوبة
4. تنظيم النتائج
## النتائج
(سيُملأ لاحقاً)
</action>

STEP 2 — shell: نفّذ البحث
<action type="shell">
pip install requests beautifulsoup4 lxml -q --break-system-packages
python3 << 'EOF'
# كود البحث من القسم 14.5
EOF
</action>

STEP 3 — write_task: حدّث النتائج
<action type="write_task">
## بحث: [موضوع]
## النتائج
[ما وجدته]
## الملاحظات
[ملاحظات مهمة]
</action>

STEP 4 — رد نهائي مبني على task.md
```

**قواعد مهمة:**
- ابدأ دائماً بالمستوى الأخف (curl → Playwright → Stealth)
- احترم `robots.txt` والـ rate limiting
- لا تُخزّن credentials مواقع في memory
- نتائج البحث الكبيرة → `write_task` أولاً ثم لخّص في الرد

---

## نصائح عامة للكود الصحيح في GitHub Actions

```bash
# ✅ دائماً: set -eo pipefail
# ✅ دائماً: اطبع نتائج وسيطة للتأكيد
# ✅ دائماً: تعامل مع الأخطاء صراحةً
# ✅ دائماً: تحقق من نجاح العملية قبل التالية
# ✅ دائماً: احفظ في memory بعد أي تغيير مهم

# ❌ لا تخمّن قيم credentials
# ❌ لا تطبع tokens كاملة في stdout
# ❌ لا تجمع عمليات غير مترابطة في shell واحد
# ❌ لا تفترض نجاح أمر بدون التحقق من exit code
# ❌ لا تعتمد على ترتيب JSON أو ترتيب الـ API results

# نمط التحقق الصحيح:
command_that_might_fail
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "FAILED with exit code $EXIT_CODE"
  exit 1
fi
echo "✓ نجح"
```

```bash
TOKEN="TOKEN_HERE"
curl -sf \
  -H "Authorization: token $TOKEN" \
  -H "User-Agent: OFOQ/6.0" \
  https://api.github.com/user \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login'), d.get('name'), d.get('public_repos'))"
```

---

## 2. جلب releases من repo

```bash
TOKEN="TOKEN_HERE"
OWNER="OWNER_HERE"
REPO="REPO_HERE"
curl -sf \
  -H "Authorization: token $TOKEN" \
  -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  | python3 -c "import sys,json; [print(r['tag_name'], r['id']) for r in json.load(sys.stdin)]"
```

---

## 3. جلب assets من release pending

```bash
TOKEN="TOKEN_HERE"
OWNER="OWNER_HERE"
REPO="REPO_HERE"
RELEASE_ID=$(curl -sf \
  -H "Authorization: token $TOKEN" \
  -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  | python3 -c "import sys,json; rs=json.load(sys.stdin); r=next((x for x in rs if x['tag_name']=='pending'),None); print(r['id'] if r else '')")
echo "Release ID: $RELEASE_ID"
curl -sf \
  -H "Authorization: token $TOKEN" \
  -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases/$RELEASE_ID/assets" \
  | python3 -c "import sys,json; [print(a['name'], a['size'], a['browser_download_url']) for a in json.load(sys.stdin)]"
```

---

## 4. تجديد YouTube Access Token

```bash
curl -sf -X POST https://oauth2.googleapis.com/token \
  -d "client_id=CLIENT_ID" \
  -d "client_secret=SECRET" \
  -d "refresh_token=REFRESH_TOKEN" \
  -d "grant_type=refresh_token" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('access_token:', d.get('access_token','FAILED')[:30])"
```

---

## 5. حساب وقت الفجر

```bash
python3 << 'PYEOF'
import math, datetime

def calc_fajr(lat=30.0444, lng=31.2357):
    d = datetime.date.today()
    D2R = math.pi/180
    JD = int(365.25*(d.year+4716)) + int(30.6001*(d.month+1)) + d.day - 1524.5
    n = JD - 2451545.0
    L = ((280.460+0.9856474*n)%360+360)%360
    g = ((357.528+0.9856003*n)%360)*D2R
    lam = (L+1.915*math.sin(g)+0.020*math.sin(2*g))*D2R
    eps = 23.439*D2R
    dec = math.asin(math.sin(eps)*math.sin(lam))
    RA  = math.atan2(math.cos(eps)*math.sin(lam), math.cos(lam))
    noon = 12 - lng/15 - ((L*D2R-RA)*12/math.pi) + 2
    cosH = (math.sin(-18*D2R)-math.sin(lat*D2R)*math.sin(dec))/(math.cos(lat*D2R)*math.cos(dec))
    if abs(cosH)>1: return None
    ft = ((noon-math.acos(cosH)*12/math.pi)%24+24)%24
    hh,mm = int(ft), int((ft-int(ft))*60)
    return f"{hh:02d}:{mm:02d}"

print("Fajr:", calc_fajr())
PYEOF
```

---

## 6. توزيع مواعيد النشر

```bash
python3 << 'PYEOF'
import random

def make_slots(start_h, start_m, count):
    s = start_h*60+start_m
    e = 23*60
    if s >= e: s = 6*60+30
    base = (e-s)//max(count,1)
    slots = []
    for i in range(count):
        t = min(e-1, max(s, s+i*base+random.randint(-8,8)))
        slots.append(f"{t//60:02d}:{t%60:02d}")
    return sorted(slots)

# مثال: بعد الفجر 5:18 بـ 30 دقيقة، 4 مواعيد
for s in make_slots(5, 48, 4): print(s)
PYEOF
```

---

## 7. تثبيت مكتبة Python واستخدامها

```bash
pip install requests --quiet
python3 -c "
import requests
r = requests.get('https://api.github.com', headers={'User-Agent':'OFOQ/6.0'})
print('GitHub API status:', r.status_code)
"
```

---

## 8. تنزيل ملف وفحصه

```bash
URL="DOWNLOAD_URL_HERE"
TOKEN="TOKEN_HERE"
curl -sL \
  -H "Authorization: token $TOKEN" \
  -H "User-Agent: OFOQ/6.0" \
  -o /tmp/downloaded_file \
  "$URL"
ls -lh /tmp/downloaded_file
file /tmp/downloaded_file
```

---

## تنسيق update_memory الصحيح — مثال كامل

بعد التحقق من GitHub token يكون الـ update_memory:

```
<action type="update_memory">
## CONFIG
github_token: ghp_abc123
github_repo_owner: myuser
github_repo_name: ofoq-videos
github_status: verified
github_last_verified: 2025-04-20T10:00:00Z
youtube_client_id: null
youtube_client_secret: null
youtube_refresh_token: null
youtube_access_token: null
youtube_status: not_configured
youtube_last_verified: null
settings_lat: 30.0444
settings_lng: 31.2357
settings_fajr_offset_min: 30
settings_posts_per_day: 4

## DAILY PLAN
date: null
fajr: null
status: idle
published: 0
total: 0
slots: null

## SCHEDULES
null

## RECENT LOG
2025-04-20 10:00 | github verify | ✅ myuser (12 repos)

## UPLOADED FILES
null
</action>
```

**ملاحظة:** اكتب الملف كاملاً دائماً — حتى الـ sections اللي ما اتغيرتش.
