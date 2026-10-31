"""Payment, cash rounding and change: 10 › حساب الفاتورة steps 6-7 and 10 › تعدد العملات.

6. cash rounding never touches the invoice: it is computed at payment on the part paid in cash
   ONLY, with the step of its currency, and the difference goes to 6400. Credit, card and wallet
   pay the exact amount.
7. change = cash paid - the cash due after its rounding.

Multi-currency (10 › الدفع بأكثر من عملة): several currencies in one invoice, the change in the
currency the cashier picks, every payment keeps its rate. The direction is always «pounds per
dollar»: SYP -> USD divides by the rate.

Reading (INTERPRETATIONS.md §3): non-cash pays exact amounts first; cash in a currency other than
the change currency S is applied in full at its own rate; what remains is converted to S once,
rounded to S's cash step, and the change comes out of the cash tendered in S. The rounding is
measured in the invoice currency, so every sale balances to the qirsh.
"""

from dataclasses import dataclass

from money import convert, round_to_step

NON_CASH = ("card", "wallet", "transfer", "credit")


@dataclass
class Settlement:
    payments: list[dict]  # payload payments, with baseAmountMinor
    change: dict | None
    cash_rounding: dict | None


def settle(
    invoice_currency: str,
    total: int,
    tip: int,
    tenders: list[dict],
    change_currency: str,
    rates: dict[str, dict],
    cash_steps: dict[str, int],
) -> Settlement:
    """
    tenders: [{method, currency, amountMinor, reference?, cardLast4?, cardBrand?}] in the order taken.
    rates: foreign currency -> {unit, quote, rate} pairing it with the invoice currency.
    """
    due = total + tip
    payments = []
    for i, t in enumerate(tenders, start=1):
        rate = None if t["currency"] == invoice_currency else rates[t["currency"]]
        payments.append(
            {
                "paymentNo": i,
                "method": t["method"],
                "currency": t["currency"],
                "amountMinor": t["amountMinor"],
                "rate": rate,
                "baseAmountMinor": convert(t["amountMinor"], t["currency"], invoice_currency, rate),
                "reference": t.get("reference"),
                "cardLast4": t.get("cardLast4"),
                "cardBrand": t.get("cardBrand"),
                "providerAccountId": None,
            }
        )

    non_cash = sum(p["baseAmountMinor"] for p in payments if p["method"] in NON_CASH)
    if non_cash > due:
        raise ValueError("non-cash payments exceed the amount due")
    cash = [p for p in payments if p["method"] == "cash"]
    if not cash:
        if non_cash != due:
            raise ValueError("a sale without cash must be paid exactly")
        return Settlement(payments, None, None)

    s = change_currency
    s_rate = None if s == invoice_currency else rates[s]
    other_cash = sum(p["baseAmountMinor"] for p in cash if p["currency"] != s)
    tendered_s = sum(p["amountMinor"] for p in cash if p["currency"] == s)

    remaining = due - non_cash - other_cash  # invoice currency; negative when others overpay
    exact_s = convert(remaining, invoice_currency, s, s_rate)
    step = cash_steps.get(s, 0)
    due_s = round_to_step(exact_s, step)
    rounding_base = convert(due_s, s, invoice_currency, s_rate) - remaining
    change_amount = tendered_s - due_s
    if change_amount < 0:
        raise ValueError(f"cash short by {-change_amount} {s}")

    paid_base = sum(p["baseAmountMinor"] for p in payments)
    change_base = paid_base - due - rounding_base  # by subtraction: the sale balances exactly
    change = None
    if change_amount > 0:
        change = {
            "currency": s,
            "amountMinor": change_amount,
            "rate": s_rate,
            "baseAmountMinor": change_base,
        }
    elif change_base != 0:
        raise ValueError("no change, yet a change value in base")
    cash_rounding = {
        "currency": s,
        "stepMinor": step,
        "exactMinor": exact_s,
        "dueMinor": due_s,
        "roundingMinor": due_s - exact_s,
        "roundingBaseMinor": rounding_base,
    }
    return Settlement(payments, change, cash_rounding)
