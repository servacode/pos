# Step 4 contract: the catalog and the sale documents

Phase 1, step 2. This is the shared contract that the server, the admin screens and the cashier screens are built from. The code is the reference, and this page is the map. Spec tabs are cited as `NN › section`.

## At a glance

| What                                                                                                                                                                          | Where                                                                          | Used by                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| Admin product, category, unit and tax-rate routes (zod inputs, response types, route list in the header comment)                                                              | `packages/core/src/contracts/catalog.ts`                                       | server, admin                         |
| Rows of every pull set a cashier device stores (`ProductRow` … `ExchangeRateRow`, plus the existing `settings`, `users`, `roles`, `user_roles`, `branches`), in `PullSetRows` | same file                                                                      | server (`PULL_SETS`), cashier         |
| Payload schemas of `sale`, `shift_open`, `shift_close`, `cash_movement`, and `validateDocumentPayload(type, payload)`                                                         | `packages/core/src/contracts/documents.ts`                                     | cashier, server                       |
| `priceSale`, `settleSale`, `buildSalePayload`, `verifySalePayload`, `packPrice`, `discountOverLimit`, `businessDateOf`, `rateFor`                                             | `packages/core/src/sale.ts` (`@serva/core/sale`)                               | cashier, server                       |
| `PRICING_ENGINE_VERSION` (`'1.0.0'`): the document's `engineVersion`                                                                                                          | `packages/core/src/pricing.ts`                                                 | cashier, server                       |
| `documentPayloadRejection(doc)`: the push rejects a malformed payload alone with `invalid_payload`                                                                            | `packages/sync/src/protocol.ts`, wired in `apps/api/src/services/sync-push.ts` | server, cashier (check before saving) |
| `stale_version` error code (409)                                                                                                                                              | `packages/core/src/contracts/errors.ts`                                        | server, admin                         |

### Admin routes (17 › المنتجات)

`GET/POST /v1/products`, `GET/PATCH /v1/products/{id}`, `POST /v1/products/{id}/archive` and `/restore`, `GET /v1/barcodes/{code}`, and `GET/POST/PATCH` for `/v1/categories`, `/v1/units` and `/v1/tax-rates`. Each route's permission and its input and output types are listed in the header of `catalog.ts`.

- **Create:** one request makes the product with its variants, barcodes and prices.
- **PATCH:** changes only the fields sent. `variants` lists only the variants that change or are new. The list's in-place price edit sends `{ version, variants: [{ id, price }] }`. When `barcodes` is sent for a variant, it is that variant's complete list.

### Pull sets (17 › السحب)

`products`, `variants`, `prices`, `barcodes`, `categories`, `units`, `tax_rates`, `stock_levels` and `exchange_rates` are new. `settings` and `users` gain a few columns, listed below. Every row has `id` and `version`. An archived row stays in its set with `archived: true`. No set carries cost, purchase price or margin, and a type-level test checks this.

### Documents (17 › الإرسال; 15 › عقد المزامنة v1)

The envelope already carries `id`, `seq`, `type`, `number`, `deviceTime`, `businessDate`, `deviceOffsetMs`, `engineVersion`, `contractVersion` and `deps`. The branch and the device come from the device token. The payload carries everything else:

- **sale:** `shiftId`, `cashierId`, `salespersonId` and `customerId`/`customerName`, the invoice `currency`, `taxInclusive`, and the `exchangeRates` in force.
  - Lines carry `lineNo`, ids, the name snapshot, `unitName`, `barcode`, `packQty`/`qty`/`baseQty`, the catalog price in its own currency and the converted `unitPriceMinor`, `taxRateId`/`taxRateBp`, the discount with its source, reason and approval, and the line as the engine priced it.
  - The sale also carries `invoiceDiscount`, the engine's `totals`, `tipMinor`, and `payments`: method, currency, amount, the rate used, base amount, and the reference, card digits or provider.
  - It ends with `change`, `cashRounding` and `note`.
- **shift_open:** `openedBy`, `mode`, `handoverFromShiftId`, and the opening count per currency, with denominations or `null`. The shift's id is this document's id.
- **shift_close:** `shiftId`, `shiftNumber` (SFT), `closedBy` and `baseCurrency`.
  - Per drawer, it carries every term of the formula in 10 › مطابقة الصندوق, plus expected, counted, denominations, difference, and the difference in the base currency at the drawer's rate.
  - It also carries the shortage treatment and its approval, the Z summary by method, and `forced`.
