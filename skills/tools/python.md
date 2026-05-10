# Python Tools — دليل Python الكامل

## هيكل script سليم
```python
#!/usr/bin/env python3
import sys, json, os
from datetime import datetime, timedelta, timezone

TIMEOUT = 30

def http_get(url, headers=None):
    import urllib.request
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def http_post(url, data, headers=None):
    import urllib.request
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body,
        headers={"Content-Type":"application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def main():
    token = os.environ.get("GITHUB_TOKEN","")
    if not token:
        print("TOKEN missing", file=sys.stderr); sys.exit(1)

if __name__ == "__main__":
    main()
```

## requests library
```bash
pip install requests --break-system-packages -q
```
```python
import requests
s = requests.Session()
s.headers.update({"Authorization": f"token {TOKEN}", "User-Agent": "OFOQ/3.0"})
resp = s.get("https://api.github.com/user", timeout=30)
resp.raise_for_status()
print(resp.json()['login'])
```

## معالجة الأخطاء
```python
import sys, traceback
try:
    result = risky_operation()
except FileNotFoundError as e:
    print(f"File not found: {e}", file=sys.stderr); sys.exit(1)
except json.JSONDecodeError as e:
    print(f"Bad JSON: {e}", file=sys.stderr); sys.exit(1)
except Exception as e:
    traceback.print_exc(); sys.exit(1)
```

## Retry تلقائي
```python
import time, urllib.request, json

def api_call_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise

```

## الوقت والتاريخ
```python
from datetime import datetime, timedelta, timezone
import math

now_cairo = datetime.now(timezone(timedelta(hours=2)))
print(f"القاهرة: {now_cairo.strftime('%Y-%m-%d %H:%M')}")

def calc_fajr(lat=30.0444, lng=31.2357):
    D2R = math.pi/180
    d = datetime.now()
    JD = int(365.25*(d.year+4716))+int(30.6001*(d.month+1))+d.day-1524.5
    n  = JD-2451545.0
    L  = ((280.460+0.9856474*n)%360+360)%360
    g  = ((357.528+0.9856003*n)%360)*D2R
    lam= (L+1.915*math.sin(g)+0.020*math.sin(2*g))*D2R
    eps= 23.439*D2R
    dec= math.asin(math.sin(eps)*math.sin(lam))
    RA = math.atan2(math.cos(eps)*math.sin(lam),math.cos(lam))
    noon= 12-lng/15-((L*D2R-RA)*12/math.pi)+2
    cosH= (math.sin(-18*D2R)-math.sin(lat*D2R)*math.sin(dec))/(math.cos(lat*D2R)*math.cos(dec))
    if abs(cosH)>1: return None
    ft= ((noon-math.acos(cosH)*12/math.pi)%24+24)%24
    return f"{int(ft):02d}:{int((ft-int(ft))*60):02d}"
```

## CSV + JSON
```python
import csv, json

# قراءة CSV
with open("/tmp/data.csv","r",encoding="utf-8") as f:
    for row in csv.DictReader(f):
        print(row)

# كتابة JSON
with open("/tmp/out.json","w",encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
```

## متوازي
```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def process(item):
    return {"item": item, "done": True}

with ThreadPoolExecutor(max_workers=4) as ex:
    futures = {ex.submit(process, i): i for i in items}
    for future in as_completed(futures):
        try: print(future.result())
        except Exception as e: print(f"Error: {e}")
```
