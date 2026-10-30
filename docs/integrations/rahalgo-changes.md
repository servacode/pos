# طلب تعديل: ربط رحّال غو مع Serva POS

> **هذا طلبٌ لا قرار.** صاحبُ رحّال يقرّر ما يُقبل منه ومتى، ويُنفَّذ بقواعد رحّال نفسها:
> تحليلٌ مكتوب، ثمّ موافقة، ثمّ دفعةٌ واحدةٌ في كلّ مرّة.
> كُتب بعد قراءة شيفرة رحّال في ٢٠٢٦-١٠-٢٩ (آخرُ التزام `5e9228e`). المواصفاتُ الكاملة لجهة Serva في تبويب «الربط مع رحّال غو» في مستند Serva الحيّ.

## الهدف بسطرين

**محلٌّ يشتغل على Serva POS لا يُدخل شيئاً في رحّال مرّةً ثانية**: أصنافُه وصورُه وخياراتُه وأسعارُه وتوفّرُه ودوامُه وملفُّ متجره تنزل وحدها، وكلُّ تعديلٍ يصل خلال ثوانٍ.
**وطلباتُ رحّال ترجع إلى كاشير المحل ومطبخه**، وحالاتُها وتسوياتُها إلى محاسبته.

## ما لا يُمسّ في رحّال

- **أقسامُ السوق ملكُ المنصّة** (`platform_sections`)، وهامشُها وسعرُ الزبون وعروضُها ومراجعةُ القائمة إن شُغّلت.
- **وضعُ إدارة الطلبات** (`platform.orders_mode`) كما هو: على «المنصّة» يرى Serva الحالةَ فقط.
- **بياناتُ الزبون لا تصل للمتجر** — ولا لـServa.
- **اسمُ المتجر وشعارُه ظاهران للزبون** (على الصنف منذ ٢٠٢٦-١٠-١٥، وفي «متاجر مميّزة» وصفحة المتجر منذ ٢٠٢٦-١٠-١٨) — فيُرسَلان من Serva كما هما.

## المصطلحات

| الكلمة              | معناها هنا                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **رمزُ الربط**      | توكنٌ لمتجرٍ واحد بصلاحياتٍ محدّدة، يصدر بموافقة صاحبه                                                                            |
| **`external_code`** | رمزُ المتغيّر الثابت في Serva — به يُعرَف الصنفُ في الطرفين، **لا الباركود**                                                      |
| **المبالغ**         | الليرةُ الجديدة كاملةً كما يحفظها رحّال (`bigint`)، والدولارُ بالسنت في القاعدة وبالرقم العشريّ في الطلب كما في `price_usd` اليوم |

---

## التغييرات — بترقيم تبويب Serva نفسه

### ١ · رموزُ الربط

**لماذا:** Serva يحتاج صلاحياتٍ محدودةً لمتجرٍ واحد، لا كلمةَ سرّ صاحبه ولا رمزَ مزامنة الأمين.

**أين:**

- هجرةٌ جديدة في `backend/internal/migrate/migrations/`: جدول `merchant_integrations`.
- الوسيطُ والصلاحيات: `backend/internal/auth` و`backend/internal/authz` — نوعُ هويّةٍ جديد «تكامل» لا «مستخدم».
- شاشةُ الموافقة في بوّابة المتجر (`web/apps/merchant`)، وقائمةُ الروابط في لوحة الإدارة.

**الجدول المقترح:**

```sql
CREATE TABLE merchant_integrations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id   uuid NOT NULL REFERENCES merchants (id),
    provider      text NOT NULL CHECK (provider IN ('serva')),
    token_hash    text NOT NULL,              -- يُحفظ مُجزَّأً كرمز مزامنة الأمين
    scopes        text[] NOT NULL,            -- catalog.write · orders.read · orders.transition · settlements.read · deliveries.create
    webhook_url   text,                        -- عنوانُ Serva لاستقبال الأحداث
    webhook_secret_hash text,
    approved_by   uuid REFERENCES users (id),  -- صاحبُ المتجر
    last_used_at  timestamptz,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX merchant_integrations_live_uq
    ON merchant_integrations (merchant_id, provider) WHERE revoked_at IS NULL;
```

**المسار:** Serva يطلب الربط برقم المتجر ← يصل صاحبَه في بوّابته «Serva POS يطلب الربط بمتجرك» بالصلاحيات مكتوبةً ← يوافق ← يصدر الرمزُ مرّةً واحدة إلى Serva. **ويلغيه صاحبُ المتجر أو الإدارةُ متى شاءا**، فيتوقّف كلُّ شيءٍ فوراً.

