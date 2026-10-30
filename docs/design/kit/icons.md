# أيقونات سيرفا — نسخة التصميم

108 أيقونة خطية بيد واحدة: إطار 24×24، سُمك 1.75، رؤوس مستديرة، لون `currentColor` (تأخذ لون النص بجانبها). أشكالها على نمط Lucide (المكتبة المعتمدة في الكود، تبويب 14) فتتطابق مع الأسماء هناك عند البناء.

**المقاسات (تبويب 14):** غيّر `width`/`height` فقط، والسُمك حسب المقاس:
- 16 داخل النص والجداول والشارات: `stroke-width="2"`
- 20 الأزرار والقوائم والحقول (الافتراضي هنا): `1.75`
- 24 القائمة الجانبية وأزرار الكاشير: `1.75`
- 32 بطاقات الأنشطة في معالج البداية، و48 الحالات الفارغة وصفحات الخطأ: `1.5`

**القواعد:** الأيقونة دائماً مع كلمة، إلا البحث والإغلاق والحذف والمزيد (ومعها `aria-label` على الزر). الألوان للحالات فقط (نجاح/تنبيه/خطر) عبر لون النص. **في RTL تُعكس الأيقونات الاتجاهية:** `arrow-back` يشير لليمين و`arrow-forward` لليسار جاهزان معكوسين؛ و`return` و`logout` وأي سهم آخر يُعكس بـ `style="transform: scaleX(-1)"`. لا تُعكس: الصح، الساعة، الباركود، QR، الأرقام.

## التنقّل

### `home` — الرئيسية

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"></path></svg>
```

### `inbox` — بانتظارك

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h5l2 3h4l2-3h5"></path><path d="M5.5 5h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z"></path></svg>
```

### `sales` — المبيعات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5z"></path><path d="M9 7a3 3 0 0 1 6 0"></path></svg>
```

### `cart` — السلة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5"></circle><circle cx="18" cy="20" r="1.5"></circle><path d="M2.5 3H5l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6"></path></svg>
```

### `products` — المنتجات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"></path><path d="M3 7.5 12 12l9-4.5"></path><path d="M12 12v9"></path></svg>
```

### `inventory` — المخزون والجرد

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4V3h6v1"></path><path d="M9 10h6M9 14h6M9 18h3"></path></svg>
```

### `warehouse` — المستودع

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V9l9-5 9 5v12"></path><path d="M7 21v-8h10v8"></path><path d="M7 17h10"></path></svg>
```

### `customers` — الزبائن

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"></path><path d="M16 4.5a3.5 3.5 0 0 1 0 7"></path><path d="M18 14.8c1.9.7 3.1 2.4 3.5 5.2"></path></svg>
```

### `suppliers` — الموردون

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V10l5 3v-3l5 3V6h8v15z"></path><path d="M7 17h2M12 17h2M17 17h1"></path></svg>
```

### `purchases` — المشتريات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h18l-1.8 10.2a2 2 0 0 1-2 1.8H6.8a2 2 0 0 1-2-1.8z"></path><path d="M8 9l3-6M16 9l-3-6"></path><path d="M9 13v4M15 13v4"></path></svg>
```

### `reports` — التقارير

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 17v-3M12 17v-6M16 17v-2"></path></svg>
```

### `accounts` — المحاسبة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path><path d="M9 7h7M9 11h5"></path></svg>
```

### `finance` — المالية (الصناديق)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18"></path><path d="M16 15h2"></path></svg>
```

### `settings` — الإعدادات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>
```

### `user` — مستخدم

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"></path></svg>
```

### `staff` — الموظفون

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"></rect><circle cx="12" cy="10" r="3"></circle><path d="M8 17c.8-1.8 2.2-2.6 4-2.6s3.2.8 4 2.6"></path></svg>
```

