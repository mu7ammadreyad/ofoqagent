# OFOQ Cyber Agent — دليل الأمن السيبراني الشامل
> اقرأ هذا الملف كاملاً قبل أي اختبار أمني

---

## قواعد الاختبار الأخلاقية

```
✅ اختبر فقط على:
   - أنظمة تملكها أو لديك إذن كتابي
   - بيئات اختبار مخصصة: testphp.vulnweb.com, hackthebox.com, tryhackme.com
   - مواقع bug bounty: hackerone.com/programs, bugcrowd.com

❌ لا تختبر على:
   - أي موقع دون إذن صريح
   - بنية تحتية حيوية
```

---

## SECTION A — التثبيت والإعداد

### A1. تثبيت الأدوات الأساسية (GitHub Actions Ubuntu)
```bash
#!/bin/bash
set -eo pipefail

echo "=== تثبيت أدوات الأمن السيبراني ==="

# nmap
sudo apt-get install -y nmap 2>/dev/null || true

# nikto
sudo apt-get install -y nikto 2>/dev/null || true

# sqlmap
pip install sqlmap --break-system-packages -q 2>/dev/null || \
  sudo apt-get install -y sqlmap 2>/dev/null || true

# nuclei
NUCLEI_VER=$(curl -sf https://api.github.com/repos/projectdiscovery/nuclei/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || echo "v3.2.0")
wget -qO /tmp/nuclei.zip "https://github.com/projectdiscovery/nuclei/releases/download/${NUCLEI_VER}/nuclei_${NUCLEI_VER#v}_linux_amd64.zip"
unzip -qo /tmp/nuclei.zip -d /usr/local/bin/ 2>/dev/null || true
chmod +x /usr/local/bin/nuclei 2>/dev/null || true

# ffuf
sudo apt-get install -y ffuf 2>/dev/null || \
  wget -qO /tmp/ffuf.tar.gz "https://github.com/ffuf/ffuf/releases/latest/download/ffuf_2.1.0_linux_amd64.tar.gz" && \
  tar -xf /tmp/ffuf.tar.gz -C /usr/local/bin/ ffuf 2>/dev/null || true

# whatweb
sudo apt-get install -y whatweb 2>/dev/null || true

# Python security libs
pip install zaproxy requests python-nmap --break-system-packages -q 2>/dev/null || true

echo "=== فحص ما تم تثبيته ==="
for tool in nmap nikto nuclei ffuf whatweb python3; do
    which $tool > /dev/null 2>&1 && echo "✅ $tool" || echo "⚠️  $tool (غير متاح)"
done
```

### A2. تحميل nuclei templates
```bash
# تحميل templates تلقائياً
nuclei -update-templates 2>/dev/null || true
echo "Templates path: $HOME/nuclei-templates"
ls ~/nuclei-templates/ 2>/dev/null | head -10 || echo "Templates not found - will download on first run"
```

---

## SECTION B — حلقة الاختبار المستمرة (Continuous Test Loop)

### B1. الخوارزمية الكاملة
```
PHASE 1: RECON
  nmap → اكتشاف ports + services + OS
  whatweb → fingerprint تقنيات الموقع
  → findings تُغذّي PHASE 2

PHASE 2: VULNERABILITY SCAN
  nuclei -t cves/ -t exposures/ -t vulnerabilities/
  nikto -h target
  → كل نتيجة ≥ medium → تُغذّي PHASE 3

PHASE 3: DEEP EXPLOITATION TEST
  بناءً على نوع الثغرة:
  SQL? → sqlmap --level=5 --risk=3
  XSS? → custom payloads + ZAP active scan
  Auth? → hydra / custom bypass scripts
  LFI/RFI? → ffuf + path traversal payloads
  Headers? → ZAP passive + active scan

PHASE 4: ZAP FULL ANALYSIS
  zap-full-scan أو ZAP Python API
  تعديل requests يدوياً عبر ZAP API

PHASE 5: REPORT
  تجميع كل النتائج
  CVSS scoring
  PoC لكل ثغرة
  توصيات الإصلاح
```

