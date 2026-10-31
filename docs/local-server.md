# الخادم المحلي لسيرفا

هذا الدليل لصاحب المحل أو للفني الذي يجهّز الخادم. الخادم المحلي هو كمبيوتر واحد في المكتب يشغّل سيرفا كاملاً، وكل الأجهزة على نفس شبكة الواي فاي (الكاشير، الجوال، التابلت) تفتحه من المتصفح. هذا قرار المالك في تبويب الخطة: نبني ونجرّب كل شيء محلياً قبل الاستضافة. عليه بيانات تجريبية فقط.

## ما تحتاجه

- كمبيوتر يبقى شغّالاً أثناء العمل: ويندوز 10 أو 11، أو لينكس (Ubuntu مثلاً). ذاكرة 8 غيغا على الأقل، و20 غيغا فارغة على القرص.
- اتصال بالإنترنت في أول تثبيت فقط (لتنزيل البرامج). بعدها يعمل الخادم على الشبكة المحلية دون إنترنت.
- يُفضّل أن يتصل الكمبيوتر بالراوتر بكابل.

## التثبيت أول مرة

### على ويندوز

1. افتح PowerShell كمسؤول (زر يمين على قائمة ابدأ ← Terminal (Admin)) واكتب:

   ```powershell
   wsl --install -d Ubuntu
   ```

   أعد تشغيل الكمبيوتر، ثم افتح Ubuntu من قائمة ابدأ واختر اسم مستخدم وكلمة سر.

2. نزّل Docker Desktop من موقع Docker الرسمي وثبّته. من إعداداته:
   - General ← فعّل «Use the WSL 2 based engine» و«Start Docker Desktop when you sign in».
   - Resources ← WSL integration ← فعّل Ubuntu.

3. في نافذة Ubuntu اكتب:

   ```bash
   sudo apt-get update && sudo apt-get install -y git curl
   cd ~
   git clone <رابط المستودع> serva-pos
   cd serva-pos
   ```

   مهم: ضع المشروع داخل Ubuntu (المجلد `~`) وليس في `C:` (أي ليس تحت `/mnt/c`).

4. اسمح للأجهزة الأخرى بالوصول: في PowerShell كمسؤول:

   ```powershell
   New-NetFirewallRule -DisplayName "Serva local server" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Profile Private
   ```

   وتأكد أن شبكة الواي فاي في ويندوز من نوع «خاصة» (Private): الإعدادات ← الشبكة والإنترنت ← Wi-Fi ← اسم الشبكة ← نوع ملف تعريف الشبكة ← خاصة.

### على لينكس (Ubuntu)

1. ثبّت Docker Engine حسب الدليل الرسمي في موقع Docker، ثم:

   ```bash
   sudo usermod -aG docker "$USER"   # ثم سجّل خروج ودخول
   sudo systemctl enable --now docker
   sudo apt-get install -y git curl
   git clone <رابط المستودع> ~/serva-pos && cd ~/serva-pos
   ```

## الأوامر

كل الأوامر تُكتب في نافذة Ubuntu (أو طرفية لينكس) داخل مجلد المشروع `~/serva-pos`.

إن كان Node.js وpnpm مثبتين استعمل العمود الأول. وإن لم يكونا مثبتين فالعمود الثاني يعمل بنفس الطريقة.

| ماذا تريد                                 | الأمر                       | أو دون pnpm                            |
| ----------------------------------------- | --------------------------- | -------------------------------------- |
| أول تشغيل، أو نشر نسخة جديدة من الكود     | `pnpm local:deploy`         | `bash scripts/local/deploy.sh`         |
| تشغيل الخادم                              | `pnpm local:up`             | `bash scripts/local/up.sh`             |
| إيقاف الخادم (البيانات تبقى)              | `pnpm local:down`           | `bash scripts/local/down.sh`           |
| نسخة احتياطية الآن                        | `pnpm local:backup`         | `bash scripts/local/backup.sh`         |
| تمرين استعادة لآخر نسخة (لا يمس البيانات) | `pnpm local:restore latest` | `bash scripts/local/restore.sh latest` |
| فحص أن كل شيء يعمل                        | `pnpm local:smoke`          | `bash scripts/local/smoke.sh`          |
| عرض السجلات عند مشكلة                     | `pnpm local:logs`           | `bash scripts/local/logs.sh`           |