### `branches` — الفروع

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"></circle><circle cx="18" cy="5" r="2"></circle><circle cx="12" cy="19" r="2"></circle><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7"></path><path d="M12 12v5"></path></svg>
```

### `store` — المحل

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v10h16V10"></path><path d="M3 6l2-3h14l2 3v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"></path><path d="M10 20v-5h4v5"></path></svg>
```

### `globe` — المتجر الإلكتروني

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18"></path><path d="M12 3a14 14 0 0 0 0 18"></path></svg>
```

### `building` — المنصة / شركة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1"></rect><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"></path><path d="M10 21v-3h4v3"></path></svg>
```

## الأجهزة والتواصل

### `devices` — الأجهزة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="14" height="10" rx="1.5"></rect><path d="M6 18h6M9 14v4"></path><rect x="17" y="9" width="5" height="11" rx="1.2"></rect></svg>
```

### `smartphone` — جوال

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"></rect><path d="M11 18h2"></path></svg>
```

### `printer` — الطابعة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"></path><rect x="3" y="9" width="18" height="8" rx="2"></rect><path d="M7 14h10v7H7z"></path></svg>
```

### `scale` — الميزان

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16"></path><path d="M12 8v5"></path><rect x="3" y="13" width="18" height="8" rx="2"></rect><path d="M9 17h6"></path></svg>
```

### `barcode` — باركود

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5v14"></path><path d="M7 5v14"></path><path d="M10 5v14"></path><path d="M14 5v14"></path><path d="M17 5v14"></path><path d="M21 5v14"></path></svg>
```

### `scan` — مسح

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path></svg>
```

### `qr` — رمز QR

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3z"></path><path d="M20 14v.01"></path><path d="M14 20h.01"></path><path d="M17 20h4v-3"></path></svg>
```

### `chat` — محادثة (واتساب وغيره، دون شعار)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5A8.5 8.5 0 1 1 21 12z"></path></svg>
```

### `sms` — رسالة SMS

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M8 8h8M8 12h5"></path></svg>
```

### `phone` — اتصال

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"></path></svg>
```

### `send` — أرسل

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10 14"></path><path d="M21 3l-7 18-4-7-7-4z"></path></svg>
```

### `bell` — التنبيهات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"></path></svg>
```

### `wifi` — متصل

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h.01"></path><path d="M8.5 16.5a5 5 0 0 1 7 0"></path><path d="M5 12.9a10 10 0 0 1 14 0"></path><path d="M2 8.8a15 15 0 0 1 20 0"></path></svg>
```

### `wifi-off` — دون إنترنت

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20"></path><path d="M12 20h.01"></path><path d="M8.5 16.5a5 5 0 0 1 7 0"></path><path d="M5 12.9a10 10 0 0 1 5.2-2.7"></path><path d="M19 12.9a10 10 0 0 0-2.3-1.6"></path><path d="M2 8.8a15 15 0 0 1 4.2-2.7"></path><path d="M22 8.8A15 15 0 0 0 10.7 5"></path></svg>
```

### `cloud` — السحابة / النسخ الاحتياطي

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H8a5 5 0 1 1 1.2-9.9A6 6 0 0 1 20.5 11a4 4 0 0 1-3 8z"></path></svg>
```

### `sync` — بانتظار الإرسال / تحديث

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"></path><path d="M4 3v5h5"></path><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"></path><path d="M20 21v-5h-5"></path></svg>
```

## المال

### `cash` — نقداً

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
```

### `card` — بطاقة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path><path d="M6 15h4"></path></svg>
```

### `wallet` — محفظة (شام كاش…)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"></path><path d="M3 6v12a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3"></path></svg>
```

### `dollar` — دولار

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"></path><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
```

### `exchange` — تصريف / سعر الصرف

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4"></path><path d="M4 7h16"></path><path d="M16 21l4-4-4-4"></path><path d="M20 17H4"></path></svg>
```

### `receipt` — إيصال

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"></path><path d="M9 8h6M9 12h6M9 16h3"></path></svg>
```

