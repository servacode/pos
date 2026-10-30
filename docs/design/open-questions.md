# Spec gaps reported by designers (for a later doc pass)

## A12 customer

- Cart: WhatsApp ordering vs catalog mode can't co-exist for one shop (drawn as two shops).
- 26: substitute offered before acceptance (cancel allowed only before acceptance) — align 26 wording.
- 12 says no reserve before phone code; 26 says no reserve until shop accepts → fix 12 to match 26.
- 12 wants WhatsApp button on every customer page; not on suspended-store page → add exception to 12.
- Statement «له/عليه» from customer's view reads oddly → consider «لك/عليك» on customer-facing pages (22/14 glossary).
- Electronic payment shown live at checkout but 26 says phase 5 «عند توفره».
- Payslip message (22) after launch vs payslip link drawn.
- canvas.json: add radius 36 to phone boards, 12 to desktop boards (final canvas pass).

## A10 agent + rep

- No registration-link domain in specs (used serva.sy/r/FURAT24) → decide platform domain.
- Agent cash limit placeholder in 24 ([المبلغ]) — used 400$.
- 07/24 use «عميل محتمل» but «عميل» banned in glossary → «محل محتمل».
- 32 says «رمز PIN» for rep login — glossary bans PIN → «رمز الدخول».
- 07: does 15–20% recurring commission apply to stores activated from prepaid credit at wholesale price? Assumed no.
- Fixed draft prices: أساسية 10$/100$ yearly, احترافية 25$/250$; commission 15%.
- Activation bonus «أول شهرين» ambiguous — read as 50% of first two monthly payments.
- 14 lists high-contrast mode without tokens → define .hc tokens.
- 32: rep sees expected cash at end-of-day count? Shown.
- Bottom tabs for agent/rep apps not defined in 12 → used الرئيسية·متاجري·فرصي·عمولاتي·المزيد / خط اليوم·الزبائن·السيارة·مستنداتي·المزيد.

## A03 cashier part 2

- 20: one loyalty program per shop, but board asked points + stamp card on one customer.
- Settlement discount: 12 says within role limit; 03 (building materials) says owner permission → unify (used 5% role limit, approval above).
- 15 status bar wording «كل شيء متزامن» + 24h times break glossary (no «مزامنة») and 12-hour rule → fix 15.
- 12 status bar 44px vs 48px touch target on cashier → reconcile.
- Payment side panel width not specified in 12.
- Cash denominations for shift close not in specs (used 10,25,50,100,200,500 ل.س; $1–100).
- Card providers unnamed (used المصرف التجاري، بنك البركة as stand-ins).
- 27 prefers per-invoice QR; board asked fixed Sham Cash QR.

## A05 restaurant + owner phone

- Hub pairing approval: 03 says manager, 15 says owner from phone → unify.
- 21: waiter devices print direct to station printer when hub down vs iPhones never print directly → iPhone queues «بانتظار الإرسال»; define fallback per platform.
- Waiter app navigation not in specs (used الطاولات·جاهز·النداءات·أنا).
- 08 PO numbering example missing; stocktake (CNT) format missing; approval-decision and expense doc number formats missing.

## A01 onboarding + states

- Terms at sign-up: 24 wants checkbox; 04/12 plain line → unify.
- Phone verification: 04 vs 07/12 (verify first) → fix 04.
- Owner confirming agent-registered store (07) has no screen in 12 → add.
- Trial-sale buttons wording: 04 vs 12 → fix 04 to 12.
- Password-recovery questions not specified.
- Shop colour contrast check needs palette outside tokens.
- High-contrast mode tokens missing in 14.
- Tax number format not specified.
- Seasonal pause: no figures (duration/fee) in 07.
- Remote-control consent session check not specified (used 6-digit code).
- Offline admin: disabled actions list not specified.
- Maintenance page: what still works not specified in 12/16.
- Very long totals: font downsizing rule not in 14.

## A02 cashier part 1

- New SYP banknote denominations not in specs (assumed 10,25,50,100,200,500).
- Store code format for device linking not specified (used 5 digits).
- Consumption-spending fee rate pending legal review (sample 5%).
- Bluetooth printer pairing specced for rep phone; also on Android cashier?
- Unknown barcode sale: 12 says cashier + manager code; 04 says owner/manager directly, cashier only if owner allows → unify.
- 12 payment-method list lacks voucher (from 03) → add.
- 15 status-bar wording vs glossary/12-hour (also A03).

