# GitHub API — دليل كامل

## تحقق من Token
```bash
LOGIN=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" -H "User-Agent: OFOQ/3.0" \
  "https://api.github.com/user" | python3 -c "import sys,json; print(json.load(sys.stdin)['login'])")
echo "GitHub: $LOGIN"
```

## Releases
```bash
# جلب
curl -sf -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" | python3 -c "
import sys,json
for r in json.load(sys.stdin): print(r['tag_name'], r['id'])
"

# إنشاء
RELEASE_ID=$(curl -sf -X POST -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$OWNER/$REPO/releases" \
  -d '{"tag_name":"v1.0","name":"Release v1.0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
```

## Repository Dispatch
```bash
curl -sf -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$OWNER/$REPO/dispatches" \
  -d '{"event_type":"agent-chat","client_payload":{"uid":"x","conv_id":"y"}}'
```

## قراءة ملف من repo
```bash
curl -sf -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/contents/path/file.txt" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
print(base64.b64decode(d['content']).decode()[:500])
"
```