### `invoice` — فاتورة / مستند

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h5"></path></svg>
```

### `return` — مرتجع (يُعكس في RTL)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path></svg>
```

### `discount` — خصم

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 5 5 19"></path><circle cx="6.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle></svg>
```

### `tag` — سعر / عرض

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"></path><circle cx="7.5" cy="7.5" r="1.5"></circle></svg>
```

### `gift` — هدية / ولاء

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"></rect><path d="M12 8v13"></path><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"></path><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"></path></svg>
```

### `star` — نقاط / مميّز

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"></path></svg>
```

### `pause` — علّق الفاتورة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>
```

## الأفعال

### `search` — بحث

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
```

### `filter` — تصفية

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"></path></svg>
```

### `plus` — أضف

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
```

### `minus` — أنقص

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path></svg>
```

### `edit` — عدّل

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"></path><path d="M14.5 5.5l3 3"></path></svg>
```

### `trash` — احذف

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"></path><path d="M9 7V4h6v3"></path></svg>
```

### `check` — تم

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
```

### `x` — أغلق

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
```

### `chevron-down` — افتح

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
```

### `chevron-up` — اطوِ

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"></path></svg>
```

### `chevron-left` — التالي في RTL

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
```

### `chevron-right` — السابق في RTL

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
```

### `arrow-back` — رجوع في RTL (يشير لليمين)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>
```

### `arrow-forward` — متابعة في RTL (يشير لليسار)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="M11 6l-6 6 6 6"></path></svg>
```

### `more` — المزيد

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1" fill="currentColor"></circle><circle cx="12" cy="12" r="1" fill="currentColor"></circle><circle cx="19" cy="12" r="1" fill="currentColor"></circle></svg>
```

### `download` — تنزيل / تصدير

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"></path><path d="M7 10l5 5 5-5"></path><path d="M4 20h16"></path></svg>
```

### `upload` — رفع / استيراد

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 20h16"></path></svg>
```

### `copy` — انسخ

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></svg>
```

### `link` — رابط

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>
```

### `eye` — اعرض

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>
```

### `lock` — مقفول

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
```

### `key` — رمز الدخول

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"></circle><path d="M10.7 12.3 20 3"></path><path d="M16 7l3 3"></path><path d="M14 9l2 2"></path></svg>
```

### `shield` — أمان / موافقة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"></path><path d="M9 12l2 2 4-4"></path></svg>
```

### `logout` — خروج (يُعكس في RTL)

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>
```

### `clock` — الوقت / وردية

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
```

### `calendar` — التاريخ

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>
```

### `camera` — كاميرا

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
```

### `image` — صورة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="M21 15l-5-5L5 21"></path></svg>
```

### `sun` — الوضع الفاتح

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
```

### `moon` — الوضع الداكن

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path></svg>
```

## الأماكن والناس والقطاعات

### `truck` — توصيل / مندوب

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3z"></path><path d="M14 9h4l3 3v4h-7"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle></svg>
```

### `map-pin` — الموقع

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>
```

### `kitchen` — المطبخ

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11h18"></path><path d="M5 11v7a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-7"></path><path d="M9 7c0-1 1-1.5 1-2.5M14 7c0-1 1-1.5 1-2.5"></path><path d="M2 11h2M20 11h2"></path></svg>
```

### `table` — طاولة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h18"></path><path d="M6 9v11M18 9v11"></path><path d="M5 14h14"></path></svg>
```

### `chef-hat` — الطاهي

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h10"></path><path d="M7 17h10v4H7z"></path><path d="M7 17v-4a4 4 0 0 1-.4-7.9A5 5 0 0 1 12 3a5 5 0 0 1 5.4 2.1A4 4 0 0 1 17 13v4"></path></svg>
```

### `coffee` — مقهى

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"></path><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"></path><path d="M8 2v3M12 2v3"></path></svg>
```

### `utensils` — مطعم

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v7a2 2 0 0 0 4 0V3"></path><path d="M7 12v9"></path><path d="M17 3c-1.7 0-3 2-3 5v5h3v8"></path></svg>
```