```http
POST /api/v1/integrations/link-requests          ← من Serva (بمفتاح شريكٍ عامّ للمنصّة)
{ "merchant_number": 1042, "provider": "serva", "branch_label": "الفرع الرئيسي",
  "webhook_url": "https://api.serva.example/v1/channels/rahalgo/webhook" }

→ 202 { "request_id": "…", "status": "awaiting_merchant" }
→ عند الموافقة: حدثُ merchant.link_approved إلى webhook_url ومعه الرمزُ مرّةً واحدة
```

**فحوصُ القبول:** رمزٌ ملغى ⇒ `401` في الطلب التالي · رمزُ متجرٍ لا يقرأ ولا يكتب متجراً آخر · كلُّ استعمالٍ يحدّث `last_used_at`.

---

### ٢ · واجهةُ القائمة بالرمز الخارجي

**لماذا:** Serva ينشئ ويعدّل دون أن يعرف معرّفات رحّال. **والأساسُ موجود**: فهرسُ `menu_items_external_code_uq` على `(merchant_id, external_code)`.

**أين:** ملفٌّ جديد `backend/internal/server/integration_handlers.go`، **يستعمل `catalog.Service` نفسَه** (بُنى الإدخال في `backend/internal/catalog/menu.go`) فلا تنشأ قواعدُ ثانيةٌ للصنف.

```http
PUT /api/v1/integrations/stores/{merchant_id}/items
Authorization: Bearer <رمز الربط>
Idempotency-Key: 7f3c…           ← الحارسُ الموجود s.idempotent
```

```json
{
  "items": [
    {
      "external_code": "V-000154",
      "section": { "external_code": "C-12", "name": "المشاوي" },
      "platform_section_id": "8d1e…",
      "name": "شيش طاووق",
      "description": "صدر دجاج متبّل على الفحم",
      "price_currency": "SYP",
      "merchant_price": 45000,
      "available": true,
      "barcode": "6291234567890",
      "image": {
        "url": "https://files.serva.example/s/abc…?exp=…&sig=…",
        "sha256": "9f2b…",
        "width": 1600,
        "height": 1600
      },
      "modifiers": [
        {
          "external_code": "MG-7",
          "name": "الحجم",
          "min_select": 1,
          "max_select": 1,
          "price_mode": "priced",
          "options": [
            { "external_code": "MO-71", "name": "وسط", "price_delta": 0, "available": true },
            { "external_code": "MO-72", "name": "كبير", "price_delta": 10000, "available": true }
          ]
        }
      ]
    },
    {
      "external_code": "V-000377",
      "section": { "external_code": "C-3", "name": "اللحوم" },
      "platform_section_id": "a41c…",
      "name": "لحم غنم مفروم",
      "price_currency": "USD",
      "price_usd": 9.5,
      "available": true,
      "modifiers": [
        {
          "external_code": "MG-W1",
          "name": "الوزن",
          "min_select": 1,
          "max_select": 1,
          "price_mode": "weight",
          "base_grams": 1000,
          "options": [
            { "external_code": "MO-W250", "name": "ربع كيلو", "grams": 250 },
            { "external_code": "MO-W500", "name": "نص كيلو", "grams": 500 },
            { "external_code": "MO-W1000", "name": "كيلو", "grams": 1000 }
          ]
        }
      ]
    }
  ]
}
```

**الجواب — لكلّ صنفٍ حالُه، والدفعةُ لا تسقط بصنفٍ واحد:**

```json
{
  "results": [
    { "external_code": "V-000154", "item_id": "c0a…", "status": "published" },
    { "external_code": "V-000377", "item_id": "d71…", "status": "pending_review" },
    { "external_code": "V-000412", "status": "needs_section", "reason": "platform_section_id مفقود" },
    { "external_code": "V-000500", "status": "rejected", "reason": "errors.text_guard" }
  ]
}
```

- **حدُّ الدفعة مئةُ صنف**، والحقلُ الغائبُ لا يُمسّ (كقاعدة `SyncRow` اليوم).
- **السعرُ المرسَل هو سعرُ المتجر** (`merchant_price`) — **وسعرُ الزبون يحسبه رحّال بهامشه كأيّ صنف.**
- **ومتغيّراتُ البعدين** (مقاس × لون) تصل مجموعةً واحدةً إلزاميّةً «المقاس واللون»، لكلّ تركيبةٍ خيارٌ بتوفّره.

