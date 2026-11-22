# الخادم المحلي لسيرفا

هذا الدليل لصاحب المحل أو للفني الذي يجهّز الخادم. الخادم المحلي هو كمبيوتر واحد في المكتب يشغّل سيرفا كاملاً، وكل الأجهزة على نفس شبكة الواي فاي (الكاشير، الجوال، التابلت) تفتحه من المتصفح. هذا قرار المالك في تبويب الخطة: نبني ونجرّب كل شيء محلياً قبل الاستضافة. عليه بيانات تجريبية فقط.

**لتجربة كل شيء خطوة خطوة بعد التثبيت:** [`docs/owner-test-plan.md`](owner-test-plan.md).

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

   ثم ثبّت Node.js 22 وpnpm، وهما لأوامر `pnpm local:*` ولفحص السلامة ومفتاح النسخ:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc
   nvm install 22
   corepack enable
   pnpm install
   ```

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

2. ثبّت Node.js 22 وpnpm بالأوامر نفسها في خطوة ويندوز 3 أعلاه (`nvm install 22`، ثم
   `corepack enable`، ثم `pnpm install`).

## الأوامر

كل الأوامر تُكتب في نافذة Ubuntu (أو طرفية لينكس) داخل مجلد المشروع `~/serva-pos`.

إن كان Node.js وpnpm مثبتين استعمل العمود الأول. وإن لم يكونا مثبتين فالعمود الثاني يعمل بنفس الطريقة.

| ماذا تريد                                 | الأمر                                    | أو دون pnpm                              |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| أول تشغيل، أو نشر نسخة جديدة من الكود     | `pnpm local:deploy`                      | `bash scripts/local/deploy.sh`           |
| تشغيل الخادم                              | `pnpm local:up`                          | `bash scripts/local/up.sh`               |
| إيقاف الخادم (البيانات تبقى)              | `pnpm local:down`                        | `bash scripts/local/down.sh`             |
| نسخة احتياطية الآن                        | `pnpm local:backup`                      | `bash scripts/local/backup.sh`           |
| تمرين استعادة لآخر نسخة (لا يمس البيانات) | `pnpm local:restore latest`              | `bash scripts/local/restore.sh latest`   |
| فحص أن كل شيء يعمل                        | `pnpm local:smoke`                       | `bash scripts/local/smoke.sh`            |
| فحص سلامة الدفاتر (قراءة فقط)             | `pnpm local:integrity`                   | `bash scripts/local/integrity.sh`        |
| جدولة النسخ اليومي، وحالته                | `pnpm local:schedule install` / `status` | `bash scripts/local/schedule.sh install` |
| تقسيم مفتاح النسخ إلى ثلاثة أجزاء         | `pnpm local:key split`                   | `bash scripts/local/key.sh split`        |
| عرض السجلات عند مشكلة                     | `pnpm local:logs`                        | `bash scripts/local/logs.sh`             |

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

### إرسال الرمز عبر واتساب (بوابة)

بدل الرمز على الشاشة، يمكن أن يصل رمز التسجيل إلى جوال صاحب الحساب عبر خدمة إرسال منفصلة:
بوت واتساب الآن، ومزوّد SMS لاحقاً. الخادم لا يعرف أي منهما، فتغيير القناة لا يغيّر شيئاً
فيه. في `deploy/local/.env`:

```
SERVA_OTP_DELIVERY=gateway
SERVA_OTP_GATEWAY_URL=http://192.168.1.30:3001/send
SERVA_OTP_GATEWAY_TOKEN=<سر طويل، 16 حرفاً على الأقل>
```

ثم `pnpm local:up`.

**ما تستقبله البوابة:**

- طلب `POST` إلى العنوان، فيه الترويسة `Authorization: Bearer <السر>`.
- جسم JSON:

  ```json
  {
    "phone": "+963933123456",
    "code": "482913",
    "purpose": "registration",
    "text": "رمز التحقق في سيرفا: 482913 …"
  }
  ```

- يجب أن تجيب بـ 2xx حين تقبل الرسالة.

إن لم تجب خلال 10 ثوانٍ، أو أجابت بغير ذلك، تظهر للمستخدم «لا يمكن إرسال رمز التحقق الآن»،
ويُسجَّل السبب دون الرمز.

**البوت جاهز في المستودع:** `tools/whatsapp-otp-bot` يربط رقم واتساب بمسح رمز QR مرة واحدة،
ويستقبل هذه الطلبات ويرسلها. خطوات تشغيله في `tools/whatsapp-otp-bot/README.md`.

**تنبيه:** بوتات واتساب غير الرسمية قد يحظر واتساب رقمها. استعمل رقماً مخصصاً للبوت لا رقمك
الشخصي. وعلى الخادم السحابي يجب أن يكون عنوان البوابة `https://`.