### B2. سكريبت الحلقة الكاملة (Python)
```python
#!/usr/bin/env python3
"""
OFOQ Cyber Loop — حلقة اختبار أمني مستمرة
لا تتوقف حتى: إيجاد ثغرة أو استنفاذ كل الأدوات
"""
import subprocess, json, sys, os, time
from datetime import datetime

TARGET   = sys.argv[1] if len(sys.argv) > 1 else "testphp.vulnweb.com"
MAX_ITER = int(sys.argv[2]) if len(sys.argv) > 2 else 5
OUTDIR   = f"/tmp/ofoq_cyber_{int(time.time())}"
os.makedirs(OUTDIR, exist_ok=True)

findings = []
iteration = 0

def run(cmd, timeout=120):
    """تشغيل أمر مع timeout"""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return "[TIMEOUT]"
    except Exception as e:
        return f"[ERROR] {e}"

def save_finding(phase, tool, severity, description, detail=""):
    findings.append({
        "phase": phase, "tool": tool, "severity": severity,
        "description": description, "detail": detail[:500],
        "timestamp": datetime.now().isoformat()
    })
    print(f"  🔴 [{severity.upper()}] {tool}: {description[:80]}")

def phase_recon():
    print(f"\n{'='*50}\nPHASE 1: RECON — {TARGET}\n{'='*50}")

    # nmap
    print("→ nmap scan...")
    nmap_out = run(f"nmap -sV -sC --open -T4 -p 80,443,8080,8443,3000,8000,9000 {TARGET}", 90)
    with open(f"{OUTDIR}/nmap.txt", "w") as f: f.write(nmap_out)

    # Extract open ports
    ports = []
    for line in nmap_out.splitlines():
        if '/tcp' in line and 'open' in line:
            port = line.split('/')[0].strip()
            service = line.split()[-1] if line.split() else ''
            ports.append(f"{port} ({service})")
            print(f"  ✅ Open port: {port}")

    # whatweb
    print("→ whatweb fingerprint...")
    web_out = run(f"whatweb -a 3 {TARGET} 2>/dev/null || echo 'whatweb not available'", 30)
    with open(f"{OUTDIR}/whatweb.txt", "w") as f: f.write(web_out)

    return {"ports": ports, "nmap": nmap_out[:2000], "whatweb": web_out[:500]}

def phase_vuln_scan(recon_data):
    print(f"\n{'='*50}\nPHASE 2: VULNERABILITY SCAN\n{'='*50}")
    found = []

    # nikto
    print("→ nikto web scan...")
    nikto_out = run(f"nikto -h {TARGET} -nointeractive -maxtime 90s 2>&1", 120)
    with open(f"{OUTDIR}/nikto.txt", "w") as f: f.write(nikto_out)

    for line in nikto_out.splitlines():
        if '+ ' in line and any(k in line.lower() for k in ['vuln','inject','xss','sql','osvdb','cve','disclose','expose']):
            save_finding("vuln_scan", "nikto", "medium", line.strip())
            found.append({"type": "nikto", "detail": line.strip()})

    # nuclei
    print("→ nuclei templates scan...")
    nuclei_out = run(
        f"nuclei -u https://{TARGET} -t exposures/ -t vulnerabilities/ -t cves/ "
        f"-severity medium,high,critical -silent -json-export {OUTDIR}/nuclei.json 2>&1",
        timeout=180
    )
    with open(f"{OUTDIR}/nuclei.txt", "w") as f: f.write(nuclei_out)

    # Parse nuclei JSON results
    if os.path.exists(f"{OUTDIR}/nuclei.json"):
        try:
            with open(f"{OUTDIR}/nuclei.json") as f:
                for line in f:
                    if line.strip():
                        r = json.loads(line)
                        sev = r.get('info',{}).get('severity','info')
                        name = r.get('info',{}).get('name','unknown')
                        url  = r.get('matched-at','')
                        save_finding("vuln_scan", "nuclei", sev, name, url)
                        found.append({"type": "nuclei", "severity": sev, "name": name, "url": url})
        except Exception as e:
            print(f"  ⚠️  nuclei JSON parse error: {e}")

    return found

def phase_deep_test(vuln_findings):
    print(f"\n{'='*50}\nPHASE 3: DEEP TEST\n{'='*50}")

    # SQL Injection test
    test_url = f"http://{TARGET}/artists.php?artist=1"
    print(f"→ sqlmap SQL injection test on {test_url}...")
    sql_out = run(
        f"sqlmap -u '{test_url}' --batch --level=3 --risk=2 "
        f"--output-dir={OUTDIR}/sqlmap --forms 2>&1 | tail -30",
        timeout=120
    )
    with open(f"{OUTDIR}/sqlmap.txt", "w") as f: f.write(sql_out)

    if any(k in sql_out.lower() for k in ['injectable', 'injection', 'parameter', 'payload']):
        save_finding("deep_test", "sqlmap", "critical", "SQL Injection found!", sql_out[-500:])

    # Directory fuzzing
    print("→ ffuf directory fuzzing...")
    fuzz_out = run(
        f"ffuf -u http://{TARGET}/FUZZ "
        f"-w /usr/share/wordlists/dirb/common.txt "
        f"-mc 200,201,301,302,403 -t 20 -o {OUTDIR}/ffuf.json -of json 2>&1 | tail -20",
        timeout=60
    )
    if os.path.exists(f"{OUTDIR}/ffuf.json"):
        try:
            with open(f"{OUTDIR}/ffuf.json") as f:
                data = json.load(f)
                for r in data.get('results', [])[:5]:
                    print(f"  📁 Found: {r.get('url','')} [{r.get('status','')}]")
        except Exception:
            pass

def phase_zap_scan():
    print(f"\n{'='*50}\nPHASE 4: OWASP ZAP FULL SCAN\n{'='*50}")

    # تحقق من وجود ZAP
    zap_check = run("which zap.sh || find /opt /usr/share -name 'zap.sh' 2>/dev/null | head -1", 10)
    if not zap_check.strip():
        print("⚠️  ZAP not found — installing via Docker...")
        docker_out = run(
            f"docker run --rm -t softwaresecurityproject/zap-stable "
            f"zap-baseline.py -t http://{TARGET} 2>&1 | tail -50",
            timeout=300
        )
        with open(f"{OUTDIR}/zap_baseline.txt", "w") as f: f.write(docker_out)

        for line in docker_out.splitlines():
            if any(k in line for k in ['WARN', 'FAIL', 'RISK']):
                sev = 'high' if 'FAIL' in line else 'medium'
                save_finding("zap_scan", "zap", sev, line.strip())
        return docker_out

    # ZAP Python API (إذا كان مثبتاً)
    zap_script = f"""
import time, subprocess, sys

ZAP_PATH = '{zap_check.strip()}'
TARGET   = 'http://{TARGET}'
API_KEY  = 'ofoq_zap_2025'

# تشغيل ZAP daemon
proc = subprocess.Popen([ZAP_PATH, '-daemon', '-port', '8090',
    '-config', f'api.key={{API_KEY}}', '-config', 'api.disablekey=false'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(20)

try:
    from zapv2 import ZAPv2
    zap = ZAPv2(apikey=API_KEY, proxies={{'http':'http://127.0.0.1:8090','https':'http://127.0.0.1:8090'}})

    print("→ Spider scan...")
    scan_id = zap.spider.scan(TARGET, apikey=API_KEY)
    while int(zap.spider.status(scan_id)) < 100:
        time.sleep(2)

    print("→ Active scan...")
    ascan_id = zap.ascan.scan(TARGET, apikey=API_KEY)
    while int(zap.ascan.status(ascan_id)) < 100:
        time.sleep(3)

    # جلب النتائج
    alerts = zap.core.alerts(baseurl=TARGET)
    import json
    with open('{OUTDIR}/zap_alerts.json','w') as f:
        json.dump(alerts, f, indent=2)

    for a in alerts:
        risk = a.get('risk','')
        name = a.get('name','')
        url  = a.get('url','')
        print(f"  [{risk}] {{name}} — {{url[:60]}}")

except Exception as e:
    print(f"ZAP API error: {{e}}")
finally:
    proc.terminate()
"""
    return run(f"python3 << 'PYEOF'\n{zap_script}\nPYEOF", timeout=600)

def generate_report():
    print(f"\n{'='*50}\nFINAL SECURITY REPORT\n{'='*50}")

    critical = [f for f in findings if f['severity'] in ['critical','high']]
    medium   = [f for f in findings if f['severity'] == 'medium']
    low      = [f for f in findings if f['severity'] in ['low','info']]

    report = {
        "target": TARGET,
        "scan_date": datetime.now().isoformat(),
        "summary": {
            "critical_high": len(critical),
            "medium": len(medium),
            "low_info": len(low),
            "total": len(findings)
        },
        "findings": findings,
        "output_dir": OUTDIR
    }

    with open(f"{OUTDIR}/final_report.json", "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n📊 ملخص النتائج:")
    print(f"  🔴 Critical/High: {len(critical)}")
    print(f"  🟡 Medium:        {len(medium)}")
    print(f"  🟢 Low/Info:      {len(low)}")
    print(f"\n  📁 التقارير في: {OUTDIR}/")
    print(f"  📄 التقرير الكامل: {OUTDIR}/final_report.json")

    return report

# ── MAIN LOOP ──────────────────────────────────────────────────
print(f"\n🎯 هدف الاختبار: {TARGET}")
print(f"🔄 الحد الأقصى للتكرار: {MAX_ITER}")
print(f"📁 مجلد النتائج: {OUTDIR}")

# تشغيل المراحل بالترتيب
recon_data   = phase_recon()
vuln_data    = phase_vuln_scan(recon_data)
             ; phase_deep_test(vuln_data)
             ; phase_zap_scan()

# تقرير نهائي
report = generate_report()

# إخراج JSON للـ agent
print("\n===FINAL_JSON===")
print(json.dumps(report, ensure_ascii=False))
```

