# Returns to the customer's account (إلى حساب الزبون)

Rule (08 › مرتجع مبيعات: "تخفيض دين الزبون"):

- `refunds[].method = 'account'` is a new refund method. The return document gets an optional
  `customerId` (the sale's customer); it is required with `account` and absent otherwise, so older
  tills and old stored documents are unaffected.
- Posting (`posting.ts › returnLines`): Dr 4100 (and tax, less 4200 discount) as always; the credit side
  is **Cr 1200 with the customer as party** instead of the drawer. Nothing touches 1110.
- The posting reads only its own document (no balance lookups). A return larger than what the customer
  owes leaves a credit balance on 1200, exactly as an over-payment by receipt does; 2300 is used by no
  document today.
- The till defaults to `account` when the sale names a customer and was (partly) on credit
  (`defaultRefundMethod`); cash stays one tap away.
- An older till still sends `cash` for a credit sale; the server posts that as it came (no
  reinterpretation).
- Integrity: `day_report_ledger` reads `account` as the `credit` method (1200).

## Correcting returns posted before this change

Not automatic and not run by any deploy. If the shop confirms that no cash left the drawer for some
past returns of credit sales (the debt should have come down):

    pnpm --filter @serva/api correct-credit-returns --store=<code>            # list only
    pnpm --filter @serva/api correct-credit-returns --store=<code> --apply    # post
    ... --apply --returns=<id>,<id>                                            # only these

Only returns **made at the till before the account method went live** are candidates
(`ACCOUNT_REFUND_LIVE_AT` in `credit-return-correction.ts`, 2026-11-12 09:13 +03). A cash refund of a
credit sale made since is a deliberate choice and is never listed. This is the only thing that
separates the two: the return's payload, its engine version (always `1.0.0`) and its refund method
are identical for an old till's cash and a deliberate cash refund, so the till's own time is used
(`sale_returns.device_time`). If a till kept running the old version longer, widen it with
`--before=<ISO time>` after reviewing the list with the owner.

One manual entry per return, dated today, `Dr 1110 / Cr 1200 (customer)`, memo
"تصحيح مرتجع … خُفّض من دين الزبون بدل الرد نقداً". Unique by the return it corrects, so a second
run posts nothing. Do not apply it to a return whose cash really was handed back.
