# Serva UI kit — how every designer fork builds a screen

Identity **A «زمرّدي»**, which the owner chose. Every artboard is built from these files only, so all ~150 screens look made by one hand.

| File | What it is |
|---|---|
| `serva-ui.css` | Core (~15 KB): tokens, base, type, layout, admin and phone shells, every common component. Always paste it. |
| `addon-cashier.css` | Cashier shell, item grid, cart, total and pay button, keypad. |
| `addon-restaurant.css` | Kitchen ticket, floor-map table, kitchen/call/price type sizes, tablet shell. |
| `addon-print.css` | 80/58 mm receipt, 50×30 label, A4 page. |
| `addon-charts.css` | Bars, line/area SVG classes, heatmap cells, legend dot. |
| `addon-dark.css` | Dark tokens. Add class `dark` to the `.sv` root. |
| `icons.md` | 108 stroke icons, ready `<svg>` snippets. |
| `logo.md` | Exact logo, lockups and app icon. |
| `TEMPLATE.dc.html` | The artboard skeleton, with the four shells in a comment. |

## Build steps for one artboard

1. Copy `TEMPLATE.dc.html` to `project/<page>/<Name>.dc.html`.
2. Set `<title>` to the Arabic screen name.
3. Paste `serva-ui.css` **verbatim** in place of `/*KIT*/`.
4. Put the addons you need in place of `/*ADDON*/`, or delete the marker.
5. Replace the root div with one shell. Keep `class="sv"` and `dir="rtl"` on the root.
6. Set `$preview` to the frame size, and use the same size for the board's `w`/`h` in `canvas.json`.
7. Delete the comment block in the script.

Use kit classes for everything. Use inline `style` only for layout specifics (widths, a grid, one-off spacing). For colour inside inline styles use tokens: `var(--brand)`, `var(--ink-muted)`. Never write a raw hex, except on paper (receipt, A4), which is always black on white.

## Frames

| Surface | Frame (w×h) | Shell | Density |
|---|---|---|---|
| Cashier (Windows/Android POS) | 1280×800 | `.shell-cashier` + addon-cashier | Touch: controls 56, pay button 72, keys 64, item tile ≥112×104 |
| Store admin web | 1440 wide × content height (900–1800), fixed width, not `expand` | `.shell-admin` | Comfortable 48 |
| Platform panel | 1440 × content | `.shell-admin` (platform nav) | Compact 40: `.btn-sm`, `.table.compact` |
| Accountant portal | 1440 × content | `.shell-admin` (portal nav) | Dense 32: `.table.dense`, show `.kbd` shortcuts |
| Agent panel | 1440 × content, or phone | `.shell-admin` / `.shell-phone` | Comfortable |
| Owner phone, rep, customer pages | 390×844 | `.shell-phone` | Touch / comfortable |
| Waiter iPad, kitchen screen, tablet cashier | 1180×820 | `.shell-tablet` + addon-restaurant | Touch; kitchen items `.t-kitchen` |
| Receipt 80 mm | 302 wide × length | `.receipt` (58 mm: `.receipt.w58`, 219 wide) | — |
| Shelf/scale label | 189×113 (50×30 mm) | `.label-50x30` | — |
| A4 invoice/report | 794×1123 | `.a4` | — |

For paper frames, put the paper on a `.sv` root with padding 24 so the shadow shows.

## Class cheat-sheet

- **Text:**
  - Type: `t-display` (change after paying), `t-total` (cashier total), `t-kpi`, `t-h1` (page title), `t-h2` (section), `t-h3` (card title), `t-body`, `t-sm` (admin tables), `t-caption` (12, hints only), `t-label`.
  - Colour and weight: `muted`, `subtle`, `brand-ink`, `danger-ink`, `warning-ink`, `b6`, `b7`.
  - Numbers: **every amount, quantity, document number, phone and percent** wraps in `<span class="num">`; Latin words use `class="ltr"`.