### إرسال الرمز عبر رسالة نصية SMS

لأن بوت واتساب غير الرسمي قد يُحظر، يوجد مسار SMS عام يعمل مع أي مزوّد يملك واجهة HTTP.
لا شيء مكتوب في الكود لمزوّد بعينه: تصف الطلب بإعدادات في `deploy/local/.env`:

```
SERVA_OTP_DELIVERY=sms
SERVA_SMS_GATEWAY_URL=https://api.provider.example/v1/messages
SERVA_SMS_GATEWAY_AUTH_HEADER=Authorization: Bearer <المفتاح>
SERVA_SMS_GATEWAY_BODY={"to":"{phone}","text":"{message}"}
# اختيارية: SERVA_SMS_GATEWAY_METHOD=POST (أو PUT أو GET)
#           SERVA_SMS_GATEWAY_CONTENT_TYPE=application/json
```

في العنوان والجسم تُستبدل هذه الأسماء بين قوسين معقوفين: `{phone}` الرقم بصيغة `+963933123456`،
و`{digits}` الأرقام فقط `963933123456` (بعض المزوّدين يريدونه هكذا)، و`{code}` الرمز، و`{message}`
نص الرسالة الكامل. كل قيمة تُهرَّب بحسب مكانها: نص JSON آمن داخل جسم JSON، وترميز URL داخل
`application/x-www-form-urlencoded` أو داخل العنوان. أمثلة:

```
# نموذج (form)
SERVA_SMS_GATEWAY_CONTENT_TYPE=application/x-www-form-urlencoded
SERVA_SMS_GATEWAY_BODY=to={digits}&text={message}
# مزوّد يريد GET والمفتاح في العنوان
SERVA_SMS_GATEWAY_METHOD=GET
SERVA_SMS_GATEWAY_URL=https://sms.example/send?key=<المفتاح>&to={digits}&msg={message}
```

يجب أن يظهر `{message}` أو `{code}` في العنوان أو الجسم، وإلا يرفض الخادم الإقلاع. ترويسة
المصادقة سطر واحد `الاسم: القيمة`. أي رد 2xx يعني أن المزوّد قبل الرسالة؛ غير ذلك، أو عدم الرد
خلال 10 ثوانٍ، يظهر للمستخدم «لا يمكن إرسال رمز التحقق الآن»، ويُسجَّل السبب (رقم الحالة فقط)
دون الرمز ودون الرقم. على الخادم السحابي يجب أن يكون العنوان `https://`.

**قناة احتياطية:** `SERVA_OTP_FALLBACK=gateway` مع `SERVA_OTP_DELIVERY=sms` يجرّب SMS أولاً، فإن
فشل أرسل عبر بوت واتساب (والعكس صحيح: `SERVA_OTP_DELIVERY=gateway` مع `SERVA_OTP_FALLBACK=sms`).
كل قناة تحتاج إعداداتها. رسائل البث إلى الزبائن (العروض) لا تُرسل بـ SMS إلا إن وضعت
`SERVA_SMS_ALLOW_BROADCASTS=true`، لأن كل رسالة مدفوعة.

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

### نسخة خارج المحل (ضرورية)

النسخة الموجودة على نفس الكمبيوتر لا تحمي من حريق أو سرقة أو تلف القرص. لذلك ضع في
`deploy/local/.env` مجلداً خارج هذا القرص، أو مجلداً تزامنه خدمة سحابية:

```
SERVA_OFFSITE_DIR=/mnt/d/serva-offsite                     # قرص خارجي (ويندوز: D:)
SERVA_OFFSITE_DIR=/mnt/c/Users/<اسمك>/Google Drive/serva   # مجلد Google Drive أو OneDrive
```

بعدها كل نسخة تُنسخ إلى هناك تلقائياً، وتُقارن بصمتها في المكان الجديد، ويبقى آخر 30 نسخة
(`SERVA_OFFSITE_KEEP`). النسخة مشفرة، فالمجلد السحابي لا يرى البيانات. وإن فشل النسخ
(القرص غير موصول مثلاً) يكتب **OFF-SITE COPY FAILED** وتبقى النسخة المحلية.

### نسخة خارج المحل في سلة تخزين سحابية (S3)

أي مزوّد يتكلم بروتوكول S3 يصلح: Backblaze B2 أو Wasabi أو Cloudflare R2 أو MinIO على خادم
آخر أو AWS S3. لا تثبّت شيئاً على الكمبيوتر: الرفع يتم بأداة rclone داخل حاوية Docker
(بإصدار مثبّت، ونظام ملفات للقراءة فقط، ودون صلاحيات). أنشئ سلة (bucket) ومفتاحاً له
صلاحية القراءة والكتابة والحذف في هذه السلة وحدها، ثم في `deploy/local/.env`:

```
SERVA_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com   # R2: https://<id>.r2.cloudflarestorage.com
SERVA_S3_BUCKET=اسم-السلة
SERVA_S3_ACCESS_KEY_ID=...
SERVA_S3_SECRET_ACCESS_KEY=...
SERVA_S3_PREFIX=serva-backups      # مجلد داخل السلة
SERVA_S3_KEEP=30                   # عدد النسخ المحفوظة في السلة
```

```bash
pnpm local:offsite test            # يكتب ملفاً صغيراً ويقرؤه ويحذفه: يثبت أن المفتاح والسلة صحيحان
pnpm local:offsite list            # النسخ الموجودة في السلة
```

بعدها كل `pnpm local:backup` (واليومي) يرفع الملفات الثلاثة بعد أن تُتحقَّق النسخة المحلية:
**الحجم** لكل ملف، و**sha256** لملف النسخة المشفّر بعد أن يُقرأ من السلة من جديد
(`SERVA_S3_VERIFY=size` يكتفي بالحجم إن كان الإنترنت محدود الحجم). السلة لا ترى البيانات
ولا كلمة السر: الملف مشفّر قبل أن يغادر الكمبيوتر. إن فشل الرفع يكتب
**OFF-SITE UPLOAD FAILED** ويخرج بخطأ (فيصل التنبيه)، وتبقى النسخة المحلية. يمكن استعمال
المجلد والسلة معاً.

- المفتاح يحتاج صلاحية الحذف ليُبقي آخر 30 نسخة فقط. فعّل في السلة نفسها «إصدارات الملفات»
  (versioning) أو «قفل الكائنات» (object lock)، مع قاعدة تحذف الإصدارات القديمة بعد 30 يوماً:
  هكذا لا يستطيع خطأ أو فيروس على الكمبيوتر أن يمحو النسخ البعيدة نهائياً.
- لـ MinIO داخل Docker على نفس الكمبيوتر: `SERVA_S3_DOCKER_NETWORK=<اسم شبكة Docker>`
  و`SERVA_S3_ENDPOINT=http://minio:9000`. العنوان `http://` مقبول فقط لجهاز على شبكة المحل.

**الاستعادة من السلة** (كمبيوتر جديد أو بعد فقد القرص):

1. ثبّت المشروع وضع في `deploy/local/.env` كلمة سر النسخ `SERVA_BACKUP_PASSPHRASE` (من جزأي المفتاح،
   انظر «مفتاح النسخ بثلاثة أجزاء») وإعدادات `SERVA_S3_*`.
