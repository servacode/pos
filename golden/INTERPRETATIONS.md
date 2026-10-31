# Golden day: how the calculator reads the specs

The calculator in `golden/calc` was written from specs 10, 23, 08 and 27, plus the payload shapes of
`packages/core/src/contracts/documents.ts` (read for the shape only). Where a spec leaves room, this
file gives the quote, the reading we chose and why. Items marked **[owner/accountant]** need a decision
before the sheet is approved.

## Money and rounding

1. **Rounding rule.** 10 › تمثيل المال: «التقريب: النصف يبتعد عن الصفر». Every rounding in the
   calculator is one rounding of an exact rational, half away from zero (`decimal.ROUND_HALF_UP`).

2. **Rates divide, never multiply by the inverse.** 10: «التحويل إلى الدولار يقسم على هذا السعر ولا
   يضرب في مقلوبه». SYP → USD is `round(amount ÷ rate)`, USD → SYP is `round(amount × rate)`.

3. **The inclusive-price example of 10 is in minor units.** 10: «صنف بسعر شامل 1,150، وضريبة 15%، وخصم
   شامل 150 … الضريبة 130». In pounds with qirsh the fee would be 130.43; the example's numbers only work as
   minor units (11.50). The unit test uses 1,150 minor units. The rule itself (tax extracted per line, the
   ex-tax discount by subtraction) is applied as written.

4. **Line gross.** 10 step 1: «إجمالي البند = السعر × الكمية». Quantities are thousandths, so the gross
   is `round(unit price × qty ÷ 1000)`, per line, before any discount.

5. **Percent discounts.** 10 step 2: «خصم البند (نسبة أو مبلغ) لا يتجاوز إجماليه». A percent is rounded
   once on the line gross; an amount is taken as given; both are capped at the gross. The invoice percent
   is taken on the sum of the nets after line discounts and capped there too.

6. **Invoice-discount split and its tie-break.** 10 step 3: «يُوزَّع على البنود بنسبة صافي كل بند، وفروق
   القروش تذهب للبنود ذات الكسر الأكبر … الترتيب برقم السطر الثابت». Every line gets the floor of its exact
   share; the leftover qirsh go one each to the largest fractions; equal fractions go to the **smaller**
   `lineNo` first (the documents contract says the same). Sale INV-001-001-0000002 is the tie case: 0.05
   over two equal lines gives 0.03 to line 1 and 0.02 to line 2.

7. **Inclusive prices.** The store's shelf prices include the fee (10 › شمول السعر: «الافتراضي حسب
   عادة القطاع»; Syrian retail prints prices with fees in). Per line: `tax = round(net × r ÷ (1+r))`,
   `grossExTax = gross − round(gross × r ÷ (1+r))`, `netExTax = net − tax`,
   `discountExTax = grossExTax − netExTax`, `total = net`.

8. **A price typed in the cart is a discount.** 12 › قواعد السلة, as the documents contract carries it:
   an amount discount with `source: price_override`, of `round((catalog price − typed price) × qty ÷ 1000)`.
   The catalog price stays the line's unit price.

9. **Dollar-priced items.** 10: «التسعير بعملة والبيع بأخرى … مع تقريب لأقرب فئة متداولة». The sheet
   converts the dollar price at the sale's rate with no rounding to a banknote (the contract's Q3 default).
   **[owner]** If prices should snap to a banknote, every dollar line changes.

## Cash, change and rounding

10. **Cash rounding is on the cash part only, to the nearest step, up or down.** 10 step 6: «يُحسب عند
    الدفع على الجزء المدفوع نقداً وحده، بخطوة عملته، والفرق يُقيد في 6400». The spec does not say
    «always up»; with the half-away rule the cash due goes to the NEAREST step (10 pounds, a quarter
    dollar), so the shop gains on some sales and loses on others (78 up, 58 down, 28 exact on this day).
    10's own example (12,347.50 → 12,350) is consistent with both readings. **[owner]**

11. **Several currencies in one sale.** 10 › تعدد العملات: «الدفع بأكثر من عملة … والباقي بالعملة التي
    يختارها الكاشير، وكل دفعة تحفظ سعر صرفها». Reading: card and wallet pay exact amounts first; cash in a
    currency other than the change currency is applied in full at its own rate; what remains is converted
    once into the change currency, rounded to that currency's step, and the change comes out of the cash
    tendered in it. The rounding is measured in pounds (it absorbs the conversion when the change is in
    dollars), and the change's pound value is found by subtraction, so every sale balances to the qirsh.
    23 › 3 is sale #1 exactly: 1,290.00; 9 $ at 130 = 1,170.00; 120.00 left; a 200 note; 80.00 back.

12. **Change in dollars.** When the cashier gives change in dollars, the rounding step is the quarter
    dollar, and the drawer of dollars gets the change out of it (10 › درج لكل عملة).

13. **The collect rate.** 10 › سعر قبض الدولار is optional; the golden store does not use one, so every
    dollar payment is taken at the day's rate.

14. **Two rates in the day.** The brief says «rate 130 per 23»; 23 › 11 also asks for «سعرين للصرف خلال
    اليوم». The day runs at 130 until 14:00 (Damascus) and at 132 after. Each sale carries its rate.

