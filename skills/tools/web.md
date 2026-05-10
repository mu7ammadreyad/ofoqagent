# Web Tools — Camoufox + Deep Research

## browser action
```xml
<action type="browser">
{"url":"https://example.com","task":"استخرج المحتوى","engine":"camoufox"}
</action>
```
engine: `"camoufox"` (افتراضي) | `"requests"` (fallback)

## نتيجة browser
```json
{
  "success": true,
  "article_text": "...",   ← استخدم أولاً إذا > 300 حرف
  "text": "...",           ← fallback
  "headings": [],
  "links": [],
  "engine_used": "camoufox",
  "textLength": 5432
}
```

## عند فشل browser → requests مباشر
```xml
<action type="browser">
{"url":"https://example.com","engine":"requests"}
</action>
```

## أو curl fallback
```bash
python3 << 'PYEOF'
import urllib.request, re, json
headers = {"User-Agent": "Mozilla/5.0 (OFOQ/3.0)"}
req = urllib.request.Request("https://example.com", headers=headers)
with urllib.request.urlopen(req, timeout=15) as r:
    html = r.read().decode('utf-8', errors='ignore')
text = re.sub(r'<[^>]+>',' ', html)
text = re.sub(r'\s+',' ', text).strip()[:5000]
print(json.dumps({"text": text, "length": len(text)}, ensure_ascii=False))
PYEOF
```

## Deep Research Pattern
```
1. Google/DuckDuckGo → browser → extract links
2. للـ top 3-5 links → browser لكل منها
3. استخرج article_text من كل مصدر
4. Jina AI Reader (لمحتوى نظيف):
   curl -s "https://r.jina.ai/https://example.com"
5. اجمع + لخّص + cite المصادر
```

## Jina Reader (أسرع من browser لبعض المواقع)
```bash
# يعطي محتوى نظيف مباشرة
curl -sf "https://r.jina.ai/https://techcrunch.com/article-url" | head -200

# مع headers للمواقع المقيدة
curl -sf -H "X-Return-Format: text" "https://r.jina.ai/https://example.com"
```