2. `pnpm local:offsite list` ثم `pnpm local:offsite fetch latest` (أو اسم نسخة محددة).
   ينزّل الملفات الثلاثة إلى مجلد النسخ ويتحقق من بصمتها، ويرفض ملفاً تالفاً.
3. `pnpm local:restore deploy/local/backups/<الاسم>.dump.enc` تمرين استعادة (لا يمس الخادم)،
   ثم أضف `--replace-live` لتطبيقها فعلاً. تفاصيلها في «استعادة فعلية».

### تنبيهات: فشل النسخ أو تأخره أو توقف الخادم

بدون تنبيه، نسخة فاشلة لا يعرف بها أحد إلا يوم الحاجة إليها. التنبيه رسالة تذهب إلى رابط
(webhook) تحدده؛ يعمل مع Slack وDiscord وTelegram وبوابة واتساب، وهو مطفأ حتى تضع الرابط:

```
# Slack أو Discord: الرابط وحده يكفي
SERVA_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
# Telegram: أنشئ بوتاً من @BotFather، وضع معرّف المحادثة في الرابط
SERVA_ALERT_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
SERVA_ALERT_FORMAT=form
# بوابة واتساب أو أي خدمة تأخذ JSON وتحتاج مفتاحاً
SERVA_ALERT_WEBHOOK_URL=http://192.168.1.30:3001/send
SERVA_ALERT_AUTH_HEADER=Authorization: Bearer <السر>
SERVA_ALERT_BODY={"phone":"+963933123456","text":"{message}"}
```

`pnpm local:alert test` يرسل رسالة تجريبية. الرابط والمفتاح سرّان: لا يظهران في السجل ولا في
قائمة العمليات، ورسالة التنبيه لا تحوي أسراراً. يُقبل `http://` فقط لجهاز على شبكة المحل.

متى يصلك تنبيه:

- **فشل النسخ**: تعذّر التفريغ، أو التشفير، أو النسخ إلى المجلد/السلة، أو لم يطابق ما كُتب ما
  في النسخة (في اللحظة نفسها).
- **تأخر النسخ**: آخر نسخة، أو آخر نسخة خارج المحل (مجلد أو سلة)، أقدم من 26 ساعة، أو لا
  يوجد نسخ خارج المحل أصلاً. يفحص cron كل ساعة، ويكرر التنبيه كل 12 ساعة
  (`SERVA_ALERT_REPEAT_HOURS`) ما دامت المشكلة قائمة.
- **توقف الخادم**: `/health` لا يجيب 3 مرات متتالية (نحو 15 دقيقة)، ورسالة ثانية حين يعود.
  `pnpm local:health-watch` يفحص مرة واحدة (`SERVA_HEALTH_URL` لعنوان آخر).
- **فشل التنظيف اليومي** (التالي).

الكمبيوتر المطفأ لا يرسل شيئاً. لذلك ضع في `SERVA_BACKUP_PING_URL` رابط «مفتاح الرجل الميت»
من خدمة مجانية مثل healthchecks.io أو Uptime Kuma: يُستدعى بعد كل نسخة ناجحة تماماً (بما في
ذلك النسخ خارج المحل)، وتنبّهك الخدمة إن لم يصلها نداء خلال يوم. وللتحقق من أن الخادم
نفسه يُرى من الإنترنت استعمل أي خدمة فحص خارجية على `https://<عنوانك>/health` (UptimeRobot
وغيرها)؛ ما يعمل على الكمبيوتر نفسه لا يرى انقطاع الكهرباء.

### نسخة آلية كل يوم

```bash
pnpm local:schedule install    # كل يوم الساعة 02:17 (غيّرها بـ SERVA_BACKUP_TIME في .env)
pnpm local:schedule status     # آخر نسخة وآخر نسخة خارج المحل، وعمر كل منهما
pnpm local:schedule check      # مثل status، لكن يرسل تنبيهاً إن وُجدت مشكلة
pnpm local:schedule remove
```