- **cash_movement:** `shiftId`, `kind` (`pay_in`, `pay_out`, `expense`, `safe_drop`), currency, amount, rate and base amount, `reason`, `expenseAccountCode` (6101–6190, expenses only), `reference`, `performedBy` and `approval`.

Approvals are always `{ userId, method: 'pin' | 'remote', at, offline }`. The server flags `approval_offline` when `offline` is true.

### Posting (next step) reads, without any lookup

| Account                                                   | Read from                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 4100 sales                                                | Σ `priced.grossExTaxMinor`                                                    |
| 4200 discounts                                            | Σ `priced.discountExTaxMinor`                                                 |
| Tax                                                       | `priced.taxMinor` per `taxRateId`; the rate's `kind` picks 2200, 2210 or 2220 |
| 1110 cash, per drawer currency                            | cash payments − `change`                                                      |
| 1140, 1150, 1130 and 1200                                 | card, wallet, transfer and credit payments; 1200 is per `customerId`          |
| 6400 rounding                                             | `cashRounding.roundingBaseMinor`                                              |
| 2550 tips                                                 | `tipMinor`                                                                    |
| Cost                                                      | `baseQty` per `variantId`, computed by the server                             |
| Shift difference (6200, or 1250 with `shortageTreatment`) | `differenceBaseMinor`                                                         |
| Cash movements                                            | `kind`, `expenseAccountCode` and `baseAmountMinor`                            |

Every foreign amount carries its rate and its base equivalent.

## How a sale settles (`settleSale`)

```
due = totals.totalMinor + tipMinor                         (invoice currency)
non-cash (card, wallet, transfer, credit) pays exact amounts, never more than due, never change
cash in currencies other than S is applied in full
S = the change currency the cashier picks (the invoice currency by default)
exactS = what is left, converted to S;  dueS = roundCashDue(exactS, step of S)
change = cash tendered in S − dueS   (not covered while negative)
roundingBaseMinor = Σ payments − change − due   (by subtraction: the sale always balances)
```

- **Golden first sale (23):** the total is 1,290.00 ل.س. The customer pays 9 $ at 130, which is 1,170.00, so 120.00 is still due. He pays 200 ل.س and gets 80.00 back. This is a unit test, and so are the 80 mm receipt board's example, the worked examples of tab 10, and a sale whose change is given in dollars.
- **Property tests (fast-check):**
  - the totals equal `priceInvoice`, line by line;
  - payments − change = total + tip + rounding, and the payload passes the schema and `verifySalePayload`;
  - the cash due is a whole number of steps, at most half a step from exact;
  - the cash tendered in S, less the change, equals the cash due, for pounds and dollars.
- **Balance check:** the schema rejects a sale whose payments don't balance, because 17 lets the server refuse an internally unbalanced document. Every other difference from the engine goes through `verifySalePayload`: the server accepts the sale and flags it `totals_mismatch`.

## Decisions

1. **The document schemas live in `@serva/core/contracts/documents`, not in `packages/sync/src/documents`.**
   - The sale helper and the pricing engine are in core, and the helper's output must have the schema's type. Core cannot depend on sync, because sync carries Dexie.
   - So `@serva/sync` now depends on `@serva/core` and wraps the check as `documentPayloadRejection`.
   - 17 › المبادئ also puts every contract in `packages/core/contracts`.
2. **The payload check is not part of `syncDocumentSchema`.** That schema parses the whole push, so a malformed payload would answer 400 for the whole batch. Instead, the push classifies each document and rejects only the bad one, with `invalid_payload` (15 › المرفوض لا يوقف الطابور).
3. **Variants are a set of their own**, not folded into products.
   - 09 says sales, stock and barcodes always point at the variant.
   - A clothing store has 300,000 variants (15 › الحجم).
4. **`prices` is a set of its own, with `id` = the variant id** and one row per variant.
   - It keeps 09's model (the price and its currency live on the variant), so the server may serve it from the `variants` table's price columns.
   - A price edit, the busiest change, moves only the small row.
   - A price checker pulls only prices (17).
   - A dollar price stays in dollars, so a new rate is one row (15).