لتحديث الكود ثم نشره: `git pull` ثم `pnpm local:deploy`. أمر النشر يأخذ نسخة احتياطية أولاً، ثم يبني ويحدّث قاعدة البيانات ويعيد التشغيل، ثم يفحص الخادم. وإن فشل أي فحص يكتب **DEPLOY FAILED** أو **SMOKE TEST FAILED** بالأحمر.

### أصناف تجريبية لسوبرماركت

لتجربة الكاشير دون إدخال الأصناف يدوياً: افتح حساب المتجر أولاً، ثم شغّل:

```bash
bash scripts/local/demo-catalog.sh
```

يضيف نحو 40 صنفاً من سوبرماركت في الرقة، بباركوداتها وأسعارها بالليرة وبعضها بالدولار (سعر الصرف 130)، مع كميات في الفرع الرئيسي، والخضار بالكيلو. تشغيله مرة ثانية لا يكرر شيئاً. وإن كان على الخادم أكثر من متجر فاكتب رمز المتجر (6 أرقام) بعد الأمر: `bash scripts/local/demo-catalog.sh 123456`.

### أول تشغيل: احفظ هاتين القيمتين

عند أول `pnpm local:deploy` يُنشأ ملف الأسرار `deploy/local/.env` بقيم عشوائية قوية، وتظهر على الشاشة مرة واحدة:

- **كلمة سر النسخ الاحتياطي:** دونها لا يمكن فتح أي نسخة احتياطية أبداً. اكتبها على ورقة في مكان آمن، أو في مدير كلمات سر، خارج هذا الكمبيوتر.
- **حساب مدير المنصة:** البريد `admin@serva.local` وكلمة سره.

لا ترسل ملف `.env` لأحد ولا ترفعه إلى أي مكان، ولا تحذفه، فكلمات سر قاعدة البيانات فيه.

### وضع التجربة: رمز التسجيل على الشاشة

الخادم المحلي لا يرسل رسائل SMS، لذلك يعمل افتراضياً في **وضع التجربة**: عند فتح حساب جديد يظهر رمز التحقق في مربع أصفر على الشاشة نفسها («وضع التجربة — الرمز: 123 456») مع زر يكتبه عنك. وفي أعلى كل صفحة شريط ثابت «نسخة تجربة على الخادم المحلي» كي لا يظنها أحد النسخة الحقيقية.

في هذا الوضع لا يُثبَت أن رقم الجوال لصاحبه، فهو للتجربة فقط. لإيقافه:

1. افتح `deploy/local/.env` وغيّر السطر (أو أضفه) إلى `SERVA_OTP_DELIVERY=none`.
2. شغّل `pnpm local:up`.

بعدها يتوقف فتح حسابات جديدة على هذا الخادم إلى أن تُربط رسائل SMS، ويختفي الشريط. للعودة: `SERVA_OTP_DELIVERY=screen` ثم `pnpm local:up`. هذا الوضع مرفوض تماماً على الخادم السحابي: لا يعمل إلا مع `DEPLOYMENT=local`.

## عنوان الخادم على الشبكة

في نهاية `pnpm local:up` و`pnpm local:deploy` يظهر العنوان، مثل:

```
On devices on the same Wi-Fi:
    https://192.168.1.20
```

هذا ما تكتبه في متصفح أي جهاز على نفس الواي فاي. لمعرفته يدوياً:

- **ويندوز:** في PowerShell اكتب `ipconfig` وانظر إلى «IPv4 Address» تحت Wi-Fi أو Ethernet.
- **لينكس:** `hostname -I` (الرقم الأول عادةً).

**ثبّت العنوان:** من إعدادات الراوتر احجز عنواناً ثابتاً لهذا الكمبيوتر (DHCP reservation أو Address reservation)، كي لا يتغير كل يوم. وإن تغيّر فشغّل `pnpm local:up` مرة واحدة، فتُحدَّث الشهادة للعنوان الجديد.