`install` يضيف سطور cron: النسخة اليومية، والتنظيف اليومي 03:47، وإن كان
`SERVA_ALERT_WEBHOOK_URL` موضوعاً فأيضاً فحص التأخر كل ساعة وفحص الخادم كل 5 دقائق (إن
وضعته بعد التثبيت أعد `install`). `status` يحذّر إن مرّ على آخر نسخة، أو آخر نسخة خارج
المحل، أكثر من 26 ساعة. السجلات في `deploy/local/backups`: `daily.log` و`cleanup.log`
و`watch.log` و`health.log`. ويجب أن يكون الكمبيوتر يعمل في ذلك الوقت.

### التنظيف اليومي

جلسات الدخول تُنشئ صفاً جديداً مع كل تجديد للرمز، ولا يحذفها أحد، فتكبر قاعدة البيانات بلا
حد. `pnpm local:cleanup` (يشغّله `install` كل يوم) يحذف فقط ما لا يمكن استعماله بعد الآن:
جلسات انتهى رمزها أو انتهت مدتها المطلقة منذ أكثر من 7 أيام، ورموز ربط الأجهزة التي انتهت
ولم تُستعمل، ورموز التسجيل القديمة، وعدّادات الحدود المنتهية. لا يلمس الفواتير ولا القيود ولا
سجل التدقيق. آمن في أي وقت، ويطبع عدد الصفوف المحذوفة.

**على ويندوز:** cron داخل WSL لا يعمل إلا وWSL يعمل. أسهل طريقة: افتح «Task Scheduler» ←
Create Basic Task ← يومياً ← Start a program:

- البرنامج: `wsl.exe`
- الوسائط: `-d Ubuntu -- bash -lc "cd ~/serva-pos && bash scripts/local/backup.sh --label daily >> deploy/local/backups/daily.log 2>&1"`

### مفتاح النسخ بثلاثة أجزاء (أي جزأين يكفيان)

كل النسخ مشفرة بكلمة سر النسخ (`SERVA_BACKUP_PASSPHRASE`). من دونها لا تُفتح أي نسخة. ولكي
لا تضيع، ولا يملكها شخص واحد، قسّمها:

```bash
pnpm local:key split
```

يطبع ثلاثة أجزاء، ولا يكتب شيئاً على القرص:

1. **جزء المالك:** في مدير كلمات السر أو على الجوال، لا على هذا الكمبيوتر.
2. **جزء سيرفا:** يُرسل إلى دعم سيرفا ليحفظه لك.
3. **جزء الورق:** يُطبع ويوضع في ظرف مختوم بعيداً عن المحل.

**أي جزأين يعيدان المفتاح، وجزء واحد لا يكفي ولا يكشف عنه شيئاً.** فإن غابت سيرفا يكفي
جزء المالك مع الورقة. وفي آخر كل جزء رمز تدقيق قصير يكشف أي خطأ في النسخ باليد قبل
استعماله. هذا مختبَر في CI: كل زوج من الأجزاء الثلاثة يستعيد نسخة خارج المحل، وجزء واحد
وحده يُرفض.

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
2. أعد مفتاح النسخ القديم بأي جزأين من أجزائه الثلاثة:

   ```bash
   pnpm local:key combine --set-env "<الجزء الأول>" "<الجزء الثاني>"
   ```

   أو افتح `deploy/local/.env` وضع كلمة سر النسخ القديمة مكان قيمة `SERVA_BACKUP_PASSPHRASE`.

3. انسخ ملفات النسخة الثلاثة (`.dump.enc` و`.dump.enc.sha256` و`.manifest`) من مجلد النسخ خارج المحل إلى `deploy/local/backups/`.
4. شغّل `pnpm local:restore deploy/local/backups/<اسم النسخة>.dump.enc --replace-live`.

سيحتاج كل مستخدم أن يسجّل الدخول من جديد.

## لوحة المنصة والطابعة

- **لوحة المنصة** على `https://<عنوان الخادم>/platform`، بحساب منفصل عن حسابات المتاجر. البريد
  وكلمة السر في `deploy/local/.env` (`PLATFORM_ADMIN_EMAIL` و`PLATFORM_ADMIN_PASSWORD`)، ويُنشأ
  الحساب عند كل `pnpm local:deploy` إن لم يكن موجوداً. منها تؤكد دفعات الاشتراك، وتعدّل الباقات
  وأسعارها، وتكتب رقم حساب شام كاش وسعر الدولار للفواتير.