## Shifts and the drawer

15. **Expected cash.** 10 › مطابقة الصندوق, the formula as written, per currency. «cashIn» is the cash
    tendered in that currency, «changeOut» the change handed back in it. «payOut» includes the drawer
    expense (10: «ما دُفع من الدرج (مصروف …)»); «drops» is the transfer to the safe. Refunds, receipts and
    currency exchange are zero on day 1.

16. **The differences.** Device 001 counts 1,000 ل.س more than expected (23 › 4); device 002 counts
    500 ل.س less. The dollar drawers count exactly. Treatment «loss» (no charge to the cashier).

17. **The shift's sales total** is the sum of the invoice totals, without tips (a tip is not a sale,
    10: 2550 «ليست إيراداً»). The Z summary by method shows cash net of the change given in that currency;
    its count is the number of sales that used that method and currency.

## Journal

18. **Accounts.** Sale: Dr 1110 cash per currency (tendered − change, at the payment's rate), Dr 1140 card,
    Dr 1150 wallet, Dr 4200 discounts ex-tax; Cr 4100 gross ex-tax, Cr 2210 the consumption fee, Cr 2550
    tips, ± 6400 rounding (a gain is a credit, 10: «ويُقيد 2.50 دائناً في 6400»). Cash movements: pay-in
    1110 / 1120, pay-out and drop 1120 / 1110 (the contract's Q4 default: the counter-account is the safe),
    expense 6105 / 1110. Shift close: overage 1110 / 6200, shortage 6200 / 1110.

19. **No cost of goods sold.** 10 › الكلفة والربح posts cost in a daily entry (5100 / 1300) from the
    branch's weighted average. Cost is deferred to phase 2 (step-4 contract: «Cost … computed by the
    server»; no product has a cost). The sheet posts NO 5100/1300 line; stock is compared in quantities
    only. **[accountant]** The day's trial balance therefore shows sales without their cost.

20. **No entry for the opening float.** 10 has no event for opening a shift. The float was in the drawer
    before the day began; on a new store it has no opening balance (10 says every opening balance goes
    against 3900). So 1110 in the trial balance holds the day's movements only:
    Σ 1110 = Σ (counted − opening) per currency. **[accountant]** Either enter the drawers' opening
    balances against 3900 before day 1, or accept that the integrity check compares movements.

21. **One entry per document.** 10: «مبيعات النقد قيد واحد لكل وردية بتفصيل كل فاتورة، وباقي المستندات
    قيد لكل مستند». The sheet lists one entry per sale so each can be checked; the replay test compares the
    whole day account by account, and per document only where the system posted per document.

22. **Sub-accounts.** 10 › سجل الترقيم: drawers and providers get six-digit sub-accounts under their parent.
    The sheet uses the four-digit parents (with the currency on every 1110 line); the test folds the
    system's sub-accounts into their parent.

23. **Foreign cash in the ledger.** Each dollar payment is posted at its own rate, in pounds (10:
    «كل سطر قيد يحفظ معادله»). No exchange difference arises on the sale day (6510 is for collecting a debt
    or exchanging cash at another rate; 6520 is the month-end revaluation).

24. **Trial balance signs.** «Closing» follows the account's nature (10 › الطبيعة): debit-natured accounts
    show debit − credit, credit-natured ones credit − debit. 4200 is debit-natured (a contra-revenue).
    6200 and 6400 end with a credit balance on this day, so they show as negative (له).

## Tax

25. **Which tax, at which rate.** 10 › نموذج الضرائب السوري: «لا نفترض ضريبة قيمة مضافة غير موجودة»;
    the consumption spending fee applies to «المطاعم والمقاهي والمنشآت السياحية المشمولة». The golden
    store is a market with a café corner: the café items carry the fee at 15% (the illustration rate of
    10's worked example), bakery items carry the fee at a zero rate («خاضع بنسبة صفر»), and everything else
    has no tax rate. **[owner/accountant]** The real rate and the items it covers must come from the tax
    table reviewed by a chartered accountant (10).

## Sync and the evidence screen

26. **Counts.** 23 › 5: «أُرسل 5، مكرر 5، رُفض 0» for five sales sent then sent again. So «sent» counts
    distinct documents, and «duplicate» counts the repeated arrivals. Each device: every document accepted
    once, 25 duplicates, nothing rejected or held, and the last number it announced equals the last that
    arrived, per series.

27. **Arrival order.** The push plan shuffles each device's documents, sends device 002's shift close
    before any of its sales, and sends the 50 offline sales twice (the second time after everything else).
    The results must not depend on it.

## Scenario choices (not rules)

28. The cashier's discount limit is 10%; above it, and for every cash movement (contract Q5), the payload
    carries the manager's approval. Approvals given during the offline window are marked offline.
29. Opening stock and the exchange rate have no admin route yet; the test writes them directly, as the
    existing catalog fixtures do.
30. The day is 2026-10-30, Damascus time (UTC+3). Device 001 sells from 08:10 to 20:30, device 002 from
    09:05 to 20:40; sales 41–65 of device 001 and 31–55 of device 002 were made offline.
