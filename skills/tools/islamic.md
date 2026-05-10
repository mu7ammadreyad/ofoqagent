# Islamic Tools — Quran · Hadith · Prayer Times

## Quran API
```bash
# آية مع تفسير
curl -sf "https://api.alquran.cloud/v1/ayah/1:1/editions/quran-simple,ar.jalalayn" | python3 -c "
import sys,json
data=json.load(sys.stdin)['data']
print('النص:   ', data[0]['text'])
print('التفسير:', data[1]['text'][:300])
"

# سورة كاملة
curl -sf "https://api.alquran.cloud/v1/surah/36" | python3 -c "
import sys,json
for a in json.load(sys.stdin)['data']['ayahs']:
    print(f\"{a['numberInSurah']}. {a['text']}\")
"

# آية عشوائية
SURAH=$((RANDOM % 114 + 1))
AYAH=$((RANDOM % 6 + 1))
curl -sf "https://api.alquran.cloud/v1/ayah/$SURAH:$AYAH/ar.jalalayn" | python3 -c "
import sys,json; d=json.load(sys.stdin)['data']
print(d['text'])
"
```

## Hadith API
```bash
# حديث عشوائي
curl -sf "https://api.hadith.gading.dev/books/bukhari?range=1-100" | python3 -c "
import sys,json,random
d=json.load(sys.stdin)['data']['hadiths']
h=random.choice(d)
print(h.get('arab','') or h.get('id',''))
" 2>/dev/null || echo "جرب API بديل"
```

## مواقيت الصلاة
```python
import math
from datetime import datetime

def prayer_times(lat=30.0444, lng=31.2357, method=5):
    """حساب مواقيت الصلاة — method=5 مصر"""
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

    def time_for_angle(angle):
        cosH=(math.sin(angle*D2R)-math.sin(lat*D2R)*math.sin(dec))/(math.cos(lat*D2R)*math.cos(dec))
        if abs(cosH)>1: return None
        h=math.acos(cosH)*12/math.pi
        return h

    def fmt(t):
        if t is None: return "--:--"
        t=t%24; return f"{int(t):02d}:{int((t-int(t))*60):02d}"

    fajr_h  = time_for_angle(-19.5)
    dhuhr   = noon
    asr_h   = math.atan(1+math.tan(abs(lat-dec)*D2R))*12/(math.pi)
    maghrib_h=time_for_angle(-0.833)
    isha_h  = time_for_angle(-17.5)

    return {
        "الفجر":   fmt(noon-fajr_h)   if fajr_h   else "--:--",
        "الشروق":  fmt(noon-time_for_angle(-0.833)) if time_for_angle(-0.833) else "--:--",
        "الظهر":   fmt(noon),
        "العصر":   fmt(noon+asr_h),
        "المغرب":  fmt(noon+maghrib_h) if maghrib_h else "--:--",
        "العشاء":  fmt(noon+isha_h)   if isha_h   else "--:--",
    }

times = prayer_times()
for name, t in times.items():
    print(f"{name}: {t}")
```