### على كل جهاز، مرة واحدة: ثبّت شهادة الخادم

الخادم يعمل بـ https، لأن المتصفح لا يسمح بالعمل دون إنترنت ولا بالطابعة والكاميرا إلا عليه. وشهادته صادرة من «جهة شهادات» صغيرة خاصة بهذا الخادم، فيجب أن يثق بها كل جهاز مرة واحدة:

1. على الجهاز افتح: `http://192.168.1.20/serva-local-ca.crt` (ضع عنوان خادمك)، فيُنزَّل الملف.
2. ثبّته:
   - **أندرويد:** الإعدادات ← الأمان ← التشفير وبيانات الاعتماد ← تثبيت شهادة ← شهادة CA ← اختر الملف.
   - **ويندوز:** افتح الملف ← Install Certificate ← Local Machine ← «Place all certificates in the following store» ← Trusted Root Certification Authorities.
   - **آيفون وآيباد:** افتح الملف ثم الإعدادات ← عام ← VPN وإدارة الأجهزة ← ثبّت الملف. ثم الإعدادات ← عام ← حول ← إعدادات الثقة بالشهادات ← فعّلها.
3. افتح `https://192.168.1.20`.

هذه الشهادة لا تصلح إلا للعناوين المحلية (مثل 192.168.x.x) ولا تؤثر على أي موقع آخر.

## النسخ الاحتياطي

- `pnpm local:backup` يصنع نسخة مشفّرة باسم فيه التاريخ والوقت في `deploy/local/backups`، ومعها ملف بصمة وملف «manifest» فيه عدد الصفوف في كل جدول.
- يبقى آخر 14 نسخة، ويحذف الأقدم آلياً. لتغيير العدد عدّل `SERVA_BACKUP_KEEP` في `.env`.
- النشر يصنع نسخة قبل أي تحديث، اسمها ينتهي بـ `pre-deploy`.
- **انسخ مجلد `deploy/local/backups` مرة في الأسبوع إلى قرص خارجي أو فلاشة.** النسخة الموجودة على نفس الكمبيوتر لا تحمي من تلف قرصه.

### نسخة آلية كل ليلة

- **لينكس:** اكتب `crontab -e` وأضف السطر:

  ```
  30 23 * * * cd ~/serva-pos && bash scripts/local/backup.sh >> ~/serva-backup.log 2>&1
  ```

- **ويندوز:** افتح «Task Scheduler» ← Create Basic Task ← يومياً الساعة 11:30 مساءً ← Start a program:
  - البرنامج: `wsl.exe`
  - الوسائط: `-d Ubuntu -- bash -lc "cd ~/serva-pos && bash scripts/local/backup.sh >> ~/serva-backup.log 2>&1"`

## تمرين الاستعادة (مرة في الأسبوع)

```bash
pnpm local:restore latest
```

يأخذ آخر نسخة ويستعيدها في قاعدة جديدة مؤقتة منفصلة تماماً، ولا يلمس بيانات الخادم. ثم يقارن عدد الصفوف وبصمة كل جدول بما سُجّل وقت النسخ، ويحذف القاعدة المؤقتة.

- **RESTORE DRILL PASSED** بالأخضر: النسخة سليمة وتُستعاد.
- **RESTORE DRILL FAILED** بالأحمر: لا تعتمد على هذه النسخة. خذ نسخة جديدة الآن وأعد التمرين، وأخبر الفريق التقني.

التقرير يُحفظ في `deploy/local/backups/drills/`.

## استعادة فعلية (عند فقد بيانات)

```bash
pnpm local:restore deploy/local/backups/<اسم النسخة>.dump.enc --replace-live
```

يجري تمرين الاستعادة أولاً، ولا يكمل إن فشل. ثم يأخذ نسخة من البيانات الحالية، ويطلب منك كتابة `RESTORE` للتأكيد. بعدها يستبدل البيانات ويعيد تشغيل الخادم ويفحصه. البيانات القديمة لا تُحذف، بل تبقى في قاعدة اسمها `serva_before_restore_...`.