5. **`units` and `tax_rates` are small sets**, not copied into every product.
   - A cashier needs `allowsFraction` for weights and the unit symbol for the receipt.
   - Posting needs the tax rate's id and kind.
   - 17 has phase-1 routes for both.
   - Each store gets «قطعة» and «كيلو» and no tax rate when it is created.
6. **Packs:**
   - A pack barcode sells `qty` packs at the pack price.
   - `baseQty = roundDiv(qty × packQty, 1000)` moves stock.
   - `packPrice()` gives the pack price when the barcode has none.
7. **A price typed in the cart is a discount** (12 › قواعد السلة). It is sent as an amount discount with `source: 'price_override'`, and `unitPriceMinor` stays the catalog price.
8. **No `deps` for these four types.** A printed sale must never be rejected because its shift document was (08 › قاعدة 8), so sales refer to their shift by id only.
9. **Every payload field is always present** (`null`, never left out), so hashes and reprints never depend on client defaults. Unknown extra keys are ignored by validation and kept in the stored document, so additive changes stay in contract v1.
10. **Phase 1 has one warehouse per branch.**
    - `stock_levels` is per branch and variant, and sale lines carry no warehouse.
    - Phase 2 adds an optional `warehouseId` to both. If it is absent, it means the branch's main warehouse.
11. **Rates use money.ts's shape everywhere:** `{ unit, quote, rate }`, so values go straight into `convert()` and pounds per dollar is never inverted.
12. **PATCH sends `version` in the body**, like `PATCH /v1/devices/{id}`. A mismatch answers 409 `stale_version`.
13. **Columns added to existing sets:**
    - `settings` gains `storeName`, `taxNumber`, `timezone`, `businessDayCutoff` and `shiftMode`.
    - `users` gains `pinLength` and `pinVersion`.

## Open product questions

Each question below has the default the contract takes. Each default is the safest choice that still matches the spec.

- **Q1. PIN sign-in offline (16 › تخمين رمز PIN; 17 › السحب: users).**
  - The spec forbids sending portable PIN hashes and asks for verification with the device's key, but the server cannot make a device-key verifier for a PIN it only holds as a hash.
  - **Default:**
    - Pull sets carry no PIN data, only `pinLength` and `pinVersion`.
    - A user's first sign-in on a device is online, through `POST /v1/device/staff-sessions` (17).
    - The device then keeps HMAC(its non-extractable key, pin) and verifies offline after that.
    - A new `pinVersion` makes the device forget that value.
  - A manager approves offline only on a device where he has signed in once while online.
- **Q2. Customers in step 4.** The brief's pull sets do not include `customers` or `balances`.
  - **Default:** the cashier hides the customer chip and credit in step 4, and every sale sends `customerId: null`.
  - The payload already supports both, and credit requires a customer.
- **Q3. Rounding a dollar price converted to pounds** («تقريب لأقرب فئة متداولة», 10 › تعدد العملات).
  - **Default:** no rounding. `unitPriceMinor` is the exact conversion. Only the cash part of the payment is rounded, to the cash step.
  - A price step would be a new `settings` field and a new engine version.
- **Q4. The counter-account of `pay_in` and `pay_out`.** 11 lists «إيداع أو سحب» without a destination.
  - **Default:** both are against the safe, 1120.
  - `expense` names its 61xx account, and owner draws use OWN (a later document).
- **Q5. Approval thresholds for cash movements** («فوق حد يحدده المالك»).
  - **Default:** every cash movement asks for the manager's code, as the design board shows. No threshold setting exists yet.
- **Q6. Wallet and card providers.** `provider_accounts` doesn't exist yet.
  - **Default:** `providerAccountId: null`. Posting uses 1140 and 1150 without the provider subaccount until providers exist.
- **Q7. Arabic search normalization.** `normalizeArabic()` (15 › البحث) is not in core yet.
  - **Default:** the server's `q` search and the device's index must both use it, so it should land in `@serva/core/text` before either one ships search. The contract only promises that `q` matches a normalized name or an exact barcode.
- **Q8. Product images, matrix generation (`/variants/generate`) and wholesale tiers** are not in this step.
  - **Default:** the product card builds the size × colour matrix on the client and sends it as `variants`. Tiers wait for price lists (phase 2).
