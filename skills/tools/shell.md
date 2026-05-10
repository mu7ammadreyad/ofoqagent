# Shell Tools — دليل bash وcurl
> اقرأ هذا الملف عند تنفيذ أي أوامر bash أو curl

## القواعد الذهبية
```bash
#!/bin/bash
set -eo pipefail  # أول سطر دائماً
[[ -z "$VAR" ]] && { echo "VAR missing" >&2; exit 1; }  # تحقق من المتغيرات
```

## curl مع معالجة أخطاء
```bash
response=$(curl -sf -w "\n%{http_code}" -H "Authorization: token $TOKEN" "https://api.example.com/endpoint")
http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)
[[ "$http_code" != "200" ]] && { echo "HTTP $http_code: $body" >&2; exit 1; }
```

## JSON بدون jq
```bash
VALUE=$(echo "$JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))")
LIST=$(echo "$JSON" | python3 -c "
import sys,json
for item in json.load(sys.stdin):
    print(item['id'], item['name'])
")
```

## python3 inline (heredoc)
```bash
python3 << 'PYEOF'
import json, sys, os
data = {"key": "value"}
print(json.dumps(data, ensure_ascii=False))
PYEOF
```

## عمليات الملفات
```bash
cat > /tmp/file.txt << 'EOF'
محتوى الملف
EOF
ls -lh /tmp/file.txt
wc -l /tmp/file.txt
grep -n "pattern" /tmp/file.txt
```

## متغيرات البيئة
```bash
echo "Token: ${GITHUB_TOKEN:0:6}..."  # لا تطبع كاملاً أبداً
export MY_VAR="value"
```
