"""Regenerates golden/day1: scenario.json, expected.json, results.xlsx and RESULTS.md.

    python3 golden/calc/build.py

Deterministic: the same seed always writes the same files, byte for byte.
"""

import json
import random
import sys
from collections import defaultdict
from pathlib import Path

from catalogue import (
    BASE,
    BUSINESS_DATE,
    CASH_STEPS,
    DEVICES,
    PRODUCTS,
    RATE_AFTERNOON,
    RATE_MORNING,
    RATE_SWITCH_UTC,
    SEED,
    STORE,
    TAX_RATES,
    TIMEZONE,
    USERS,
)
from ledger import balanced, post_cash_movement, post_sale, post_shift_close, trial_balance
from scenario import build_day, iso, rate_at
from shifts import by_method, close_payload, shift_terms

DAY = Path(__file__).resolve().parent.parent / "day1"
PUSH_BATCH = 40


def envelope(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "seq": doc["seq"],
        "type": doc["type"],
        "number": doc["number"],
        "deviceTime": iso(doc["time"]),
        "businessDate": BUSINESS_DATE,
        "deviceOffsetMs": 0,
        "engineVersion": "1.0.0",
        "contractVersion": 1,
        "deps": [],
        "payload": doc["payload"],
    }


def push_plan(devices: dict, rng: random.Random) -> list[dict]:
    """
    The order the documents reach the server: shuffled within each device, the 50 offline sales
    sent twice (the second time in a later batch), and device 2's shift close sent FIRST, before
    any of its sales (10/brief: arrival order must not change anything).
    """
    per_device = {}
    for dev, d in devices.items():
        docs = d["docs"]
        offline = [x["id"] for x in docs if x.get("offline")]
        online = [x["id"] for x in docs if not x.get("offline")]
        rng.shuffle(online)
        if dev == "D2":
            close = next(x["id"] for x in docs if x["type"] == "shift_close")
            online.remove(close)
            online.insert(0, close)
        first = offline[:]
        rng.shuffle(first)
        second = offline[:]
        rng.shuffle(second)
        half = len(online) // 2
        stream = online[:half] + first + online[half:]
        batches = [stream[i : i + PUSH_BATCH] for i in range(0, len(stream), PUSH_BATCH)]
        # the replays go out in their own batches after everything else: «أُعيد إرسالها مرتين»
        batches += [second[i : i + PUSH_BATCH] for i in range(0, len(second), PUSH_BATCH)]
        per_device[dev] = batches
    plan = []
    while any(per_device.values()):
        for dev in ("D2", "D1"):
            if per_device[dev]:
                plan.append({"device": dev, "documents": per_device[dev].pop(0)})
    return plan


