# OFOQ Tools — Shell Helpers Reference

---

## 1. التحقق من GitHub Token

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