## A13 print

- Return doc code: SRT (08) vs RET (kit) → use SRT; fix KIT.
- Inventory row said «سند الصرف» (banned) → «سند دفع».
- Code128 of full invoice number too dense for 58mm → engineering decision (digits-only barcode).
- Consumption fee / service fee rates not fixed (5%/10% samples).
- No domain for shop online store / digital receipt (used <shop>.serva.sy) → decide platform domain (also A10).
- Asset code format missing in 33 (used 1520-0012).
- Payroll tax/insurance rates assumed in 33.

## A11 accountant + public + messages

- 30: accountant login by WhatsApp code vs 30 security/12 authenticator/passkey → fix 30 intro.
- Red close step: 30 says skippable with reason; 29 says red integrity check blocks close → unify (integrity never skippable).
- 30 step names use «مزامنة» (banned) → «علامات المستندات»، «جهاز لم يُرسل».
- 30: 100:1 conversion rounding to 3900 but 3900 must be zero before close — no clearing rule.
- Reopening closed month: 30 accountant vs 29 owner-only unlock → unify (operational month vs accounting period).
- Full-scope accountant sending entry for owner approval — allowed? (drawn allowed).
- Accountant reward rates not set in 30/24 (used 15% first-year + $2/month/shop).
- Unified tax calendar deadlines not defined.
- Add-on prices (device/branch/company pack) not set in 07.

## A09 platform

- Platform domains/accounts (serva.sy, mail, wallet numbers, bank) not in specs → decide (also A10/A13).
- Email and SMS providers not chosen.
- Store health score floor/cap undefined.
- 33 payroll tax/insurance in old pounds, unconfirmed.
- Who confirms legal tables at platform level (13).
- Owner password reset: 13 strict rule vs 16 lists with one-click fixes → fix 16.
- Platform panel short session value not given (used 30 min).

## A04 sectors

- 21 uses 24h time in hub message; kit 12h → fix 21.
- Repair statuses: 03 (7 incl. «لم يُصلح») vs 31 adds «بانتظار قطع» → unify to 31.
- Service fee / consumption fee rates not fixed.
- 31 says quantity-by-formula after launch but inventory/wholesale screen needs it → decide (F5 kept after launch).
- Staff meal over daily limit → manager code (not in 03).
- Controlled-drug sale by non-pharmacist handoff not specified.
- Number formats for SO, RPR, QUO, DLV, PRD not given in 08 examples.

## A08 admin part 3

- 08 has no prefix for ordinary expense doc (used PAY for paid, JRN for accruals).
- Legal retention period pending lawyer.
- Platform Sham Cash account, link domain, plan prices not fixed.
- 21 «المركز» only for restaurants — generic branch hub for supermarket?
- 31 caps 3 warehouses/branch on Pro — check vs real supermarkets (damaged/quarantine warehouses).

## A07 admin part 2

- 12 puts accountant/setup-assistant/support access under «الموظفون» vs inventory «الإعدادات» → decide.
- 28 starts RahalGo link from «الإعدادات ← قنوات البيع» vs 12 own section → fix 28.
- 08: only accountant creates netting; owner sends to accountant → clarify.
- Setup-assistant scope: 07 fixed vs 12 owner-set → toggles within ceiling.
- «آخر مزامنة» banned word in inventory → «آخر إرسال».
- 19 sidebar sections at 40px rows don't fit 1024 → 36px nav rows in admin (update 14).
- 32 settlement example amounts out of scale.
- 26 public store domain not named (used yasmin.serva.shop) — DOMAIN decision needed (several designers used different: <shop>.serva.sy, serva.sy/r/…, yasmin.serva.shop).
- Commission tier rates not in specs.
- Kit lacks drag-handle icon.

## A06 admin part 1

- 27 tax statuses use «ترحيل» (accounting-only) → plain labels for owner.
- Return prefix SRT (08) vs RET (kit) — A06 used RET, A13 used SRT → standardize SRT, fix boards later.
- No doc type for reversing a sales invoice («اعكس») — used full return as reversal.
- Purchase order statuses not defined.
- ASM covers assembly + disassembly.
- 30 month-reopen request direction (owner→accountant) vs inventory.
- 19 sidebar sections don't fit 900/1024 high → collapse/hide disabled features.
- Only one banner at a time (12) — documented.
- 03 exchange vouchers anonymous vs customer card shows vouchers → clarify (optional link).
