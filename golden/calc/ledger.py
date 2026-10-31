"""Journal entries of the golden day, from 10 › القيود التلقائية and 10 › دليل الحسابات الافتراضي.

Every line is in the base currency (debit/credit) and also keeps its own currency, amount and rate
(10 › تعدد العملات: «القيود والتقارير بالعملة الأساسية … كل سطر قيد يحفظ معادله»). Every entry
must balance in the base currency (10 › قواعد الضمان 1). Account codes are the four-digit codes of
the default chart; automatic sub-accounts (a drawer, a provider: six digits under their parent,
10 › سجل الترقيم) are folded into their parent here, and the replay test folds the system's the
same way, so a different sub-account layout is not reported as a difference.
"""

from collections import defaultdict

# The accounts the golden day can touch: code -> (Arabic name, type, normal side)
ACCOUNTS = {
    "1110": ("الصندوق (أدراج الكاشير)", "asset", "debit"),
    "1120": ("الخزنة", "asset", "debit"),
    "1130": ("البنك", "asset", "debit"),
    "1140": ("مستحقات البطاقات", "asset", "debit"),
    "1150": ("المحافظ الإلكترونية", "asset", "debit"),
    "1200": ("الزبائن (المدينون)", "asset", "debit"),
    "1300": ("المخزون", "asset", "debit"),
    "2200": ("ضريبة مبيعات مستحقة (من نوع القيمة المضافة)", "liability", "credit"),
    "2210": ("رسم الإنفاق الاستهلاكي المستحق", "liability", "credit"),
    "2220": ("رسم الطابع المستحق", "liability", "credit"),
    "2550": ("إكراميات ونسبة خدمة مستحقة للموظفين", "liability", "credit"),
    "4100": ("المبيعات", "revenue", "credit"),
    "4200": ("الحسميات الممنوحة", "revenue", "debit"),  # contra-revenue, debit nature
    "5100": ("كلفة المبيعات", "expense", "debit"),
    "6105": ("النقل والتوصيل", "expense", "debit"),
    "6108": ("الضيافة والنظافة والمستهلكات", "expense", "debit"),
    "6200": ("عجز وزيادة الصندوق", "expense", "debit"),
    "6400": ("فروقات التقريب", "expense", "debit"),
}

TAX_ACCOUNT = {"sales": "2200", "consumption": "2210", "stamp": "2220"}
METHOD_ACCOUNT = {"card": "1140", "wallet": "1150", "transfer": "1130", "credit": "1200"}


def _line(code: str, base: int, currency: str, amount: int, rate: dict | None) -> dict:
    """A signed base amount becomes a debit (positive) or a credit (negative) line."""
    return {
        "accountCode": code,
        "accountName": ACCOUNTS[code][0],
        "debitMinor": base if base > 0 else 0,
        "creditMinor": -base if base < 0 else 0,
        "currency": currency,
        "amountMinor": abs(amount),
        "rate": rate["rate"] if rate else None,
    }


def _merge(lines: list[dict]) -> list[dict]:
    """One line per (account, currency, side), zero lines dropped, in a stable order."""
    acc: dict[tuple, dict] = {}
    for ln in lines:
        if ln["debitMinor"] == 0 and ln["creditMinor"] == 0:
            continue
        side = "D" if ln["debitMinor"] else "C"
        key = (ln["accountCode"], ln["currency"], side)
        if key in acc:
            acc[key]["debitMinor"] += ln["debitMinor"]
            acc[key]["creditMinor"] += ln["creditMinor"]
            acc[key]["amountMinor"] += ln["amountMinor"]
        else:
            acc[key] = dict(ln)
    return sorted(acc.values(), key=lambda l: (0 if l["debitMinor"] else 1, l["accountCode"], l["currency"]))


def balanced(lines: list[dict]) -> bool:
    return sum(l["debitMinor"] for l in lines) == sum(l["creditMinor"] for l in lines)