- **Layout:** `row` (flex, centered, gap 8), `col`, `g4`…`g32`, `grow`, `between`, `wrap`, `top`, `grid2`/`grid3`/`grid4`, `hr`.
- **Admin:** `adm-side`, `nav-group`, `nav-item` (+`is-on`), `count`, `adm-top`, `adm-content`, `page-head`, `crumbs`, `tabs`/`tab`, `pager`.
- **Phone:** `ph-top`, `ph-content`, `ph-tabs`/`ph-tab` (5 items: الرئيسية · بانتظارك · المبيعات · المنتجات · المزيد), `ph-action` (bottom primary button), `sheet-bottom` + `grabber`.
- **Buttons:** `btn` + `btn-primary` | `btn-secondary` | `btn-ghost` | `btn-danger` | `btn-danger-soft`; sizes `btn-sm` (40, mouse-only screens), default 48, `btn-lg` 56, `btn-pay` 72; plus `btn-block`, `btn-icon`.
  - One primary button per view.
  - The button names the action («احذف المنتج», never «نعم»).
- **Forms:**
  - `field` > `label.label` + `input.input` (`is-focus`, `is-error`, `input-touch`) + `hint` / `err`.
  - Also `select`, `textarea`; `affix` for an icon or unit inside an input; `seg` (+`is-on`), `toggle` (+`is-on`), `choice` with a native checkbox/radio, `chip` (+`is-on`), `qty`, `kbd`.
- **Status:**
  - `badge` + `b-success` (مدفوعة، أُرسلت، نشط), `b-pending` / `b-warning` (بانتظار الدفع، بانتظار الإرسال، قارب على النفاد), `b-danger` (دين متأخر، ملغاة، موقوف), `b-info`, `b-neutral` (آجلة، مسودة).
  - `conn` / `conn.off` for the connection pill.
  - `banner.warn|danger|info|ok|neutral`: admin only, never on the sale screen.
- **Content:** `card` (`card-lg`, `card-head`, `is-click`, `is-sel`), `kpi` > `kpi-label` + `kpi-value` + `trend.up|down`, `li` (list row), `avatar`, `ico-tile`, `empty` > `empty-art`, `skel`.
- **Tables:** `table-box` > `table.table` (`compact`, `dense`).
  - Numeric cells `td.n`: aligned to the column end, which is the left in Arabic.
  - Totals row: `tr.total` on surface-total.
  - Row actions: `row-actions`.
  - On phone, tables become cards (`card` / `li`).
- **Overlays:** `scrim` > `dialog` (+`dialog-actions`).
  - `sheet` is a side panel that enters from the LEFT in RTL; the cashier's payment panel is a sheet.
  - `sheet-bottom` is for phone.
  - `toast`.
  - Overlays are `position:absolute` inside the root, which is `position:relative` already.
- **Cashier (addon):** `cash-status`, `cash-body`, `cash-cart` (first in markup, so on the right), `cash-items`, `item-grid` > `button.item` (`nm`, `pr`, `is-sel`, `is-out`), `cart-line` (`is-sel`, `.meta`), `cart-total`, `keypad` > `key` (fixed LTR: 7 8 9 on top).
- **Restaurant (addon):** `ticket` (`warn` / `late` by age), `tbl` (`busy` / `bill` / `call`), `t-kitchen`, `t-call`, `t-price`.
- **Charts (addon):** `bars` > `bar` (`soft`, `alt`) with `axis`, SVG `ln` / `ln2` / `area` / `gridln`, heat `h1c`…`h5c`, legend `dot` with an inline `background:var(--c2)`.
  - **Time runs right → left** (oldest on the right).
  - Pie only for shares.

## RTL rules