### على كمبيوتر جديد

1. ثبّت كما في «التثبيت أول مرة»، ثم شغّل `pnpm local:up`.
2. افتح `deploy/local/.env` وضع كلمة سر النسخ الاحتياطي القديمة مكان قيمة `SERVA_BACKUP_PASSPHRASE`.
3. انسخ ملفات النسخة الثلاثة (`.dump.enc` و`.dump.enc.sha256` و`.manifest`) إلى `deploy/local/backups/`.
4. شغّل `pnpm local:restore deploy/local/backups/<اسم النسخة>.dump.enc --replace-live`.

سيحتاج كل مستخدم أن يسجّل الدخول من جديد.

## إذا حدثت مشكلة

| ما تراه                                                     | ما تفعله                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Docker is installed but not running`                       | شغّل Docker Desktop (ويندوز)، أو `sudo systemctl start docker` (لينكس)، وانتظر دقيقة ثم أعد الأمر.                                                                                                                         |
| `port is already allocated` أو `address already in use`     | برنامج آخر يستعمل المنفذ 80 أو 443. في `deploy/local/.env` غيّر `SERVA_HTTP_PORT=8080` و`SERVA_HTTPS_PORT=8443` ثم `pnpm local:up`. يصبح العنوان `https://192.168.1.20:8443`، وعدّل قاعدة الجدار الناري للمنفذين الجديدين. |
| الجهاز لا يفتح العنوان                                      | تأكد أنه على نفس الواي فاي (لا على بيانات الجوال)، وأن العنوان لم يتغير (`ipconfig`)، وأن قاعدة الجدار الناري موجودة والشبكة «خاصة». جرّب `https://localhost` على الخادم نفسه.                                             |
| تحذير «الاتصال غير آمن» أو «Your connection is not private» | لم تُثبَّت الشهادة على هذا الجهاز (انظر أعلاه)، أو تغيّر عنوان الخادم: شغّل `pnpm local:up` مرة واحدة.                                                                                                                     |
| `DEPLOY FAILED` أو `SMOKE TEST FAILED`                      | اقرأ الأسطر الحمراء فوقها، ثم `pnpm local:logs`. إن فشل البناء فلم يتغير شيء على الخادم. وإن فشل بعده فالنسخة `pre-deploy` موجودة. أرسل آخر 50 سطراً للفريق التقني.                                                        |
| `RESTORE DRILL FAILED`                                      | لا تعتمد على تلك النسخة. خذ نسخة جديدة وأعد التمرين. إن تكرر الفشل فافحص مساحة القرص (`df -h`) وأخبر الفريق التقني.                                                                                                        |
| `cannot decrypt`                                            | كلمة سر النسخ في `.env` ليست التي صُنعت بها النسخة.                                                                                                                                                                        |
| بعد إعادة تشغيل الكمبيوتر لا يفتح شيء                       | شغّل Docker Desktop إن لم يبدأ وحده، ثم `pnpm local:up`.                                                                                                                                                                   |
| رمز التحقق عند فتح حساب جديد لا يصل                         | طبيعي: الخادم المحلي لا يرسل رسائل SMS. في وضع التجربة يظهر الرمز على الشاشة نفسها؛ وإن كان `SERVA_OTP_DELIVERY=none` فالتسجيل متوقف (انظر «وضع التجربة» أعلاه).                                                           |

لا تكتب أبداً `docker compose down -v` ولا تحذف volumes من Docker Desktop: هذا يمحو قاعدة البيانات.

---

## For developers

### What runs

`deploy/local/compose.yml`, project name `serva-local`:

| Service    | Image                                  | Role                                                                                                                                                                         |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:16.15-bookworm`              | Data in volume `serva-local_pgdata`, page checksums on. Published on `127.0.0.1:${SERVA_PG_PORT:-5433}` only. Roles from `scripts/db-bootstrap.sql` via `pg/init-roles.sh`.  |
| `certs`    | same image (for `openssl`)             | One-shot. Local CA (volume `ca`, key never mounted elsewhere), server certificate for the LAN addresses (volume `certs`). Renews on address change or 30 days before expiry. |
| `migrate`  | `serva-api:local`                      | One-shot on every `up`: `dist/scripts/migrate.js` (owner role) then `dist/scripts/seed.js`. The API starts only after it succeeds.                                           |
| `api`      | `apps/api/Dockerfile`                  | `NODE_ENV=production`, `DEPLOYMENT=local`, `OTP_DELIVERY=${SERVA_OTP_DELIVERY:-screen}`, `TRUST_PROXY` = the web container's fixed IP, runtime role `serva_app`.             |
| `web`      | `apps/web/Dockerfile` (nginx, uid 101) | Static build, security headers, CSP with a per-request nonce, reverse proxy for `/v1/` and `/health`, `:80` → `:443` redirect, `/serva-local-ca.crt`.                        |

`api`, `migrate` and `web` run non-root with a read-only root file system, `cap_drop: ALL` and `no-new-privileges`. Logs rotate (10 MB × 5). Everything but the one-shots has `restart: unless-stopped`.

`scripts/local/demo-catalog.sh [store code]` runs the `migrate` image once more with `node dist/scripts/seed.js --demo-catalog [--store=<code>]` (apps/api/src/scripts/demo-catalog.ts): about 40 products, idempotent. In development: `DATABASE_MIGRATION_URL=… pnpm --filter @serva/api seed -- --demo-catalog`.

### Images

- `apps/api/Dockerfile`: `pnpm fetch` from the lockfile, `tsup` bundle (workspace packages inlined), then a separate `--prod --frozen-lockfile` install. The runtime stage holds `dist/`, production `node_modules` and `packages/db/drizzle` (`MIGRATIONS_DIR`), owned by root, run as `node`. Healthcheck: `GET /health`.
- `apps/web/Dockerfile`: Vite build, served by `nginxinc/nginx-unprivileged`. Config in `apps/web/nginx/` (template filled with `SERVA_*` env only).
- Build either from the repo root: `docker build -f apps/api/Dockerfile .`. Base images are pinned to exact tags (Node 22.23.3, nginx 1.30.5, PostgreSQL 16.15).

### Web CSP

`default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'nonce-…'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`

The nonce is nginx's `$request_id` (128 random bits, new per request); `sub_filter` stamps it on every `<script` and `<style` in `index.html`. No `unsafe-inline` or `unsafe-eval`. React's `style={…}` props go through CSSOM, which CSP allows. A library that injects `<style>` elements at runtime without the nonce will be blocked: check the browser console after adding one.

### Why HTTPS with a local CA

Service workers, `Secure` cookies (the API's refresh cookie is `Secure` in production) and device APIs (WebUSB, Web Serial, camera) need a secure context, and `http://192.168.x.x` is not one. A shop network has no public name, so the stack has its own CA. The CA carries **name constraints** (private IPv4 ranges, `localhost`, `.local`, `.lan`, `.home.arpa`, `.internal`), so a leaked CA key cannot mint a certificate for a real site on a device that trusts it. The certificate's addresses come from `ip -4 addr` (Linux), `Get-NetIPAddress` (WSL, Windows side), and `SERVA_EXTRA_HOSTS`.

### Backups