**فحوصُ القبول:** نفسُ الدفعة مرّتين ⇒ لا تكرار · صنفٌ موجودٌ يدويّاً بنفس الباركود يُطابَق ويُثبَّت عليه الرمز · `price_mode: weight` يظهر للزبون بخياراته كما يظهر اليوم.

**ومعه في الدفعة نفسها:**

```http
PATCH  /api/v1/integrations/stores/{id}/items/availability   { "items": [ { "external_code": "V-000154", "available": false } ] }
DELETE /api/v1/integrations/stores/{id}/items/{external_code}  ← «إخفاء» إن كان للصنف طلبات، وحذفٌ إن لم يكن
PUT    /api/v1/integrations/stores/{id}/hours                  { "days": [ { "day_of_week": 5, "closed": false, "open_time": "13:30", "close_time": "23:59" } ] }
POST   /api/v1/integrations/stores/{id}/emergency              { "closed": true }
PATCH  /api/v1/integrations/stores/{id}/exchange-rate          { "rate": 11800 }
```

تُعاد فيها المعالجاتُ الموجودة (`handleMerchantItemAvailability` · `handleMerchantSetHours` · `handleMerchantEmergency` · `handleMerchantExchangeRate`) **بهويّة الرمز بدل الجلسة.**

---

### ٣ · الصور بلا رفعٍ ثانٍ

**لماذا:** **صاحبُ المحلّ يرفع الصورةَ مرّةً واحدةً في Serva** — والآن لا يصل منها شيءٌ لرحّال إلّا برفعٍ يدويّ.

**أين:** `backend/internal/media/media.go` — دالّةٌ جديدة بجانب `Save`:

```go
// SaveFromURL **يجلب صورةً من رابطٍ موقَّعٍ ويحفظها كأيّ رفع.**
//   - الرابطُ من نطاقاتٍ مسموحةٍ فقط (إعدادٌ في اللوحة: integrations.media_hosts)
//   - مهلةُ ١٥ ثانية، والحدُّ media.max_upload_mb نفسُه، ثمّ Save كما هي
//   - إن وُجد وسيطٌ بالبصمة نفسها لهذا المتجر ⇒ يُعاد لا يُجلب
func (s *Service) SaveFromURL(ctx context.Context, actorID, kind, url, sha256 string) (*Media, error)
```

**الشكلُ يصل مع الصنف** (`"image": {url, sha256, width, height}`) أو مع ملفّ المتجر للشعار. **وبديلٌ إن لم تُرِد الجلبَ من الخارج:**

```http
POST /api/v1/integrations/stores/{id}/media     multipart: kind=menu_item|merchant_logo · file=…
→ 201 { "id": "…", "url": "/media/2026/10/….jpg", "thumb_url": "…" }
```

ثمّ يرسل Serva `image_media_id` مع الصنف بدل `image`.

**القواعد كما هي في رحّال:** JPEG أو PNG أو WebP · حتى `media.max_upload_mb` (٥ ميغا افتراضاً) و١٣ مليون بكسل · تُصغَّر إلى ١٦٠٠ مع مصغّرة ٤٠٠ ونسختَي ٤٨٠ و٩٦٠ ولمحة. **وServa يرسل نسخةً جاهزة**: أطولُ ضلعٍ ١٦٠٠، JPEG بجودة ٨٥.
**والإطار**: صورةُ الصنف «كاملة» افتراضاً كما في `ImageCrop` — **فتُحفظ بأبعادها**. **والشعارُ مربّعٌ وحدَه** — Serva يقصّه مربّعاً قبل الإرسال.

**فحوصُ القبول:** نفسُ البصمة مرّتين ⇒ جلبٌ واحد · رابطٌ من نطاقٍ غير مسموح ⇒ رفض · صورةٌ معطوبة ⇒ يُنشر الصنفُ بلا صورة وتعود الحالة `image_failed` ولا تسقط الدفعة.

---

### ٤ · أعمدةٌ جديدة

| الجدول                                 | العمود                                                                 | لماذا                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `menu_items`                           | `source text NOT NULL DEFAULT 'manual'` (`manual` · `ameen` · `serva`) | **من يملك الصنف** — وبه يُقفل                                 |
| `menu_items`                           | `integration_id uuid REFERENCES merchant_integrations (id)`            | أيُّ ربطٍ أنشأه                                               |
| `menu_sections`                        | `external_code text` + فهرسٌ فريدٌ لكلّ متجر                           | قسمُ المتجر يُطابَق بالرمز لا بالاسم                          |
| `modifier_groups` · `modifier_options` | `external_code text` + فهرسٌ فريدٌ داخل الصنف                          | تحديثُ الخيار لا إعادةُ إنشائه — **فلا ينكسر تاريخُ الطلبات** |