- **الطابعة الحرارية:** على جهاز الكاشير افتح «المزيد» ← «الطابعة». الطباعة المباشرة على USB
  تحتاج متصفح كروم أو إيدج على الجهاز نفسه، والطابعة موصولة به. يُطبع الإيصال صورةً، فيظهر
  بالعربي على أي طابعة حرارية تقبل ESC/POS، ولو لم تحمل خطاً عربياً.

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
- Limits, by design for the local server: no WAL archiving or point-in-time recovery, and CBC with a checksum rather than an authenticated cipher. The hosted step replaces this with pgBackRest (tab 16). After a restore, the `server_epoch` bump and the device resend (tab 16 › بعد أي استعادة) do not exist yet in the API.

### Environment (`deploy/local/.env`, generated, git-ignored)

`POSTGRES_PASSWORD`, `SERVA_OWNER_PASSWORD`, `SERVA_APP_PASSWORD`, `JWT_SECRET`, `SERVA_BACKUP_PASSPHRASE` and `PLATFORM_ADMIN_*` are random hex from `/dev/urandom`. The others:

- `SERVA_HTTP_PORT` and `SERVA_HTTPS_PORT`;
- `SERVA_PG_PORT`;
- `SERVA_SUBNET` and `SERVA_PROXY_IP`: change them together;
- `SERVA_EXTRA_HOSTS`;
- `SERVA_BACKUP_DIR` and `SERVA_BACKUP_KEEP`;
- `SERVA_OTP_DELIVERY`: `screen` (default, test mode), `none`, `gateway` or `sms`; `SERVA_OTP_FALLBACK`;
- `SERVA_OTP_GATEWAY_URL`/`_TOKEN` and `SERVA_SMS_GATEWAY_URL`/`_METHOD`/`_AUTH_HEADER`/`_CONTENT_TYPE`/`_BODY`, `SERVA_SMS_ALLOW_BROADCASTS` (passed to the API as `OTP_GATEWAY_*`, `SMS_GATEWAY_*`, `SMS_ALLOW_BROADCASTS`);
- `SERVA_SENTRY_DSN`, `SERVA_SENTRY_ENVIRONMENT`, `SERVA_SENTRY_RELEASE` (API error reports, below);
- `SERVA_OFFSITE_DIR`/`SERVA_OFFSITE_KEEP` (folder) and `SERVA_S3_ENDPOINT`, `SERVA_S3_BUCKET`, `SERVA_S3_ACCESS_KEY_ID`, `SERVA_S3_SECRET_ACCESS_KEY`, `SERVA_S3_PREFIX`, `SERVA_S3_REGION`, `SERVA_S3_KEEP`, `SERVA_S3_VERIFY`, `SERVA_S3_DOCKER_NETWORK`, `SERVA_RCLONE_IMAGE` (bucket);
- `SERVA_ALERT_WEBHOOK_URL`, `SERVA_ALERT_FORMAT` (`json`|`form`), `SERVA_ALERT_BODY`, `SERVA_ALERT_AUTH_HEADER`, `SERVA_ALERT_NAME`, `SERVA_ALERT_REPEAT_HOURS`, `SERVA_BACKUP_PING_URL`, `SERVA_HEALTH_URL`, `SERVA_HEALTH_FAILS`.

### Off-site bucket, alerts, cleanup, error reports (all optional, all off by default)