- `scripts/local/backup.sh` runs `deploy/local/pg/backup.sh` inside the postgres container: a `REPEATABLE READ` transaction exports its snapshot, and `pg_dump -Fc --snapshot=…` and `pg/table-stats.sql` both read that same snapshot. So the manifest's per-table counts and checksums describe exactly what the dump holds, even under writes.
- The dump is encrypted in the container (`openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256`, passphrase from the environment, never on a command line), so plaintext never reaches the host. The host keeps `.dump.enc`, `.dump.enc.sha256` (`sha256sum -c` format) and `.manifest` (the dump's own sha256 plus the stats), all mode 600 in a 700 folder.
- `table-stats.sql` prints one line per table, `schema.table|rows|md5(sorted md5 of each row::text)`, with fixed `TimeZone`, `DateStyle` and float settings. It also covers RLS flags, policies, table grants, functions and triggers.
- Restore drill: a throwaway container from the same image, `--network none`, roles from `db-bootstrap.sql`. Inside it, the backup is decrypted, its sha256 checked against the manifest **before** `pg_restore --exit-on-error --single-transaction`, and then the stats are diffed with the manifest. `--replace-live` repeats this into `serva_restoring` on the live cluster, swaps names, keeps `serva_before_restore_<time>`, and smoke-tests.
- Limits, by design for the local server: no WAL archiving or point-in-time recovery, no off-site copy, and CBC with a checksum rather than an authenticated cipher. The hosted step replaces this with pgBackRest (tab 16). After a restore, the `server_epoch` bump and the device resend (tab 16 › بعد أي استعادة) do not exist yet in the API.

### Environment (`deploy/local/.env`, generated, git-ignored)

`POSTGRES_PASSWORD`, `SERVA_OWNER_PASSWORD`, `SERVA_APP_PASSWORD`, `JWT_SECRET`, `SERVA_BACKUP_PASSPHRASE` and `PLATFORM_ADMIN_*` are random hex from `/dev/urandom`. The others:

- `SERVA_HTTP_PORT` and `SERVA_HTTPS_PORT`;
- `SERVA_PG_PORT`;
- `SERVA_SUBNET` and `SERVA_PROXY_IP`: change them together;
- `SERVA_EXTRA_HOSTS`;
- `SERVA_BACKUP_DIR` and `SERVA_BACKUP_KEEP`;
- `SERVA_OTP_DELIVERY`: `screen` (default, test mode) or `none`.

### Test mode (`OTP_DELIVERY=screen`)

Allowed only with `DEPLOYMENT=local`; the API's environment check refuses it otherwise, in every `NODE_ENV`. When on, the API logs a loud warning at startup, `POST /v1/auth/register` adds `testCode` to its 202 answer (for a number that already has an account, a code-shaped decoy that is never stored, so verification refuses it), every answer carries `x-serva-test-mode: 1`, and `GET /v1/meta` answers `{"testMode":true}`. The web app shows the code box on sign-up and the ribbon from that header; the cashier remembers the last value, since it opens without a request. `pnpm local:smoke` checks `/v1/meta` against `SERVA_OTP_DELIVERY`.

A variable already set in the shell wins over the file. Script-only knobs:

- `SERVA_COMPOSE_OVERRIDE`: an extra compose file;
- `SERVA_SKIP_PREDEPLOY_BACKUP=1`;
- `SERVA_SMOKE_LAN=require`;
- `SERVA_SMOKE_TIMEOUT`;
- `SERVA_WAIT_TIMEOUT`.

### Windows through WSL 2

Use Docker Desktop with WSL integration. Its published ports listen on Windows' interfaces, so devices reach the Windows LAN address.

With Docker Engine installed inside WSL instead, set `networkingMode=mirrored` under `[wsl2]` in `%UserProfile%\.wslconfig`, then run `wsl --shutdown`. Otherwise ports only exist on the WSL VM address. The smoke test's LAN check is a warning outside CI for this reason.

Clone inside the WSL file system. `.gitattributes` keeps `*.sh`, `*.sql` and the nginx config LF.

### CI

`.github/workflows/local-server.yml` runs on push, pull request, weekly and on demand. On a clean `ubuntu-latest` it runs, in order:

1. shellcheck, then `compose config`;
2. `pnpm local:deploy` from scratch, with the LAN check required;
3. the hardening checks;
4. the fixture (`scripts/local/ci-fixture.sql`);
5. `pnpm local:backup`, then `pnpm local:restore latest`;
6. the negative drills: a damaged file, a damaged file with forged checksums, a wrong passphrase, and a manifest that disagrees with the data. Each must FAIL;
7. a redeploy, which takes the pre-deploy backup and finds the migrations already applied;
8. data deleted, then `--replace-live` restores it, and the job checks the rows are back;
9. a store signed up through the real two-step API with the on-screen code, and a registered number's code refused (`ci-checks.sh signup`).

`scripts/local/ci-checks.sh` holds the assertions.