---

## SECTION C — OWASP ZAP: تعديل Requests كالمحترفين

### C1. تشغيل ZAP كـ Proxy (مثل Burp Suite)
```python
#!/usr/bin/env python3
"""
OFOQ ZAP Interceptor — اعتراض وتعديل HTTP requests
يعمل بنفس مبدأ Burp Suite Repeater/Interceptor
"""
import subprocess, time, json, base64, sys
from zapv2 import ZAPv2

TARGET  = sys.argv[1] if len(sys.argv) > 1 else "http://testphp.vulnweb.com"
ZAP_PORT = 8090
API_KEY  = "ofoq_zap_key"

# تشغيل ZAP
print("→ Starting ZAP daemon...")
zap_proc = subprocess.Popen(
    ["zap.sh", "-daemon", f"-port={ZAP_PORT}",
     f"-config=api.key={API_KEY}",
     "-config=api.disablekey=false",
     "-config=connection.timeoutInSecs=120"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
)
time.sleep(20)

zap = ZAPv2(apikey=API_KEY, proxies={
    'http':  f'http://127.0.0.1:{ZAP_PORT}',
    'https': f'http://127.0.0.1:{ZAP_PORT}',
})

print(f"✅ ZAP version: {zap.core.version}")

# ── Spider ──────────────────────────────────────────────────────
print("→ Spider crawling...")
spider_id = zap.spider.scan(TARGET, apikey=API_KEY, maxchildren=10)
while int(zap.spider.status(spider_id)) < 100:
    pct = zap.spider.status(spider_id)
    print(f"  Spider: {pct}%", end='\r')
    time.sleep(2)
print(f"\n✅ Spider done — {len(zap.spider.results(spider_id))} URLs found")

# ── Active Scan (كـ Burp Active Scanner) ───────────────────────
print("→ Active scan (like Burp Pro)...")
scan_id = zap.ascan.scan(TARGET, apikey=API_KEY, recurse=True, inscopeonly=False)
while int(zap.ascan.status(scan_id)) < 100:
    pct = zap.ascan.status(scan_id)
    print(f"  Active scan: {pct}%", end='\r')
    time.sleep(3)
print("\n✅ Active scan done")

# ── تعديل Request يدوياً (مثل Burp Repeater) ───────────────────
def send_custom_request(method, url, headers, body=""):
    """
    إرسال request مخصص عبر ZAP — مثل Burp Repeater
    """
    # Fuzz request عبر ZAP Fuzzer API
    msg_id = None

    # أولاً: أوجد الـ message ID للـ URL
    messages = zap.core.messages(baseurl=url)
    if messages:
        msg_id = messages[0]['id']

    if msg_id:
        # تعديل الـ request
        current = zap.core.message(msg_id)
        print(f"→ Original request:\n{current['requestHeader'][:200]}")

        # إرسال request معدّل
        zap.core.send_request(
            request=f"{method} {url} HTTP/1.1\r\n{headers}\r\n\r\n{body}",
            followredirects=False,
            apikey=API_KEY
        )

# ── ZAP Fuzzer (مثل Burp Intruder) ────────────────────────────
def fuzz_parameter(url, param, payloads):
    """
    Fuzz parameter بقائمة payloads — مثل Burp Intruder
    """
    # استخدام ZAP Fuzzer API
    scan_id = zap.spider.scan(url, apikey=API_KEY, maxchildren=1)
    time.sleep(3)

    messages = zap.core.messages(baseurl=url)
    if not messages:
        print(f"⚠️  لا توجد messages لـ {url}")
        return []

    msg_id = messages[0]['id']
    results = []

    for payload in payloads:
        modified_url = url.replace(f"{param}=", f"{param}={payload}")
        import requests as req
        resp = req.get(modified_url, proxies={
            'http':  f'http://127.0.0.1:{ZAP_PORT}',
            'https': f'http://127.0.0.1:{ZAP_PORT}',
        }, verify=False, timeout=10)

        result = {
            "payload": payload,
            "status": resp.status_code,
            "length": len(resp.text),
            "interesting": resp.status_code in [200,500] and len(resp.text) > 100
        }
        results.append(result)
        if result['interesting']:
            print(f"  🎯 Interesting: {payload[:30]} → {resp.status_code} ({len(resp.text)} bytes)")

    return results

# ── SQL Injection Payloads ──────────────────────────────────────
SQL_PAYLOADS = [
    "1'", "1''", "1' OR '1'='1", "1' OR 1=1--",
    "1' UNION SELECT NULL--", "1; DROP TABLE users--",
    "1' AND SLEEP(5)--", "1' WAITFOR DELAY '0:0:5'--",
    "1' AND EXTRACTVALUE(1,CONCAT(0x7e,version()))--",
]

# ── XSS Payloads ────────────────────────────────────────────────
XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "'\"><script>alert(document.cookie)</script>",
    "<svg onload=alert(1)>",
    "javascript:alert(1)",
    "${7*7}", "{{7*7}}",  # Template injection
]

# ── نتائج ZAP ──────────────────────────────────────────────────
print("\n→ Collecting ZAP alerts...")
alerts = zap.core.alerts(baseurl=TARGET)
findings = []
for a in sorted(alerts, key=lambda x: {'High':0,'Medium':1,'Low':2,'Informational':3}.get(a.get('risk',''),4)):
    findings.append({
        "risk":     a.get('risk',''),
        "name":     a.get('name',''),
        "url":      a.get('url',''),
        "method":   a.get('method',''),
        "param":    a.get('param',''),
        "attack":   a.get('attack',''),
        "evidence": a.get('evidence','')[:200],
        "solution": a.get('solution','')[:300],
        "reference":a.get('reference','')[:200],
    })
    print(f"  [{a.get('risk','?'):10}] {a.get('name','')[:60]}")

# حفظ التقرير
with open('/tmp/zap_report.json','w') as f:
    json.dump({"target": TARGET, "alerts": findings}, f, indent=2, ensure_ascii=False)
print(f"\n✅ تقرير ZAP: /tmp/zap_report.json ({len(findings)} ثغرة)")

zap_proc.terminate()
print(json.dumps({"total": len(findings), "findings": findings[:10]}, ensure_ascii=False))
```

