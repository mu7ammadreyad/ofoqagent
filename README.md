# أفق — OFOQ BICAMERAL SOVEREIGN v3

عميل ذكاء اصطناعي متكامل: LOGOS × PATHOS يفكران معاً.

## الجديد في v3

- **CYBER AGENT** — اختبار أمني كامل: nmap + nuclei + sqlmap + nikto + OWASP ZAP
- **4-Layer Memory** — core / episodic / tasks / world (لا ينسى شيئاً)
- **Tools Roadmap** — index.md فهرس يُرسَل في كل محادثة، الأدوات تُحمَّل عند الحاجة
- **read_tool action** — يحمّل دليل الأداة المطلوب بـ action
- **add_episode** — سجل تاريخي append-only
- **update_tasks** — مهام معلقة ومكتملة منفصلة

## الهيكل

```
skills/
  system.md          ← هوية BICAMERAL + actions
  memory.md          ← قالب core memory
  tools/
    index.md         ← فهرس خارطة الطريق (يُرسَل دائماً)
    cyber.md         ← أمن سيبراني شامل
    shell.md         ← bash + curl
    python.md        ← Python scripts
    web.md           ← browser + scraping
    github.md        ← GitHub API
    islamic.md       ← Quran + Hadith + prayer times
    scheduling.md    ← schedule_task patterns

src/
  agent.js           ← BICAMERAL loop: LOGOS × PATHOS
  tools.js           ← 4-layer memory + browser + shell
  scheduler.js       ← cron runner
```

## الإعداد

### GitHub Secrets
| الاسم | القيمة |
|-------|--------|
| `GEMINI_API_KEY` | مفتاح Gemini |
| `FIREBASE_SERVICE_ACCOUNT` | JSON كامل |

### index.html
```javascript
const GITHUB_TOKEN = "ghp_...";
const GITHUB_OWNER = "username";
const GITHUB_AGENT_REPO = "ofoqagent";
```

### Firestore Index للمهام المجدولة
Collection Group: `scheduled_tasks`
Fields: `active` (Asc) + `next_run` (Asc)

## Cyber Agent — نموذج استخدام

```
المستخدم: "افحص testphp.vulnweb.com بشكل كامل"

LOGOS:
1. read_tool cyber.md أولاً
2. phase_recon: nmap + whatweb
3. phase_vuln_scan: nuclei + nikto
4. phase_deep_test: sqlmap + ffuf
5. phase_zap_scan: OWASP ZAP
6. generate_report

PATHOS:
تقرير واضح ومنظم مع التوصيات
```
