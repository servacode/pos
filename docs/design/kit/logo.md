# شعار سيرفا — نسخ جاهزة (الهوية أ «زمرّدي»)

منسوخة حرفياً من `Identity-A.dc.html`. لا تُعِد رسم العلامة ولا تغيّر ألوانها. لتكبير أو تصغير غيّر `width` و`height` فقط (الـ `viewBox` ثابت 64)، وكبّر الكلمتين بالنسبة نفسها.

- **العلامة:** حرف S من قوسين متل لفّة الإيصال، على مربّع زاويته 16 من 64، ونقطة صغيرة.
- **القاعدة:** «Serva» لاتيني بوزن 700 وتباعد سالب خفيف، و«سيرفا» تحتها بالعربي بوزن 600 بلون brand-ink. لا نستعمل «Serva.» بنقطة خضراء (كانت للنموذج الأول فقط).
- **مساحة حرة** حول الشعار لا تقل عن ربع عرض العلامة. لا ظل، لا تدرّج، لا تدوير.
- الإيصال المطبوع: النص فقط «سيرفا · Serva» (أسود، دون العلامة).

## العلامة وحدها

فاتح (على canvas أو surface):

```html
<svg width="92" height="92" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا"><rect width="64" height="64" rx="16" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
```

داكن (على #0B1210 أو #131C18):

```html
<svg width="92" height="92" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا على الداكن"><rect width="64" height="64" rx="16" fill="#35BF8B"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#001C12" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#001C12"></circle></svg>
```

## الشعار الأفقي (العلامة + Serva + سيرفا)

فاتح، بالمقاس الكبير كما في الورقة:

```html
<div style="display: flex; align-items: center; gap: 20px">
<svg width="92" height="92" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا"><rect width="64" height="64" rx="16" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
<div style="display: flex; flex-direction: column">
<span lang="en" dir="ltr" style="font-size: 60px; line-height: 64px; font-weight: 700; letter-spacing: -1px; color: #192621">Serva</span>
<span style="font-size: 26px; line-height: 36px; font-weight: 600; color: #005D40">سيرفا</span>
</div>
</div>
```

داكن:

```html
<div style="display: flex; align-items: center; gap: 20px">
<svg width="92" height="92" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا على الداكن"><rect width="64" height="64" rx="16" fill="#35BF8B"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#001C12" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#001C12"></circle></svg>
<div style="display: flex; flex-direction: column">
<span lang="en" dir="ltr" style="font-size: 60px; line-height: 64px; font-weight: 700; letter-spacing: -1px; color: #EDF1EF">Serva</span>
<span style="font-size: 26px; line-height: 36px; font-weight: 600; color: #8EE3BB">سيرفا</span>
</div>
</div>
```

### صغير للرؤوس (القائمة الجانبية، شريط الكاشير، رأس الجوال)

نفس العلامة بمقاس 32، والكلمتان مصغّرتان بالنسبة:

```html
<div style="display: flex; align-items: center; gap: 10px">
<svg width="32" height="32" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا"><rect width="64" height="64" rx="16" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
<div style="display: flex; flex-direction: column; line-height: 1">
<span lang="en" dir="ltr" style="font-size: 20px; line-height: 22px; font-weight: 700; letter-spacing: -0.3px; color: #192621">Serva</span>
<span style="font-size: 12px; line-height: 16px; font-weight: 600; color: #005D40">سيرفا</span>
</div>
</div>
```

## الشعار العمودي (شاشة الافتتاح، الدخول، صفحات الخطأ)

العلامة فوق الكلمتين، في الوسط:

```html
<div style="display: flex; flex-direction: column; align-items: center; gap: 16px">
<svg width="96" height="96" viewBox="0 0 64 64" role="img" aria-label="علامة سيرفا"><rect width="64" height="64" rx="16" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
<div style="display: flex; flex-direction: column; align-items: center">
<span lang="en" dir="ltr" style="font-size: 44px; line-height: 48px; font-weight: 700; letter-spacing: -0.8px; color: #192621">Serva</span>
<span style="font-size: 20px; line-height: 30px; font-weight: 600; color: #005D40">سيرفا</span>
</div>
</div>
```

على الداكن: بدّل العلامة بنسخة الداكن، و«Serva» إلى #EDF1EF، و«سيرفا» إلى #8EE3BB.

## أيقونة التطبيق

زاويتها 15 من 64. الكبير والمتوسط بالنقطة؛ الصغير (48 فما دون) بخط أعرض ودون نقطة.

كبير 1024 (يُعرض هنا 112):

```html
<svg width="112" height="112" viewBox="0 0 64 64" role="img" aria-label="أيقونة التطبيق كبيرة"><rect width="64" height="64" rx="15" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
```

متوسط 192:

```html
<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="أيقونة التطبيق متوسطة"><rect width="64" height="64" rx="15" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="7" stroke-linecap="round"></path><circle cx="46" cy="46" r="3.5" fill="#DEF9EC"></circle></svg>
```

صغير 48:

```html
<svg width="36" height="36" viewBox="0 0 64 64" role="img" aria-label="أيقونة التطبيق صغيرة"><rect width="64" height="64" rx="15" fill="#008157"></rect><path d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42" fill="none" stroke="#F6FEFA" stroke-width="8" stroke-linecap="round"></path></svg>
```

## على الإيصال

```html
<span style="text-align: center; font-weight: 700">سيرفا · <span lang="en" dir="ltr">Serva</span></span>
```