---

## SECTION D — أدوات منفردة

### D1. nmap — المسح الشامل
```bash
# Basic service detection
nmap -sV -sC -T4 TARGET -oN /tmp/nmap_basic.txt

# Full port scan
nmap -p- -sV -T4 TARGET -oN /tmp/nmap_full.txt

# OS detection + vuln scripts
nmap -sV -sC -O --script vuln TARGET -oN /tmp/nmap_vuln.txt

# استخراج النتائج
python3 << 'PYEOF'
import re
with open('/tmp/nmap_basic.txt') as f:
    for line in f:
        if '/tcp' in line and 'open' in line:
            print(line.strip())
PYEOF
```

### D2. nuclei — المسح بالقوالب
```bash
# تثبيت وتحديث templates
nuclei -update-templates

# مسح بـ CVEs + vulnerabilities
nuclei -u https://TARGET \
  -t ~/nuclei-templates/cves/ \
  -t ~/nuclei-templates/vulnerabilities/ \
  -t ~/nuclei-templates/exposures/ \
  -severity medium,high,critical \
  -rate-limit 10 \
  -json-export /tmp/nuclei_results.json

# parse النتائج
python3 << 'PYEOF'
import json
results = []
with open('/tmp/nuclei_results.json') as f:
    for line in f:
        if line.strip():
            r = json.loads(line)
            sev  = r.get('info',{}).get('severity','')
            name = r.get('info',{}).get('name','')
            url  = r.get('matched-at','')
            if sev in ['critical','high','medium']:
                print(f"[{sev.upper():8}] {name} → {url}")
                results.append(r)
print(f"\nTotal findings: {len(results)}")
PYEOF
```