def main() -> int:
    day = build_day()
    devices = day["devices"]

    # shift close payloads, from the documents of each shift
    for dev, d in devices.items():
        plan = d["plan"]
        body = [x for x in d["docs"] if x["type"] in ("sale", "cash_movement")]
        shift_open = next(x for x in d["docs"] if x["type"] == "shift_open")
        close = next(x for x in d["docs"] if x["type"] == "shift_close")
        payload = close_payload(
            shift_open["number"], plan["cashier"], body, plan["opening"], plan["countedDifference"], rate_at(close["time"])
        )
        payload["shiftId"] = d["shiftId"]
        close["payload"] = payload

    rng = random.Random(SEED + 3)
    scenario = {
        "about": "اليوم الذهبي للمرحلة 1 (23 › 11): مدخلات محسوبة بمعزل عن البرنامج. Regenerate with golden/calc/build.py.",
        "seed": SEED,
        "businessDate": BUSINESS_DATE,
        "timezone": TIMEZONE,
        "baseCurrency": BASE,
        "store": STORE,
        "cashSteps": CASH_STEPS,
        "rates": {"morning": RATE_MORNING, "afternoon": RATE_AFTERNOON, "switchAt": RATE_SWITCH_UTC},
        "taxRates": TAX_RATES,
        "users": USERS,
        "devices": {k: {**v, "lastIssued": devices[k]["lastIssued"]} for k, v in DEVICES.items()},
        "products": PRODUCTS,
        "documents": {
            dev: [
                {
                    **envelope(x),
                    "golden": {k: x[k] for k in ("offline", "pattern", "tag") if x.get(k) is not None},
                }
                for x in d["docs"]
            ]
            for dev, d in devices.items()
        },
        "pushPlan": push_plan(devices, rng),
    }

    expected = compute_expected(scenario)
    DAY.mkdir(parents=True, exist_ok=True)
    write_json(DAY / "scenario.json", scenario)
    write_json(DAY / "expected.json", expected)

    import sheets

    sheets.write_all(DAY, scenario, expected)
    print(summary_line(expected))
    return 0


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def compute_expected(scenario: dict) -> dict:
    tax_kinds = {f"@tax:{k}": v["kind"] for k, v in TAX_RATES.items()}
    invoices, journal, shifts = [], [], []
    stock = {p["sku"]: {"opening": p["openingStock"], "sold": 0} for p in PRODUCTS if p["type"] == "stock"}
    day = defaultdict(int)
    cashiers: dict[str, dict] = {}
    all_sales = []
    evidence = {}

    for dev, docs in scenario["documents"].items():
        sales = [d for d in docs if d["type"] == "sale"]
        body = [d for d in docs if d["type"] in ("sale", "cash_movement")]
        shift_open = next(d for d in docs if d["type"] == "shift_open")
        close = next(d for d in docs if d["type"] == "shift_close")
        for d in docs:
            p = d["payload"]
            if d["type"] == "sale":
                lines = post_sale(p, tax_kinds)
                entry = {"source": {"type": "sale", "id": d["id"], "number": d["number"]}, "date": BUSINESS_DATE, "lines": lines}
                journal.append(entry)
                for ln in p["lines"]:
                    sku = ln["variantId"].split(":")[1]
                    if sku in stock:
                        stock[sku]["sold"] += ln["baseQty"]
                invoices.append(
                    {
                        "number": d["number"],
                        "id": d["id"],
                        "device": dev,
                        "deviceTime": d["deviceTime"],
                        "shiftId": p["shiftId"],
                        "cashierId": p["cashierId"],
                        "offline": d["golden"].get("offline", False),
                        "pattern": d["golden"]["pattern"],
                        "rate": p["exchangeRates"][0]["rate"],
                        "lines": [
                            {
                                "lineNo": ln["lineNo"],
                                "sku": ln["variantId"].split(":")[1],
                                "name": ln["name"],
                                "qty": ln["qty"],
                                "packQty": ln["packQty"],
                                "baseQty": ln["baseQty"],
                                "unitPriceMinor": ln["unitPriceMinor"],
                                "taxRateBp": ln["taxRateBp"],
                                "discount": ln["discount"],
                                **ln["priced"],
                            }
                            for ln in p["lines"]
                        ],
                        "invoiceDiscount": p["invoiceDiscount"],
                        "totals": p["totals"],
                        "tipMinor": p["tipMinor"],
                        "payments": p["payments"],
                        "change": p["change"],
                        "cashRounding": p["cashRounding"],
                        "journal": lines,
                    }
                )
                t = p["totals"]
                for k in ("grossMinor", "discountMinor", "grossExTaxMinor", "discountExTaxMinor", "netExTaxMinor", "taxMinor", "totalMinor"):
                    day[k] += t[k]
                day["tipsMinor"] += p["tipMinor"]
                day["cashRoundingMinor"] += p["cashRounding"]["roundingBaseMinor"] if p["cashRounding"] else 0
                c = cashiers.setdefault(p["cashierId"], {"userId": p["cashierId"], "invoiceCount": 0, "totalMinor": 0})
                c["invoiceCount"] += 1
                c["totalMinor"] += t["totalMinor"]
                all_sales.append(p)
            elif d["type"] == "cash_movement":
                journal.append(
                    {
                        "source": {"type": "cash_movement", "id": d["id"], "number": d["number"]},
                        "date": BUSINESS_DATE,
                        "lines": post_cash_movement(p),
                    }
                )
            elif d["type"] == "shift_close":
                lines = post_shift_close(p)
                if lines:
                    journal.append(
                        {"source": {"type": "shift_close", "id": d["id"], "number": p["shiftNumber"]}, "date": BUSINESS_DATE, "lines": lines}
                    )

        opening = {c["currency"]: c["amountMinor"] for c in shift_open["payload"]["opening"]}
        terms = shift_terms([{"type": d["type"], "payload": d["payload"]} for d in body], opening)
        by_currency = []
        for c in close["payload"]["cash"]:
            t = terms[c["currency"]]
            assert t["expectedMinor"] == c["expectedMinor"]
            by_currency.append(
                {
                    "currency": c["currency"],
                    "openingMinor": t["openingMinor"],
                    "cashSalesMinor": t["cashInMinor"],
                    "changeGivenMinor": t["changeOutMinor"],
                    "payInMinor": t["payInMinor"],
                    "payOutMinor": t["payOutMinor"],
                    "dropsMinor": t["dropsMinor"],
                    "expectedMinor": c["expectedMinor"],
                    "countedMinor": c["countedMinor"],
                    "differenceMinor": c["differenceMinor"],
                    "differenceBaseMinor": c["differenceBaseMinor"],
                }
            )
        movements = [d for d in docs if d["type"] == "cash_movement"]
        shifts.append(
            {
                "id": shift_open["id"],
                "number": shift_open["number"],
                "device": dev,
                "deviceCode": DEVICES[dev]["code"],
                "openedBy": shift_open["payload"]["openedBy"],
                "openedAt": shift_open["deviceTime"],
                "closedAt": close["deviceTime"],
                "status": "closed",
                "salesCount": len(sales),
                "salesTotalMinor": sum(s["payload"]["totals"]["totalMinor"] for s in sales),
                "byCurrency": by_currency,
                "byMethod": [{k: r[k] for k in ("method", "currency", "amountMinor", "count")} for r in by_method([s["payload"] for s in sales])],
                "movements": [
                    {
                        "id": m["id"],
                        "number": m["number"],
                        "kind": m["payload"]["kind"],
                        "currency": m["payload"]["currency"],
                        "amountMinor": m["payload"]["amountMinor"],
                        "reason": m["payload"]["reason"],
                        "approvedBy": m["payload"]["approval"]["userId"] if m["payload"]["approval"] else None,
                        "at": m["deviceTime"],
                    }
                    for m in movements
                ],
            }
        )
        offline = sum(1 for d in docs if d["golden"].get("offline"))
        last = {}
        for d in docs:
            if d["number"]:
                last[d["number"].split("-")[0]] = d["number"]
        evidence[dev] = {
            "deviceCode": DEVICES[dev]["code"],
            "sent": len(docs),
            "accepted": len(docs),
            "duplicate": offline,
            "rejected": 0,
            "quarantined": 0,
            "lastAnnouncedNumber": last,
            "lastReceivedNumber": last,
        }

    for e in journal:
        assert balanced(e["lines"]), e
    tb = trial_balance(journal)
    assert tb["balanced"]

    # the same report the cash accounts give: Σ 1110 per currency = Σ expected cash − opening (no opening entry on day 1)
    day_report = {
        "date": BUSINESS_DATE,
        "baseCurrency": BASE,
        "invoiceCount": len(all_sales),
        "grossMinor": day["grossMinor"],
        "discountMinor": day["discountMinor"],
        "grossExTaxMinor": day["grossExTaxMinor"],
        "discountExTaxMinor": day["discountExTaxMinor"],
        "netExTaxMinor": day["netExTaxMinor"],
        "taxMinor": day["taxMinor"],
        "totalMinor": day["totalMinor"],
        "tipsMinor": day["tipsMinor"],
        "cashRoundingMinor": day["cashRoundingMinor"],
        "byMethod": by_method(all_sales),
        "byCashier": sorted(cashiers.values(), key=lambda c: c["userId"]),
    }
    stock_rows = [
        {"sku": sku, "variantId": f"@variant:{sku}", "openingQty": s["opening"], "soldQty": s["sold"], "closingQty": s["opening"] - s["sold"]}
        for sku, s in stock.items()
    ]
    cash_by_currency = defaultdict(lambda: {"amountMinor": 0, "baseMinor": 0})
    for e in journal:
        for ln in e["lines"]:
            if ln["accountCode"] == "1110":
                sign = 1 if ln["debitMinor"] else -1
                cash_by_currency[ln["currency"]]["amountMinor"] += sign * ln["amountMinor"]
                cash_by_currency[ln["currency"]]["baseMinor"] += ln["debitMinor"] - ln["creditMinor"]
    return {
        "about": "النتائج المتوقعة لليوم الذهبي، محسوبة بالحاسبة المستقلة golden/calc. لا تُعدَّل باليد.",
        "businessDate": BUSINESS_DATE,
        "baseCurrency": BASE,
        "dayReport": day_report,
        "invoices": invoices,
        "shifts": shifts,
        "stock": stock_rows,
        "journal": journal,
        "trialBalance": tb,
        "cashAccounts": dict(cash_by_currency),
        "evidence": evidence,
    }


def summary_line(expected: dict) -> str:
    d = expected["dayReport"]
    tb = expected["trialBalance"]
    return (
        f"{d['invoiceCount']} invoices, total {d['totalMinor']} SYP-minor, tax {d['taxMinor']}, "
        f"journal {len(expected['journal'])} entries, trial balance {tb['totals']} balanced={tb['balanced']}"
    )


if __name__ == "__main__":
    sys.exit(main())