---

### ٥ · قفلُ الحقول في المحرّك لا في الشاشة فقط

**لماذا:** **لا سعرَ في مكانين.** متى كان `source = 'serva'`:

- **مقفولٌ** (يُعدَّل من Serva وحدَه): الاسم · الوصف · الصورة · سعرُ المتجر وعملتُه · الخيارات وأسعارُها · قسمُ المتجر.
- **مفتوحٌ لرحّال**: قسمُ السوق · الهامش (`margin_override`) · الترتيب · المراجعة · عروضُ المنصّة.
- **والتوفّرُ**: «نفد» من بوّابة رحّال **مسموح** — يُخفي في رحّال وحدَه ويصل Serva حدثاً (`item.availability_changed`) ولا يمسّ مخزونه.

**أين:** حارسٌ واحدٌ في `catalog.Service` قبل كلّ تحديث، **يمرّ به** `handleMerchantUpdateItem` و`handleMerchantBulkPrice` ولوحةُ الإدارة والمندوب ومزامنةُ الأمين. **والشاشات** (بوّابة المتجر، المندوب، الإدارة) تعرض الحقلَ للقراءة مع «يُعدَّل من Serva POS».

**وكذلك ملفُّ المتجر** (التغيير ١٣): **الاسمُ والشعارُ مقفولان** في `handleMerchantSettings` للمتجر المربوط، **والدبّوسُ لا يُقفل** — السائقُ يعتمد على دقّته.

**فحصُ القبول:** محاولةُ تعديل سعرٍ مقفولٍ من أيّ باب ⇒ `409 field_owned_by_integration`.

---

### ٦ · إشعاراتُ الأحداث

**لماذا:** الطلبُ يصل كاشيرَ المحلّ خلال ثلاث ثوانٍ، **ولا يوجد اليوم في رحّال إشعارٌ صادرٌ لطرفٍ خارجيّ.**

**أين:** جدولُ صندوقِ أحداث `integration_events` (يُكتب في نفس معاملة الحدث في `backend/internal/orders`)، وعاملٌ يرسل ويعيد المحاولة.

```http
POST {webhook_url}
X-Rahal-Event: order.created
X-Rahal-Delivery: 01JD…                       ← رقمُ الحدث — المكرّرُ لا يكرّر
X-Rahal-Signature: t=1793310000,kid=rk_2026_10,ed25519=<base64 توقيع على (t + "." + البايتات الخام للرسالة)>   ← انظر ١٦
```

```json
{
  "id": 88231,
  "type": "order.created",
  "merchant_id": "…",
  "occurred_at": "2026-10-29T18:04:11Z",
  "order": {
    "id": "…",
    "number": "R-55821",
    "status": "pending",
    "kind": "standard",
    "orders_mode": "merchants",
    "commission_percent": 10,
    "settlement_method": "wallet",
    "notes": "بدون بصل",
    "items": [
      {
        "external_code": "V-000154",
        "name": "شيش طاووق",
        "quantity": 2,
        "merchant_price": 45000,
        "options": [{ "external_code": "MO-72", "name": "كبير", "price_delta": 10000 }]
      }
    ]
  }
}
```

**لا اسمَ زبونٍ ولا هاتفَ ولا عنوان.** والأنواع: `order.created` · `order.accepted` · `order.rejected` · `order.cancelled` · `order.ready` · `order.picked_up` · `order.delivered` · `order.refunded` · `order.returned` · `item.availability_changed` · `settlement.paid` · `merchant.approved` · `merchant.link_approved` · `integration.revoked`.
**وإعادةُ المحاولة**: ٥ ثوانٍ، ٣٠، دقيقتان، ١٠ دقائق، ثمّ كلَّ نصف ساعةٍ ليوم.

---

### ٧ · التغذيةُ الاحتياطيّة

```http
GET /api/v1/integrations/events?after=88230&limit=200      ← برمز الربط
→ 200 { "events": [ … ], "next_after": 88412 }
```

**إن تعطّل الإشعارُ لا يضيع حدث** — Serva يسأل كلَّ دقيقة. **ومعها** `GET /api/v1/integrations/stores/{id}/settlements?after=` لكشف التسويات.