### `shirt` — ألبسة وأحذية

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3L3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"></path></svg>
```

### `basket` — سوبرماركت

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h18l-1.8 10.2a2 2 0 0 1-2 1.8H6.8a2 2 0 0 1-2-1.8z"></path><path d="M8 9l3-6M16 9l-3-6"></path></svg>
```

### `pill` — صيدلية

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7z"></path><path d="M8.5 8.5l7 7"></path></svg>
```

### `bakery` — مخبز وحلويات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11a4 4 0 0 1-1-7.9C6 2.5 9 2 12 2s6 .5 8 1.1A4 4 0 0 1 19 11v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"></path><path d="M9 11v5M15 11v5"></path></svg>
```

### `hammer` — مواد بناء وأدوات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"></path><path d="M17.6 15 22 10.6 13.4 2l-1.9 1.9 2.2 2.2-2.2 2.2z"></path></svg>
```

### `sparkles` — تجميل وعطور

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"></path><path d="M19 15v4M17 17h4"></path><path d="M5 17v3M3.5 18.5h3"></path></svg>
```

### `carrot` — خضار وفواكه

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.3 21.7s9.9-3.5 12.7-6.4a4.5 4.5 0 0 0-6.4-6.4C5.8 11.8 2.3 21.7 2.3 21.7z"></path><path d="M8.6 14l-2-2"></path><path d="M15.3 15l-2.4-2.4"></path><path d="M22 9s-1.3-2-3.5-2C16.9 7 15 9 15 9s1.3 2 3.5 2S22 9 22 9z"></path><path d="M15 2s-2 1.3-2 3.5S15 9 15 9s2-1.8 2-3.5C17 3.3 15 2 15 2z"></path></svg>
```

### `user-plus` — أضف زبوناً / مستخدماً

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2.5 21c.9-3.7 3.5-6 6.5-6s4.8 1.2 5.8 3"></path><path d="M19 14v6M16 17h6"></path></svg>
```

### `agent` — وكيل / شريك معتمد

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.6 1.9 3.2-.1.9 3.1 2.6 1.9-1 3 1 3-2.6 1.9-.9 3.1-3.2-.1L12 21.5l-2.6-1.9-3.2.1-.9-3.1-2.6-1.9 1-3-1-3 2.6-1.9.9-3.1 3.2.1z"></path><path d="M9 12l2 2 4-4"></path></svg>
```

### `box` — أرشيف / تغليف

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"></rect><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"></path><path d="M10 13h4"></path></svg>
```

### `layers` — الأقسام / الطبقات

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"></path><path d="M3 13l9 5 9-5"></path></svg>
```

## الحالة والبيانات

### `chart-bar` — أعمدة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"></path><path d="M6 21v-6M11 21V9M16 21v-9M20 21V5"></path></svg>
```

### `chart-line` — خطي

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"></path><path d="M7 15l4-4 3 3 6-6"></path></svg>
```

### `pie` — نِسب

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12A9 9 0 1 1 12 3v9z"></path><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"></path></svg>
```

### `alert` — تنبيه

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path></svg>
```

### `info` — معلومة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 16v-5M12 8h.01"></path></svg>
```

### `help` — مساعدة

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"></path></svg>
```

### `check-circle` — نجاح

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.7 2.7L16 10"></path></svg>
```

### `x-circle` — فشل / رُفض

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6"></path></svg>
```

### `hourglass` — بانتظار الدفع

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12"></path><path d="M7 3c0 5 5 6 5 9s-5 4-5 9"></path><path d="M17 3c0 5-5 6-5 9s5 4 5 9"></path></svg>
```

### `trend-up` — ارتفاع

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"></path><path d="M15 7h6v6"></path></svg>
```

### `trend-down` — انخفاض

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l6 6 4-4 8 8"></path><path d="M15 17h6v-6"></path></svg>
```