### D3. sqlmap — SQL Injection
```bash
# اختبار أساسي
sqlmap -u "http://TARGET/page.php?id=1" \
  --batch --level=3 --risk=2 \
  --dbs \
  --output-dir=/tmp/sqlmap/

# مع forms
sqlmap -u "http://TARGET/login.php" \
  --forms --batch \
  --level=5 --risk=3 \
  --technique=BEUSTQ

# تحليل النتائج
cat /tmp/sqlmap/TARGET/log
```

### D4. nikto — Web Server Scanner
```bash
nikto -h http://TARGET \
  -nointeractive \
  -maxtime 120s \
  -output /tmp/nikto_report.txt \
  -Format txt

# Extract key findings
grep -E "^\+ " /tmp/nikto_report.txt | grep -v "^+ Server" | head -20
```

### D5. ffuf — Directory & Parameter Fuzzing
```bash
# Directory fuzzing
ffuf -u http://TARGET/FUZZ \
  -w /usr/share/wordlists/dirb/common.txt \
  -mc 200,301,302,403 \
  -t 20 \
  -o /tmp/ffuf_dirs.json -of json

# Parameter fuzzing
ffuf -u "http://TARGET/page.php?FUZZ=test" \
  -w /usr/share/seclists/Discovery/Web-Content/burp-parameter-names.txt \
  -mc 200 -t 10

# Subdomain fuzzing
ffuf -u http://FUZZ.TARGET.com \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt \
  -mc 200,301

# JSON parse
python3 << 'PYEOF'
import json
with open('/tmp/ffuf_dirs.json') as f:
    data = json.load(f)
for r in data.get('results', []):
    print(f"[{r['status']}] {r['url']}")
PYEOF
```