---

### ٨ · انتقالاتُ الطلب بالرمز

```http
POST /api/v1/integrations/orders/{id}/transition   { "to": "accepted", "prep_minutes": 20 }
POST /api/v1/integrations/orders/{id}/transition   { "to": "rejected", "note": "نفد الصنف" }
POST /api/v1/integrations/orders/{id}/ready
```

**يمرّان بالمعالجَين الموجودَين** (`handleMerchantTransition` · `handleMerchantReady`) **وبحارس `platform.orders_mode` نفسِه**: على «المنصّة» ⇒ `403 orders_mode_platform` وServa يعرض الحالة فقط.

---

### ٩ · طلبُ انضمامٍ من Serva

```http
POST /api/v1/integrations/leads
{ "name": "مطعم الياسمين", "phone": "+963944000000", "address_text": "شارع تل أبيض",
  "lat": 35.95, "lng": 39.01, "category": "restaurants", "referral": "serva" }
```

**يمرّ بالمسار المعتاد** (مندوبٌ ومراجعةُ الإدارة)، **وعند الموافقة** حدثُ `merchant.approved` ثمّ طلبُ الربط (التغيير ١).

### ١٠ · «لدي توصيلة» بالرمز

**قبولُ الرمز في** `delivery-quote` و`deliveries` (الموجودَين)، **وأحداثُ حالة التوصيلة** — فيطلب Serva سائقَ رحّال لطلبات متجره الإلكتروني والهاتف والجملة.

### ١١ · إيقافُ مزامنة الأمين للمتجر المربوط

**عند الربط**: `price_sync_stop = true` تلقائيّاً، **وتنبيهٌ في بوّابة المتجر** «أسعارُك تأتي الآن من Serva POS». **وعند فكّ الربط** لا تعود تلقائيّاً — يعيدها صاحبُ المتجر إن شاء. **مصدرٌ واحدٌ للصنف.**

### ١٢ · سقفُ الكمّيّة (اختياريّ)

`menu_items.max_order_qty int` — **يرسله Serva من المخزون المتاح**، فلا يطلب زبونٌ عشرين وفي الرفّ ثلاثة.

### ١٣ · ملفُّ المتجر بالرمز

```http
PUT /api/v1/integrations/stores/{id}/profile
{ "name": "مطعم الياسمين", "description": "مشاوي وشاورما منذ ٢٠٠٩",
  "phone": "+963944000000", "address_text": "شارع تل أبيض، مقابل الحديقة",
  "lat": 35.9512, "lng": 39.0107,
  "logo": { "url": "https://files.serva.example/s/…", "sha256": "1ac4…", "width": 800, "height": 800 } }
```

**يمرّ بحارس النصوص** (`guardText`) كما يمرّ به `handleMerchantSettings`، **والشعارُ بـ`SaveFromURL` بنوع `merchant_logo`**. والوصفُ والهاتفُ اليوم بيد الإدارة وحدَها (`/admin/merchants/{id}`) — **يُفتحان للرمز** لأنّ مصدرَهما صاحبُ المحلّ نفسُه.

### ١٤ · بصمةُ مصدر الصورة

```sql
ALTER TABLE media ADD COLUMN source_sha256 text;
ALTER TABLE media ADD COLUMN source_url    text;
CREATE INDEX media_source_sha_idx ON media (created_by, source_sha256) WHERE source_sha256 IS NOT NULL;
```

**نفسُ البصمة ⇒ نفسُ الوسيط.** **وعند الاستبدال** يُفكّ ارتباطُ القديم ويُحذف ملفُّه إن لم يُشر إليه شيء — **فلا تتراكم صورٌ يتيمة على القرص.**

### ١٥ · غلافٌ ومعرضُ صور (اختياريّ، لاحقاً)

`merchants.cover_media_id` بنوعٍ جديد `merchant_cover`، وجدولُ `menu_item_images (item_id, media_id, sort_order)`. **وإلى أن يُضافا** يرسل Serva الشعارَ والصورةَ الرئيسيّة فقط.

---

### ١٦ · التوقيعُ واختباراتُ العقد

**لماذا:** لا يُزوَّر طلبٌ أو تسوية، ولا يكسر تحديثٌ في طرفٍ الطرفَ الآخر بصمت.