def post_sale(sale: dict, tax_kinds: dict[str, str], base: str = "SYP") -> list[dict]:
    """
    10 › القيود التلقائية, «مبيعات النقد في الوردية» and «بيع بالبطاقة أو المحفظة»:
      Dr 1110 cash received after rounding (per currency) + 1140/1150 + 4200 discounts (ex tax)
      Cr 4100 sales before discount and before tax + the active tax account, ± 6400 rounding
    plus the tip: Cr 2550 (10: «إكرامية … 2550 ليست إيراداً»). No 5100/1300 line: cost is
    deferred to phase 2 (INTERPRETATIONS.md §9).
    """
    lines = []
    cash_by_currency: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # currency -> [base, amount]
    rate_of: dict[str, dict | None] = {}
    for p in sale["payments"]:
        if p["method"] == "cash":
            cash_by_currency[p["currency"]][0] += p["baseAmountMinor"]
            cash_by_currency[p["currency"]][1] += p["amountMinor"]
            rate_of[p["currency"]] = p["rate"]
        else:
            lines.append(_line(METHOD_ACCOUNT[p["method"]], p["baseAmountMinor"], p["currency"], p["amountMinor"], p["rate"]))
    change = sale["change"]
    if change is not None:
        cash_by_currency[change["currency"]][0] -= change["baseAmountMinor"]
        cash_by_currency[change["currency"]][1] -= change["amountMinor"]
        rate_of[change["currency"]] = change["rate"]
    for currency, (b, amount) in sorted(cash_by_currency.items()):
        lines.append(_line("1110", b, currency, amount, rate_of.get(currency)))

    t = sale["totals"]
    lines.append(_line("4200", t["discountExTaxMinor"], base, t["discountExTaxMinor"], None))
    lines.append(_line("4100", -t["grossExTaxMinor"], base, t["grossExTaxMinor"], None))
    tax_by_account: dict[str, int] = defaultdict(int)
    for ln in sale["lines"]:
        if ln["priced"]["taxMinor"]:
            tax_by_account[TAX_ACCOUNT[tax_kinds[ln["taxRateId"]]]] += ln["priced"]["taxMinor"]
    for code, amount in sorted(tax_by_account.items()):
        lines.append(_line(code, -amount, base, amount, None))
    if sale["tipMinor"]:
        lines.append(_line("2550", -sale["tipMinor"], base, sale["tipMinor"], None))
    rounding = sale["cashRounding"]["roundingBaseMinor"] if sale["cashRounding"] else 0
    lines.append(_line("6400", -rounding, base, rounding, None))  # a gain (customer paid more) is a credit
    merged = _merge(lines)
    assert balanced(merged), f"unbalanced sale entry {merged}"
    return merged


def post_cash_movement(m: dict) -> list[dict]:
    """
    08: إيداع، سحب، تحويل للخزنة; 10: «تحويل نقد للخزنة: 1120 / 1110», «مصروف: 61xx / الدرج».
    pay_in: Dr 1110 / Cr 1120; pay_out and safe_drop: Dr 1120 / Cr 1110; expense: Dr 61xx / Cr 1110.
    """
    b, cur, amt, rate = m["baseAmountMinor"], m["currency"], m["amountMinor"], m["rate"]
    if m["kind"] == "pay_in":
        lines = [_line("1110", b, cur, amt, rate), _line("1120", -b, cur, amt, rate)]
    elif m["kind"] in ("pay_out", "safe_drop"):
        lines = [_line("1120", b, cur, amt, rate), _line("1110", -b, cur, amt, rate)]
    elif m["kind"] == "expense":
        lines = [_line(m["expenseAccountCode"], b, cur, amt, rate), _line("1110", -b, cur, amt, rate)]
    else:
        raise ValueError(m["kind"])
    merged = _merge(lines)
    assert balanced(merged)
    return merged


def post_shift_close(close: dict) -> list[dict]:
    """10 › مطابقة الصندوق: a shortage Dr 6200 / Cr 1110, an overage the reverse (treatment «loss»)."""
    lines = []
    for c in close["cash"]:
        d = c["differenceBaseMinor"]
        if d == 0:
            continue
        lines.append(_line("1110", d, c["currency"], c["differenceMinor"], c["rate"]))
        lines.append(_line("6200", -d, close["baseCurrency"], abs(d), None))
    merged = _merge(lines)
    assert balanced(merged)
    return merged


def trial_balance(entries: list[dict]) -> dict:
    """Sums per account; the closing balance is signed by the account's normal side (10 › الطبيعة)."""
    sums: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in entries:
        for ln in e["lines"]:
            sums[ln["accountCode"]][0] += ln["debitMinor"]
            sums[ln["accountCode"]][1] += ln["creditMinor"]
    rows = []
    for code in sorted(sums):
        debit, credit = sums[code]
        name, kind, side = ACCOUNTS[code]
        closing = debit - credit if side == "debit" else credit - debit
        rows.append(
            {
                "accountCode": code,
                "accountName": name,
                "type": kind,
                "normalSide": side,
                "openingMinor": 0,
                "debitMinor": debit,
                "creditMinor": credit,
                "closingMinor": closing,
            }
        )
    td = sum(r["debitMinor"] for r in rows)
    tc = sum(r["creditMinor"] for r in rows)
    return {"rows": rows, "totals": {"debitMinor": td, "creditMinor": tc}, "balanced": td == tc}