### D6. Custom OWASP Top 10 Checker (Python)
```python
#!/usr/bin/env python3
"""
فاحص OWASP Top 10 مخصص
"""
import requests, re, json, sys
requests.packages.urllib3.disable_warnings()

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://testphp.vulnweb.com"
SESS   = requests.Session()
SESS.verify = False
SESS.timeout = 15
SESS.headers.update({"User-Agent": "Mozilla/5.0 (OFOQ Security Scanner)"})

vulns = []

def check_xss(url):
    """A03 — Cross-Site Scripting"""
    payloads = ["<script>alert(1)</script>", "'\"<img src=x>", "{{7*7}}"]
    for p in payloads:
        try:
            r = SESS.get(url, params={"search": p, "q": p, "id": p})
            if p in r.text or "49" in r.text:  # {{7*7}}=49 → template injection
                vulns.append({"type": "XSS/SSTI", "payload": p, "url": url, "status": r.status_code})
                print(f"  🔴 XSS/SSTI: {p[:30]} → {url}")
                return True
        except Exception:
            pass
    return False

def check_sqli(url):
    """A03 — SQL Injection"""
    tests = [
        ("'", "sql syntax"),
        ("1' OR '1'='1", "login"),
        ("1; SELECT SLEEP(1)--", "sleep"),
    ]
    for payload, indicator in tests:
        try:
            r = SESS.get(url, params={"id": payload, "cat": payload})
            text_lower = r.text.lower()
            sql_errors = ['sql', 'mysql', 'ora-', 'syntax error', 'sqlite']
            if any(e in text_lower for e in sql_errors):
                vulns.append({"type": "SQLi", "payload": payload, "url": url})
                print(f"  🔴 SQL Injection detected: {payload}")
                return True
        except Exception:
            pass
    return False

def check_security_headers(url):
    """A05 — Security Misconfiguration"""
    try:
        r = SESS.get(url)
        missing = []
        critical = {
            "strict-transport-security": "HSTS missing",
            "x-content-type-options":    "X-Content-Type-Options missing",
            "x-frame-options":           "Clickjacking protection missing",
            "content-security-policy":   "CSP missing",
        }
        for header, desc in critical.items():
            if header not in {k.lower() for k in r.headers}:
                missing.append(desc)
                vulns.append({"type": "missing_header", "header": header, "url": url, "severity": "medium"})

        if missing:
            print(f"  🟡 Missing security headers: {', '.join(missing[:3])}")
        return len(missing)
    except Exception:
        return 0

def check_sensitive_files(base_url):
    """A05 — Exposed Sensitive Files"""
    paths = [
        "/.env", "/.git/HEAD", "/config.php", "/wp-config.php",
        "/admin/", "/phpmyadmin/", "/.htaccess", "/backup.zip",
        "/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
        "/server-status", "/phpinfo.php",
    ]
    found = []
    for path in paths:
        try:
            r = SESS.get(f"{base_url.rstrip('/')}{path}", timeout=5)
            if r.status_code in [200, 403]:
                info = {"type": "sensitive_path", "path": path, "status": r.status_code, "url": f"{base_url}{path}"}
                if r.status_code == 200:
                    info["severity"] = "high"
                    print(f"  🔴 Accessible: {path} [{r.status_code}]")
                    vulns.append(info)
                    found.append(path)
        except Exception:
            pass
    return found

def check_idor(base_url):
    """A01 — Broken Access Control / IDOR"""
    test_urls = [
        f"{base_url}/userinfo.php?id=1",
        f"{base_url}/userinfo.php?id=2",
        f"{base_url}/userinfo.php?id=../admin",
    ]
    responses = []
    for url in test_urls:
        try:
            r = SESS.get(url)
            responses.append({"url": url, "status": r.status_code, "length": len(r.text)})
        except Exception:
            pass

    if len(responses) >= 2:
        lengths = [r['length'] for r in responses]
        if len(set(lengths)) > 1:
            print(f"  🟡 Potential IDOR: different responses for sequential IDs")
            vulns.append({"type": "IDOR", "severity": "medium", "urls": [r['url'] for r in responses]})

# ── Run All Checks ──────────────────────────────────────────────
print(f"\n🔍 OWASP Top 10 Check: {TARGET}\n")
print("A01 — Broken Access Control...")
check_idor(TARGET)

print("A03 — Injection...")
check_sqli(f"{TARGET}/artists.php?artist=1")
check_xss(f"{TARGET}/search.php?test=")

print("A05 — Security Misconfiguration...")
check_security_headers(TARGET)
check_sensitive_files(TARGET)

# Report
print(f"\n{'='*40}")
print(f"Total findings: {len(vulns)}")
for v in vulns:
    sev = v.get('severity', 'high' if v.get('type') in ['XSS/SSTI','SQLi'] else 'medium')
    print(f"  [{sev.upper():8}] {v.get('type','?')}: {v.get('url','')[:60]}")

print(json.dumps({"target": TARGET, "findings": vulns}, ensure_ascii=False))
```