- The root has `dir="rtl"`. Use logical properties (`inset-inline-start`, `padding-inline`, `border-inline-end`), never left/right, unless the position is intrinsically physical.
- The start side is the right: the sidebar is on the right, the cart on the right, and the side sheet slides in from the left.
- Mirror directional icons (`arrow-back` points right, `arrow-forward` left; `return`/`logout` use `transform: scaleX(-1)`). Never mirror check, clock, barcode, QR or digits.
- Keypads and PIN pads stay LTR (`.keypad` already does).
- Amounts are always in `.num` so «1,250 ل.س», `+963 944 123 456`, `INV-001-002-0000154` and «Nescafé Gold 200g × 3» never scramble inside Arabic sentences.

## Money, numbers, dates

- **Currency:** new Syrian pound «ل.س», number then symbol, no decimals: «1,250 ل.س».
- **Dollar:** two decimals, number then symbol: «12.50 $». The rate is about **130 ل.س = 1 $**; show it when tapped («سعر الصرف 130»).
- **Dual amount:** on the cashier and receipts the base amount is large, with the $ under it, small.
- **Digits:** Latin by default (Hindi digits are a shop setting: mention it, don't use it).
- **Balances:** «له 5,000 ل.س» or «عليه 5,000 ل.س», never a minus sign. In reports, negatives use «−» in danger colour.
- **Percent:** «12%».
- **Dates:** Levantine month names and 12-hour time: «30 تشرين الأول 2026، 4:30 م». Relative time: «قبل 5 دقائق».
- **Document numbers:**

  | Document | Example |
  |---|---|
  | Sales invoice | INV-001-002-0000154 |
  | Receipt voucher | RCV-001-002-0000012 |
  | Purchase | PUR-001-0000042 |
  | Online order | ONL-001-0000123 |
  | Return | RET-001-002-0000007 |

## Sample data (Raqqa first; reuse across screens so the product feels like one shop's day)

- **Shops:**

  | Mode | Shop | Place |
  |---|---|---|
  | Café | مقهى الياسمين | الرقة · شارع تل أبيض |
  | Grocery/general | بقالية أبو خليل | الرقة · حي الرميلة |
  | Supermarket | سوبرماركت الفرات | الرقة · دوار النعيم |
  | Clothing | ألبسة ريم | الرقة · شارع 23 شباط |
  | Pharmacy | صيدلية الشفاء | الرقة |
  | Phones | موبايلات النور | الرقة · السوق المركزي |
  | Restaurant | مطعم البيت الشامي | دمشق · باب توما |
  | Bakery | مخبز السنابل | الطبقة |
  | Building materials | مواد بناء الحسن | الطبقة |

- **Cities:** الرقة، الطبقة، دمشق، حلب، حمص، دير الزور، الحسكة.
- **People:**
  - Owner: خالد العلي.
  - Cashier: سامر.
  - Clothing seller: ريم.
  - Sales rep: حسن الجاسم.
  - Accountant: أ. محمود السالم.
  - Agent: مكتب الفرات للأنظمة.
  - Customers: أبو أحمد الخلف (عليه 48,500 ل.س), أم محمد, فاطمة الجاسم, عبد الله الموسى, محمد الحسين.
- **Phones:** 0944 123 456 / +963 944 123 456.
- **Café:**
  - اسبريسو 90، لاتيه وسط 120، كابتشينو 115، شاي 40، قهوة تركية 60، موكا 135، ليمون ونعنع 85، كيكة شوكولا 110، كرواسون 70، أركيلة تفاحتين 350.
  - Sugar options: بلا / قليل / وسط / زيادة.
- **Grocery:**
  - Prices: ربطة خبز 40، حليب 1 لتر 150، سكر 1 كغ 120، رز 1 كغ 150، زيت دوار الشمس 1 لتر 250، شاي 400 غ 350، Nescafé Gold 200g 1,950، لبنة 1 كغ 280، بيض 30 حبة 420.
  - Weighed line: «1.250 كغ × 300».
- **Clothing:**
  - قميص رجالي 1,200، بنطال جينز 1,850، فستان 2,400.
  - Sizes S–XXL; colours أبيض، أسود، كحلي، زيتي.
- **Phones:** Samsung Galaxy A15 = 18,200 ل.س (140 $). IMEI in `.num`.
- **Day totals (owner):**
  - Today's sales 1,284,500 ل.س (9,880.77 $), 214 invoices, +12% vs last Thursday.
  - Expected cash 642,000 ل.س.
  - Provisional profit «مؤقت» 238,000 ل.س.
- **Platform:** 1,240 shops, 37 agents.

## Words (tab 14 glossary — banned words fail the check)

| Say | Never |
|---|---|
| زبون، الزبائن | عميل |
| منتج | عنصر، SKU |
| فاتورة (document), إيصال (printed paper) | — |
| دين، بيع بالآجل، له / عليه | ذمم مدينة |
| وردية | جلسة |
| بانتظار الإرسال، أُرسل، كل شيء أُرسل | مزامنة، Sync |
| دون إنترنت | Offline |
| رمز الدخول، رمز المدير | PIN |
| كلمة السر | كلمة المرور |
| انتهى دخولك | — |
| سند دفع | سند صرف |
| الاهتلاك | الإهلاك |
| الصندوق (1110), الزبائن (1200) | — |

- **Tone:** simple fusha close to market language, direct imperatives («احفظ»، «اطبع»، «أضف زبوناً»). Light Shami only on the customer menu/store and welcome messages («بدي الحساب»).
- **Errors:** two sentences, what happened then what to do. Example: «لا يوجد إنترنت الآن. الفاتورة محفوظة على الجهاز وستُرسل وحدها عند عودة الاتصال.»
- **Empty states:** one sentence, one primary action and an optional secondary one. Example: «لا زبائن بعد. أضف أول زبون، أو استوردهم من ملف.»
- **Connection text:** «دون إنترنت منذ 2:05 م · البيع مستمر · 12 بانتظار الإرسال».

## Quality bar

- Text contrast is ≥4.5:1. The kit's tokens already pass, so don't invent colours. Use `--ink-subtle` only on canvas, surface or surface-muted.
- **Real controls:**
  - `<button type="button">`, `<input>` with a `<label for>` (unique ids per artboard), `<select>`, `<a href>`.
  - Icon-only buttons get an `aria-label`.
  - Decorative SVG gets `aria-hidden="true"`.
- Touch targets ≥44 px; ≥48 on touch surfaces.
- No emoji, no lorem ipsum, no fake phone status bars (time, battery, signal), no gradient washes, no left-border cards, no stock photos. Images are typographic tiles (`ico-tile`, or an initial letter on brand-soft).
- **Each screen shows its real state:** realistic data, one selected or hover example, and the key badge. Where tab 12 lists states (empty, offline, error), show them as small extra frames, or as a second artboard if the inventory asks.
- Never put rationale text inside an artboard.

## Canvas format gotchas (each fails silently)

- Keep `<script src="./support.js"></script>` in `<head>` exactly.
- Close every element and quote every attribute; void elements are fine as `<input …>`.
- `{{hole}}` is a dotted lookup into `renderVals()`, never an expression. Compute values in JS.
- Events use `onClick="{{handler}}"`, with the handler returned from `renderVals`. Per-item handlers are built in `renderVals` (`items.map(x => ({...x, pick: () => this.setState({sel: x.id})}))`).
- `<sc-for list="{{items}}" as="it" hint-placeholder-count="3">` and `<sc-if value="{{flag}}" hint-placeholder-val="{{ true }}">` always carry their hint attributes.
- **Don't build UI in script:**
  - no `innerHTML`, `appendChild` or `window.X`;
  - no global keydown handlers;
  - no `<iframe>`;
  - no network except the Google Fonts `<link>`.
- No `data:` URIs anywhere, CSS included.
- `data-props` is single-quoted JSON. Escape `&` as `&amp;` and `'` as `&#39;`. Always include `$preview`.
- One flow that needs shared state stays in ONE artboard (`sc-if` per step). Static screens just return `{}` from `renderVals`.
- Most screens are static comps. Set `is_interactive: true` in canvas.json only when the handlers really work.