- **Bucket upload** (`scripts/local/offsite-s3.sh`, called by `backup.sh` after the local copy and the optional folder copy). Tool: rclone, `rclone/rclone` pinned by tag and digest, run with `docker run --read-only --cap-drop ALL --security-opt no-new-privileges --user <uid> --memory 512m`, backup folder mounted read-only (read-write only for `fetch`). Why rclone and not aws-cli: one static binary for every S3-compatible provider (`provider=Other`, path-style by default), checksum-aware transfers, a small image, and no dependence on the aws-cli v2.23+ default checksum headers that B2 and some R2/MinIO versions reject. The remote is configured through `RCLONE_CONFIG_SERVA_*` environment variables, so no config file is written; the two secrets are passed to `docker run` by name. Verify = sizes of the three files from `lsf`, then `rclone hashsum sha256 --download` of the `.dump.enc` against the manifest's `encrypted_sha256`. The manifest is uploaded last, so a copy that has one is complete. `last-s3` in the backup folder is written only after verification and drives the staleness check. Failure of the folder copy or the upload fails the run (exit 1) after the other was tried; the local backup is always kept.
- **Alerts** (`scripts/local/alert.sh`, sourced): one webhook, `json` (body template with `{message}` filled in JSON-escaped; default carries both `text` for Slack and `content` for Discord) or `form` (`text=` urlencoded, for Telegram). The URL and auth header reach curl through `--config -` on stdin, never argv, and are never printed. Plain `http://` is accepted only for localhost, private IPv4, dotless and `.local/.lan/.internal/.home.arpa` hosts. `backup.sh` and `cleanup.sh` alert from an `EXIT` trap, using the message `die` stored in `SERVA_LAST_ERROR`. `send_alert_once` repeats a standing problem at most every `SERVA_ALERT_REPEAT_HOURS` (state in `<backups>/alert-state/`). Cron lines (added by `schedule.sh install`): backup 02:17, cleanup 03:47, and only when a webhook is set, `schedule.sh check` hourly and `health-watch.sh --quiet` every 5 minutes. A computer that is off cannot alert: `SERVA_BACKUP_PING_URL` (dead-man's switch) and an external uptime service cover that. For the hosted deployment, use the provider's uptime check on `/health` instead of the cron job.
- **Cleanup** (`deploy/local/pg/cleanup.sql`, `scripts/local/cleanup.sh`). Growth audit: `rate_limits` (swept inside `rate_limit_hit`), `otp_challenges` (swept in `otp_create`) and snapshot files (swept on build) already clean themselves while the server is used; `sessions` did not: every refresh inserts a row and revokes the old one, so a till refreshing every 15 minutes adds ~100 rows a day forever. `serva_app` has no `DELETE` on `sessions` and RLS hides other stores' rows, so an in-process job cannot do it; the SQL runs as the `postgres` superuser through `docker compose exec`, which needs no migration. The sessions rule (`least(expires_at, absolute_expires_at) < now() - 7 days`) cannot affect `isSessionLive`, which needs an unrevoked row with both dates in the future. Not touched: `pin_attempts` (bounded by users x devices), `legal_acceptances`, `audit_logs` and `sync_inbox` (kept by design; their partitions are managed separately). The hosted deployment needs the same statements on a schedule (pg_cron or the platform's cron) with a role that can delete from `sessions`.
- **Error reports** (`apps/api/src/http/error-reporting.ts`, enabled by `SENTRY_DSN`). A small Sentry-protocol client (envelope endpoint, so Sentry and GlitchTip both work) instead of the Sentry SDK: the SDK adds ~100 packages (OpenTelemetry), patches Node internals and by default captures request data, while this client can only send what `buildEvent` builds: `serializeError` output (no SQL text, parameters, Postgres `detail`; quoted values masked), a second `scrubText` pass (SQL-looking text, e-mail, phone numbers, JWTs, long secrets), the route pattern (`/v1/x/:id`, never the URL), method, status and the request `ref`. No headers, cookies, body, query, user, IP or breadcrumbs. 5xx only (not 4xx, not the 503 load shedding), at most 30 reports a minute, 5 s timeout, never affects the response. `server.ts` also reports `uncaughtException`/`unhandledRejection` and flushes before exiting. Tests: `apps/api/test/error-reporting.test.ts`. The web app is not instrumented: a browser reporter needs the DSN host in the CSP `connect-src` of `apps/web/nginx` (fixed until the host is chosen), would ship page URLs and cashier data paths unless filtered as strictly, and the cashier is offline-first, so reports would arrive late and out of context. Revisit when the hosting and the tracker are chosen.

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