---

## SECTION E — قراءة نتائج الاختبارات

### E1. كيف تقرأ نتيجة الحلقة
```python
# نتيجة phase_zap_scan أو phase_vuln_scan تُعيد JSON
# الـ agent يقرأ النتيجة ويقرر:

result = json.loads(output_from_shell)
findings = result.get('findings', [])

critical_highs = [f for f in findings if f['severity'] in ['critical','high']]
if critical_highs:
    # وجدنا ثغرات → إعداد تقرير + PoC
    pass
else:
    # لم نجد → توسيع النطاق أو تجربة payloads مختلفة
    pass
```

### E2. CVSS Scoring
```python
def cvss_score(vuln_type, exploitability, impact):
    """تقدير CVSS Score مبسط"""
    scores = {
        "SQLi":     {"base": 9.8, "vector": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"},
        "XSS":      {"base": 6.1, "vector": "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"},
        "IDOR":     {"base": 7.5, "vector": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"},
        "RCE":      {"base": 10.0,"vector": "AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"},
        "SSRF":     {"base": 8.6, "vector": "AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N"},
        "missing_header": {"base": 5.3, "vector": "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N"},
    }
    return scores.get(vuln_type, {"base": 5.0, "vector": "unknown"})
```

---

## SECTION F — تقرير الاختبار النهائي

### F1. قالب التقرير
```markdown
# تقرير اختبار أمني — {target}
**تاريخ الاختبار:** {date}
**المختبر:** OFOQ BICAMERAL SOVEREIGN v3

## ملخص تنفيذي
| المستوى | العدد |
|---------|-------|
| 🔴 Critical | {n} |
| 🟠 High | {n} |
| 🟡 Medium | {n} |
| 🟢 Low | {n} |

## الثغرات بالتفصيل

### [Critical] {اسم الثغرة}
- **النوع:** SQL Injection / XSS / ...
- **CVSS Score:** 9.8
- **Vector:** AV:N/AC:L/PR:N/UI:N
- **URL:** https://target/path
- **الدليل:** {request/response}
- **PoC:**
  ```
  {payload or curl command}
  ```
- **التأثير:** ...
- **الحل:** ...
- **المرجع:** CVE-XXXX-YYYY / OWASP A03
```

---
*OFOQ Cyber Agent — القوة مع المسؤولية*
