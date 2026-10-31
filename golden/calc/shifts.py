"""The drawer count at shift close, by 10 › مطابقة الصندوق عند إغلاق الوردية:

  expected_c = opening_c + cashIn_c − changeOut_c − refunds_c + receipts_c + payIn_c + fxIn_c
               − payOut_c − fxOut_c − drops_c
  difference_c = counted_c − expected_c       (negative = shortage, positive = overage)

cashIn is the cash TENDERED in currency c, changeOut the change handed back in c; payOut covers
what was paid out of the drawer (pay-outs and expenses, 10: «ما دُفع من الدرج (مصروف …)»);
drops are transfers to the safe. Refunds, receipts and currency exchange do not exist on day 1.
"""

from collections import defaultdict

from money import convert


def shift_terms(docs: list[dict], opening: dict[str, int]) -> dict[str, dict]:
    terms: dict[str, dict] = defaultdict(
        lambda: {
            "openingMinor": 0,
            "cashInMinor": 0,
            "changeOutMinor": 0,
            "refundsMinor": 0,
            "receiptsMinor": 0,
            "payInMinor": 0,
            "fxInMinor": 0,
            "payOutMinor": 0,
            "fxOutMinor": 0,
            "dropsMinor": 0,
        }
    )
    for c, amount in opening.items():
        terms[c]["openingMinor"] += amount
    for d in docs:
        p = d["payload"]
        if d["type"] == "sale":
            for pay in p["payments"]:
                if pay["method"] == "cash":
                    terms[pay["currency"]]["cashInMinor"] += pay["amountMinor"]
            if p["change"]:
                terms[p["change"]["currency"]]["changeOutMinor"] += p["change"]["amountMinor"]
        elif d["type"] == "cash_movement":
            key = {"pay_in": "payInMinor", "pay_out": "payOutMinor", "expense": "payOutMinor", "safe_drop": "dropsMinor"}[p["kind"]]
            terms[p["currency"]][key] += p["amountMinor"]
    for t in terms.values():
        t["expectedMinor"] = (
            t["openingMinor"] + t["cashInMinor"] - t["changeOutMinor"] - t["refundsMinor"] + t["receiptsMinor"]
            + t["payInMinor"] + t["fxInMinor"] - t["payOutMinor"] - t["fxOutMinor"] - t["dropsMinor"]
        )
    return dict(terms)


def by_method(sales: list[dict]) -> list[dict]:
    """The Z summary by method and currency: cash net of the change given in that currency (documents.ts)."""
    rows: dict[tuple, dict] = {}
    for p in sales:
        seen = set()
        for pay in p["payments"]:
            key = (pay["method"], pay["currency"])
            row = rows.setdefault(key, {"method": key[0], "currency": key[1], "count": 0, "amountMinor": 0, "baseAmountMinor": 0})
            row["amountMinor"] += pay["amountMinor"]
            row["baseAmountMinor"] += pay["baseAmountMinor"]
            if key not in seen:
                row["count"] += 1
                seen.add(key)
        if p["change"]:
            key = ("cash", p["change"]["currency"])
            row = rows.setdefault(key, {"method": "cash", "currency": key[1], "count": 0, "amountMinor": 0, "baseAmountMinor": 0})
            row["amountMinor"] -= p["change"]["amountMinor"]
            row["baseAmountMinor"] -= p["change"]["baseAmountMinor"]
    order = {"cash": 0, "card": 1, "wallet": 2, "transfer": 3, "credit": 4}
    return sorted(rows.values(), key=lambda r: (order[r["method"]], r["currency"]))


def close_payload(shift_number: str, closed_by: str, docs, opening, counted_diff, closing_rate, base="SYP") -> dict:
    terms = shift_terms(docs, opening)
    cash = []
    for currency in sorted(terms, key=lambda c: (c != base, c)):
        t = terms[currency]
        counted = t["expectedMinor"] + counted_diff.get(currency, 0)
        diff = counted - t["expectedMinor"]
        rate = None if currency == base else closing_rate
        cash.append(
            {
                "currency": currency,
                "rate": rate,
                **{k: t[k] for k in t if k != "expectedMinor"},
                "expectedMinor": t["expectedMinor"],
                "countedMinor": counted,
                "denominations": None,
                "differenceMinor": diff,
                "differenceBaseMinor": convert(diff, currency, base, rate),
            }
        )
    sales = [d["payload"] for d in docs if d["type"] == "sale"]
    summary = {
        "saleCount": len(sales),
        "byMethod": [{k: r[k] for k in ("method", "currency", "count", "amountMinor")} for r in by_method(sales)],
    }
    return {
        "shiftId": None,
        "shiftNumber": shift_number,
        "closedBy": closed_by,
        "baseCurrency": base,
        "cash": cash,
        "shortageTreatment": "loss",
        "approval": None,
        "summary": summary,
        "forced": False,
    }