- **توقيع Ed25519 بدل السرّ المشترك:** المرسلُ يوقّع بمفتاحه الخاص، والمستقبلُ يتحقق بالمفتاح العام المسجَّل للربط. فاختراقُ طرفٍ واحد لا يكفي لتزوير رسائل الآخر. وهذا يسري في الاتجاهين: إشعاراتُ رحّال إلى Serva، وإشعاراتُ Serva إلى رحّال إن وُجدت.
- **التوقيع على البايتات الخام** للرسالة كما وصلت، لا على JSON مُعاد ترتيبه، مع ختمٍ زمني يُرفض إن ابتعد أكثر من ٥ دقائق.
- **معرّف مفتاح `kid`** في الترويسة، ليُدوَّر المفتاح بلا توقّف. يبقى المفتاحُ القديم مقبولاً أسبوعاً بعد التدوير.
- **جدول أحداث فريد قبل المعالجة في الطرفين** (المصدر + رقم الحدث): الإشعارُ المكرّر لا يكرّر شيئاً.
- **المتجرُ يُعرف من الربط الذي تحقق توقيعُه**، لا من رقمٍ داخل الرسالة. ومبلغُ الطلب وعملتُه يُطابقان قبل أي قيد.
- **فشلُ التوقيع تنبيهٌ أمني** في الطرفين، لا مجرّد خطأ في السجل.
- **مواصفة OpenAPI واحدة للربط** تُحفظ في المستودعين، وتُختبر باختبارات عقد في CI رحّال وCI Serva. وتُرفق تسجيلاتُ رسائل موقّعة حقيقية للاختبار.

---

## ترتيبُ العمل المقترح — دفعاتٌ لا خطوةٌ واحدة

| الدفعة | التغييرات                | ما يصير ممكناً بعدها                                                         |
| ------ | ------------------------ | ---------------------------------------------------------------------------- |
| **أ**  | ١ · ٤ · ٢ (بلا صور) · ١١ | أصنافُ Serva وأسعارُها وتوفّرُها ودوامُها في رحّال، والأمينُ متوقّفٌ للمربوط |
| **ب**  | ٣ · ١٤ · ١٣              | **الصورُ والشعارُ وملفُّ المتجر بلا رفعٍ ثانٍ**                              |
| **ج**  | ٥                        | لا سعرَ في مكانين                                                            |
| **د**  | ٦ · ٧ · ٨ · ١٦           | الطلباتُ تصل كاشيرَ المحلّ ومطبخَه موقّعةً، والقبولُ و«جاهز» من Serva        |
| **هـ** | ٩ · ١٠ · ١٢              | انضمامٌ من Serva، وسائقُ رحّال لطلبات Serva، وسقفُ الكمّيّة                  |
| **و**  | ١٥                       | غلافٌ ومعرض — إن قرّر صاحبُ رحّال                                            |

**وكلُّ دفعةٍ تُجرَّب على بيئة التجهيز في الطرفين** قبل الإنتاج، **ومتجرٌ واحدٌ حقيقيٌّ في الرقة** (مطعمٌ وبقالة) قبل التعميم.

## فحوصُ القبول الجامعة

1. ربطُ متجرٍ بموافقة صاحبه، وتقريرُ «جرّب» قبل أيّ كتابة.
2. تعديلُ سعرٍ في Serva يظهر في رحّال خلال ١٠ ثوانٍ في ٩٥٪ من المرّات.
3. صورةُ صنفٍ رُفعت في Serva تظهر في رحّال بمصغّرتها، **ولا تُجلب مرّةً ثانيةً** إن لم تتغيّر.
4. مخزونٌ يصل للصفر في Serva ⇒ «غير متوفّر» في رحّال.
5. طلبُ رحّال يظهر على كاشير Serva خلال ٣ ثوانٍ بلا بيانات الزبون، وورقةُ المطبخ تُطبع.
6. محاولةُ تعديل سعرٍ مقفولٍ من بوّابة المتجر ⇒ مرفوضة برسالة «يُعدَّل من Serva POS».
7. إلغاءُ الرمز من بوّابة المتجر ⇒ يتوقّف كلُّ شيءٍ فوراً، وتبقى الأصنافُ كما هي.
8. فكُّ الربط وإعادتُه ⇒ لا صنفَ مكرّر.
9. إشعارٌ بتوقيعٍ خاطئ أو ختمٍ زمنيٍّ قديم أو رقمِ حدثٍ مكرّر ⇒ مرفوضٌ أو مُتجاهَل، ولا يتكرّر قيد.
10. اختباراتُ العقد خضراء في CI الطرفين قبل كل نشر.
