# OFOQ Tools — Shell Helpers Reference
# أمثلة جاهزة للاستخدام في shell actions

---

## 1. التحقق من GitHub Token

```bash
TOKEN="$(echo '__MEM__' | grep '^github_token:' | cut -d' ' -f2)"
curl -sf -H "Authorization: token $TOKEN" \
     -H "User-Agent: OFOQ/6.0" \
     https://api.github.com/user | jq '{login, name, public_repos}'
```

---

## 2. جلب قائمة الـ Releases

```bash
TOKEN="__TOKEN__"
OWNER="__OWNER__"
REPO="__REPO__"
curl -sf -H "Authorization: token $TOKEN" \
     -H "User-Agent: OFOQ/6.0" \
     "https://api.github.com/repos/$OWNER/$REPO/releases" | jq '[.[] | {tag: .tag_name, id: .id}]'
```

---

## 3. جلب assets من release pending

```bash
TOKEN="__TOKEN__"
OWNER="__OWNER__"
REPO="__REPO__"
# الحصول على ID الـ release
RELEASE_ID=$(curl -sf -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" | \
  jq -r '.[] | select(.tag_name=="pending") | .id')
echo "Release ID: $RELEASE_ID"
# جلب الـ assets
curl -sf -H "Authorization: token $TOKEN" -H "User-Agent: OFOQ/6.0" \
  "https://api.github.com/repos/$OWNER/$REPO/releases/$RELEASE_ID/assets" | \
  jq '[.[] | {name: .name, size: .size, url: .browser_download_url}]'
```

---

## 4. تجديد YouTube Access Token

```bash
curl -sf -X POST https://oauth2.googleapis.com/token \
  -d "client_id=__CLIENT_ID__" \
  -d "client_secret=__SECRET__" \
  -d "refresh_token=__REFRESH__" \
  -d "grant_type=refresh_token" | jq '{access_token, expires_in}'
```

---

## 5. تحميل ملف من GitHub Release

```bash
TOKEN="__TOKEN__"
URL="__DOWNLOAD_URL__"
OUTPUT="/tmp/video.mp4"
curl -sL -H "Authorization: token $TOKEN" \
     -H "User-Agent: OFOQ/6.0" \
     -o "$OUTPUT" "$URL"
ls -lh "$OUTPUT"
```

---

## 6. حساب وقت الفجر بـ python3

```bash
python3 << 'PYEOF'
import math, datetime

def calc_fajr(lat, lng, date=None):
    if date is None:
        date = datetime.date.today()
    D2R = math.pi / 180
    y, mo, d = date.year, date.month, date.day
    JD = int(365.25*(y+4716)) + int(30.6001*(mo+1)) + d - 1524.5
    n = JD - 2451545.0
    L = ((280.460 + 0.9856474*n) % 360 + 360) % 360
    g = ((357.528 + 0.9856003*n) % 360) * D2R
    lam = (L + 1.915*math.sin(g) + 0.020*math.sin(2*g)) * D2R
    eps = 23.439 * D2R
    dec = math.asin(math.sin(eps)*math.sin(lam))
    RA = math.atan2(math.cos(eps)*math.sin(lam), math.cos(lam))
    noon = 12 - lng/15 - ((L*D2R - RA)*12/math.pi) + 2
    cosH = (math.sin(-18*D2R) - math.sin(lat*D2R)*math.sin(dec)) / \
           (math.cos(lat*D2R)*math.cos(dec))
    if abs(cosH) > 1: return None
    fTime = ((noon - math.acos(cosH)*12/math.pi) % 24 + 24) % 24
    hh, mm = int(fTime), int((fTime - int(fTime))*60)
    return f"{hh:02d}:{mm:02d}"

result = calc_fajr(30.0444, 31.2357)
print(f"Fajr: {result}")
PYEOF
```

---

## 7. توزيع مواعيد النشر

```bash
python3 << 'PYEOF'
import random

def make_slots(start_h, start_m, count):
    s = start_h * 60 + start_m
    e = 23 * 60
    if s >= e: s = 6*60+30
    base = (e - s) // max(count, 1)
    slots = []
    for i in range(count):
        j = random.randint(-8, 8)
        t = min(e-1, max(s, s + i*base + j))
        slots.append(f"{t//60:02d}:{t%60:02d}")
    return sorted(slots)

slots = make_slots(5, 20, 4)  # بعد الفجر 5:20، 4 مواعيد
for s in slots: print(s)
PYEOF
```

---

## 8. تثبيت package و استخدامه

```bash
# تثبيت مكتبة في الـ runner
npm install -g some-package
# أو Python
pip install requests --quiet
python3 -c "import requests; r=requests.get('https://api.example.com'); print(r.status_code)"
```

---

## 9. التحقق من ملف وقراءته

```bash
FILE_ID="__FILE_ID__"
# الملفات مخزنة مؤقتاً في /tmp خلال الـ run
cat "/tmp/uploaded_$FILE_ID.txt" 2>/dev/null || echo "File not found"
```

---

## 10. قراءة قيمة من memory inline

```bash
# قراءة token من محتوى memory.md الذي يُمرر كـ env variable
TOKEN=$(echo "$MEMORY_CONTENT" | grep '^github_token:' | awk '{print $2}')
echo "Token starts with: ${TOKEN:0:8}..."
```

---

## تنسيق memory sections

### CONFIG
```
github_token: ghp_xxx
github_repo_owner: myuser
github_repo_name: myrepo
github_status: verified
github_last_verified: 2025-04-19T10:00:00Z
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
```

### DAILY PLAN
```
date: 2025-04-19
fajr: 04:48
status: active
published: 0
total: 4
slots: 05:20|youtube|video1|pending, 08:15|youtube|video2|pending
```

### SCHEDULES
```
خطة يومية الظهر|build_daily_plan|12:00|28|2025-04-20|2025-04-19|sched_001
```

### RECENT LOG
```
2025-04-19 10:00 | github verify | ✅ myuser
2025-04-19 10:01 | memory save | ✅ CONFIG
```
