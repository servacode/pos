"""Builds the golden day's documents, deterministically, from a fixed seed (23 › 11 «يوم البيع المكتوب سلفاً»).

The documents are what the two cashier devices would send: the envelope of 17 › الإرسال and the
payloads of packages/core/src/contracts/documents.ts (read for the SHAPE only). Every amount a
device computes (priced lines, totals, payments, change, rounding, the shift close) is computed
here by this calculator, never by the product's engine.

Server-made ids (products, variants, tax rates, users) are placeholders such as "@variant:P01";
the replay test swaps them for the real ids before it computes each document's hash.
"""

import random
import uuid
from datetime import datetime, timedelta, timezone

from catalogue import (
    BASE,
    CASH_STEPS,
    CASHIER_DISCOUNT_LIMIT_BP,
    DEVICES,
    PRODUCT_BY_SKU,
    RATE_AFTERNOON,
    RATE_MORNING,
    RATE_SWITCH_UTC,
    SEED,
    STORE,
    TAX_RATES,
)
from money import convert, div_round, round_to_step
from pricing import CartLine, price_invoice
from settle import settle

UTC = timezone.utc
SALES_PER_DEVICE = 100
OFFLINE_RANGE = {"D1": range(41, 66), "D2": range(31, 56)}  # 25 sales each, by the device's sale number


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def at(hhmm: str) -> datetime:
    """A Damascus wall-clock time of the business day, as UTC (Damascus is UTC+3)."""
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 10, 30, h, m, tzinfo=UTC) - timedelta(hours=3)


def rate_at(dt: datetime) -> dict:
    switch = datetime.fromisoformat(RATE_SWITCH_UTC.replace("Z", "+00:00"))
    return RATE_MORNING if dt < switch else RATE_AFTERNOON


class Ids:
    """Deterministic UUIDv7s: the device time in the first 48 bits, the seed's randomness after."""

    def __init__(self, rng: random.Random):
        self.rng = rng

    def __call__(self, dt: datetime) -> str:
        ms = int(dt.timestamp() * 1000)
        rand = self.rng.getrandbits(74)
        value = (ms & ((1 << 48) - 1)) << 80
        value |= 0x7 << 76
        value |= ((rand >> 62) & 0xFFF) << 64
        value |= 0b10 << 62
        value |= rand & ((1 << 62) - 1)
        return str(uuid.UUID(int=value))


def doc_number(series: str, device: str, n: int) -> str:
    return f"{series}-{STORE['branchCode']}-{DEVICES[device]['code']}-{n:07d}"


def approval(dt: datetime, offline: bool) -> dict:
    return {"userId": "@user:manager", "method": "pin", "at": iso(dt), "offline": offline}


# ─── Sales ────────────────────────────────────────────────────────────────────


def sale_line(line_no: int, item: dict, rate: dict, dt: datetime, offline: bool) -> tuple[dict, CartLine]:
    prod = PRODUCT_BY_SKU[item["sku"]]
    pack = prod["pack"] if item.get("pack") else None
    pack_qty = pack["packQty"] if pack else 1000
    price_minor = pack["packPriceMinor"] if pack else prod["priceMinor"]
    unit_price = convert(price_minor, prod["priceCurrency"], BASE, rate if prod["priceCurrency"] != BASE else None)
    qty = item["qty"]
    discount = None
    cart_discount = None
    if "override" in item:  # a price typed in the cart is an amount discount (12 › قواعد السلة)
        minor = div_round((unit_price - item["override"]) * qty, 1000)
        over = minor * 10_000 > div_round(unit_price * qty, 1000) * CASHIER_DISCOUNT_LIMIT_BP
        discount = {
            "type": "amount",
            "minor": minor,
            "source": "price_override",
            "reason": "سعر متفق عليه مع الزبون",
            "approval": approval(dt, offline) if over else None,
        }
        cart_discount = {"type": "amount", "minor": minor}
    elif "discount" in item:
        d = item["discount"]
        if d["type"] == "percent":
            over = d["bp"] > CASHIER_DISCOUNT_LIMIT_BP
            discount = {"type": "percent", "bp": d["bp"], "source": "manual", "reason": d.get("reason"), "approval": None}
        else:
            gross = div_round(unit_price * qty, 1000)
            over = d["minor"] * 10_000 > gross * CASHIER_DISCOUNT_LIMIT_BP
            discount = {"type": "amount", "minor": d["minor"], "source": "manual", "reason": d.get("reason"), "approval": None}
        if over:
            discount["approval"] = approval(dt, offline)
            discount["reason"] = discount["reason"] or "زبون دائم"
        cart_discount = {k: v for k, v in d.items() if k in ("type", "bp", "minor")}
    tax = TAX_RATES[prod["tax"]] if prod["tax"] else None
    name = prod["nameAr"] + (f" - {pack['packName']}" if pack else "")
    line = {
        "lineNo": line_no,
        "productId": f"@product:{prod['sku']}",
        "variantId": f"@variant:{prod['sku']}",
        "name": name,
        "unitName": "كغ" if prod["unit"] == "kg" else None,
        "barcode": pack["barcode"] if pack else prod["barcode"],
        "packQty": pack_qty,
        "qty": qty,
        "baseQty": div_round(qty * pack_qty, 1000),
        "priceCurrency": prod["priceCurrency"],
        "priceMinor": price_minor,
        "unitPriceMinor": unit_price,
        "taxRateId": f"@tax:{prod['tax']}" if prod["tax"] else None,
        "taxRateBp": tax["rateBp"] if tax else 0,
        "discount": discount,
        "priced": None,
    }
    return line, CartLine(line_no, unit_price, qty, line["taxRateBp"], cart_discount)


def build_sale(spec: dict, dt: datetime, offline: bool) -> dict:
    rate = rate_at(dt)
    lines, cart = [], []
    for i, item in enumerate(spec["items"], start=1):
        line, cl = sale_line(i, item, rate, dt, offline)
        lines.append(line)
        cart.append(cl)
    inv = spec.get("invoiceDiscount")
    priced = price_invoice(cart, {k: v for k, v in inv.items() if k in ("type", "bp", "minor")} if inv else None, STORE["taxInclusive"])
    for line, pl in zip(lines, priced.lines):
        line["priced"] = pl.as_payload()
    invoice_discount = None
    if inv:
        over = (inv["type"] == "percent" and inv["bp"] > CASHIER_DISCOUNT_LIMIT_BP) or (
            inv["type"] == "amount" and inv["minor"] * 10_000 > priced.totals["netMinor"] * CASHIER_DISCOUNT_LIMIT_BP
        )
        invoice_discount = {
            **{k: v for k, v in inv.items() if k in ("type", "bp", "minor")},
            "source": "manual",
            "reason": inv.get("reason", "خصم على الفاتورة"),
            "approval": approval(dt, offline) if over else None,
        }
    total = priced.totals["totalMinor"]
    tip = spec.get("tip", 0)
    tenders, change_currency = spec["tenders"](total + tip, rate)
    st = settle(BASE, total, tip, tenders, change_currency, {"USD": rate}, CASH_STEPS)
    return {
        "shiftId": None,  # filled by the caller
        "cashierId": None,
        "salespersonId": None,
        "customerId": None,
        "customerName": None,
        "currency": BASE,
        "taxInclusive": STORE["taxInclusive"],
        "exchangeRates": [rate],
        "lines": lines,
        "invoiceDiscount": invoice_discount,
        "totals": priced.totals,
        "tipMinor": tip,
        "payments": st.payments,
        "change": st.change,
        "cashRounding": st.cash_rounding,
        "note": None,
    }


# ─── Tender patterns: what the customer hands over, given what is due ───────


def syp_due(remaining: int) -> int:
    return round_to_step(remaining, CASH_STEPS["SYP"])


def usd_rate_minor(rate: dict) -> int:
    """Pounds-minor for one dollar bill (100 cents)."""
    return convert(100, "USD", "SYP", rate)


class Tenders:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.ref = 0

    def _ref(self, prefix: str) -> str:
        self.ref += 1
        return f"{prefix}{self.ref:06d}"

    def card(self, amount: int) -> dict:
        return {
            "method": "card",
            "currency": "SYP",
            "amountMinor": amount,
            "reference": self._ref("AP"),
            "cardLast4": f"{self.rng.randint(0, 9999):04d}",
            "cardBrand": self.rng.choice(["Visa", "MasterCard"]),
        }

    def wallet(self, amount: int) -> dict:
        return {"method": "wallet", "currency": "SYP", "amountMinor": amount, "reference": self._ref("SC")}

    @staticmethod
    def cash(currency: str, amount: int) -> dict:
        return {"method": "cash", "currency": currency, "amountMinor": amount}

    def note_above(self, due: int) -> int:
        """What a customer hands over for `due` pounds-minor: the exact amount or a round note above it."""
        options = [due]
        for unit in (5_000, 10_000, 50_000, 100_000, 500_000):
            up = -(-due // unit) * unit
            if up > due:
                options.append(up)
        return self.rng.choice(sorted(set(options))[:4])

    def pattern(self, name: str):
        rng = self.rng

        def run(due: int, rate: dict):
            bill = usd_rate_minor(rate)
            if name == "cash_exact":
                return [self.cash("SYP", syp_due(due))], "SYP"
            if name == "cash_note":
                return [self.cash("SYP", self.note_above(syp_due(due)))], "SYP"
            if name == "card":
                return [self.card(due)], "SYP"
            if name == "wallet":
                return [self.wallet(due)], "SYP"
            if name == "card_cash":
                part = (due // 2) // 10_000 * 10_000
                return [self.card(part), self.cash("SYP", self.note_above(syp_due(due - part)))], "SYP"
            if name == "usd_syp":
                k = max(1, (due - 1) // bill)
                if k * bill >= due:
                    k -= 1
                rest = due - k * bill
                return [self.cash("USD", k * 100), self.cash("SYP", self.note_above(syp_due(rest)))], "SYP"
            if name == "usd_over_syp_change":
                k = -(-due // bill) + rng.choice([0, 0, 1])
                return [self.cash("USD", k * 100)], "SYP"
            if name == "usd_over_usd_change":
                exact = convert(due, "SYP", "USD", rate)
                usd_due = round_to_step(exact, CASH_STEPS["USD"])
                tender = -(-usd_due // 100) * 100
                if tender == usd_due:
                    tender += 100
                tender += rng.choice([0, 0, 500, 1000])
                return [self.cash("USD", tender)], "USD"
            if name == "usd_exact":
                exact = convert(due, "SYP", "USD", rate)
                return [self.cash("USD", round_to_step(exact, CASH_STEPS["USD"]))], "USD"
            if name == "split4":
                card = (due // 4) // 10_000 * 10_000
                wallet = (due // 4) // 10_000 * 10_000
                rest = due - card - wallet
                k = max(1, rest // 2 // bill)
                rest2 = rest - k * bill
                return (
                    [
                        self.cash("USD", k * 100),
                        self.card(card),
                        self.wallet(wallet),
                        self.cash("SYP", self.note_above(syp_due(rest2))),
                    ],
                    "SYP",
                )
            if name == "wallet_usd":
                wallet = (due // 2) // 10_000 * 10_000
                k = -(-(due - wallet) // bill)
                return [self.wallet(wallet), self.cash("USD", k * 100)], "SYP"
            if name == "first_sale":  # 23 › 3: 9 $ at 130, then a 200-pound note
                return [self.cash("USD", 900), self.cash("SYP", 20_000)], "SYP"
            if name == "card_with_tip":
                return [self.card(due)], "SYP"
            raise ValueError(name)

        return run


# minimum amount due (pounds-minor) each pattern needs to make sense
PATTERN_MIN_DUE = {
    "card_cash": 300_000,
    "usd_syp": 400_000,
    "split4": 1_200_000,
    "wallet_usd": 500_000,
    "usd_over_usd_change": 50_000,
    "usd_exact": 50_000,
}

PATTERN_COUNTS = {
    "cash_exact": 30,
    "cash_note": 50,
    "card": 20,
    "wallet": 15,
    "card_cash": 12,
    "usd_syp": 18,
    "usd_over_syp_change": 15,
    "usd_over_usd_change": 10,
    "usd_exact": 8,
    "split4": 12,
    "wallet_usd": 9,
}

WEIGHED = ["P11", "P12", "P13", "P14"]
WEIGHTS = [250, 333, 500, 735, 1000, 1250, 1500, 2000]
CAFE = ["P25", "P26", "P27", "P28", "P29"]


def random_items(rng: random.Random) -> list[dict]:
    skus = [s for s in PRODUCT_BY_SKU]
    items = []
    for _ in range(rng.choice([1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6])):
        sku = rng.choice(skus)
        item = {"sku": sku}
        if sku in WEIGHED:
            item["qty"] = rng.choice(WEIGHTS)
        elif sku == "P15" and rng.random() < 0.35:
            item["pack"] = True
            item["qty"] = rng.choice([1000, 1000, 2000])
        else:
            item["qty"] = rng.choice([1000, 1000, 1000, 2000, 2000, 3000, 4000])
        r = rng.random()
        if r < 0.06:
            item["discount"] = {"type": "percent", "bp": rng.choice([500, 1000])}
        elif r < 0.09:
            item["discount"] = {"type": "percent", "bp": 1500, "reason": "عبوة متضررة"}
        elif r < 0.13:
            item["discount"] = {"type": "amount", "minor": rng.choice([500, 1_000, 2_500, 5_000])}
        elif r < 0.17 and sku not in WEIGHED and PRODUCT_BY_SKU[sku]["priceCurrency"] == "SYP":
            price = PRODUCT_BY_SKU[sku]["priceMinor"]
            if item.get("pack"):
                price = PRODUCT_BY_SKU[sku]["pack"]["packPriceMinor"]
            typed = price * 9 // 10 // 500 * 500
            if 0 < typed < price:
                item["override"] = typed
        items.append(item)
    return items


def sale_specs(rng: random.Random) -> dict[str, list[dict]]:
    names = [n for n, c in PATTERN_COUNTS.items() for _ in range(c)]
    rng.shuffle(names)
    specs: dict[str, list[dict]] = {"D1": [], "D2": []}
    # 23 › 3: the first sale, exactly (water x3, laban, tea -10%, sugar; the biscuit was removed)
    specs["D1"].append(
        {
            "items": [
                {"sku": "P01", "qty": 3000},
                {"sku": "P03", "qty": 1000},
                {"sku": "P04", "qty": 1000, "discount": {"type": "percent", "bp": 1000}},
                {"sku": "P05", "qty": 1000},
            ],
            "pattern": "first_sale",
            "tag": "23 › 3: أول بيع",
        }
    )
    # the tie in the invoice-discount split (23 › كتالوج الحالات الحدّية: «تعادل في توزيع الخصم»)
    specs["D1"].append(
        {
            "items": [{"sku": "P04", "qty": 1000}, {"sku": "P04", "qty": 1000}],
            "invoiceDiscount": {"type": "amount", "minor": 5, "reason": "تعادل في توزيع الخصم"},
            "pattern": "cash_note",
            "tag": "تعادل في توزيع خصم الفاتورة",
        }
    )
    # 0.333 kg (23 › الحالات الحدّية «كمية 0.333»)
    specs["D2"].append(
        {"items": [{"sku": "P13", "qty": 333}, {"sku": "P14", "qty": 735}], "pattern": "cash_exact", "tag": "كمية 0.333"}
    )
    # a café order with a tip, all by card (10: «إكرامية … 1140 / 2550»)
    specs["D2"].append(
        {
            "items": [{"sku": "P26", "qty": 2000}, {"sku": "P28", "qty": 2000}],
            "tip": 10_000,
            "pattern": "card_with_tip",
            "tag": "إكرامية بالبطاقة",
        }
    )
    tip_slots = 0
    i = 0
    while len(specs["D1"]) + len(specs["D2"]) < 2 * SALES_PER_DEVICE:
        name = names[i]
        i += 1
        dev = "D1" if len(specs["D1"]) < SALES_PER_DEVICE and (len(specs["D2"]) >= SALES_PER_DEVICE or rng.random() < 0.5) else "D2"
        items = random_items(rng)
        spec = {"items": items, "pattern": name}
        if rng.random() < 0.10:
            spec["invoiceDiscount"] = rng.choice(
                [
                    {"type": "percent", "bp": 500},
                    {"type": "percent", "bp": 1200, "reason": "زبون جملة"},
                    {"type": "amount", "minor": 2_500},
                    {"type": "amount", "minor": 10_000},
                ]
            )
        if tip_slots < 3 and any(it["sku"] in CAFE for it in items) and name in ("cash_note", "card", "split4"):
            spec["tip"] = rng.choice([5_000, 10_000])
            tip_slots += 1
        specs[dev].append(spec)
    return specs


# ─── The day ──────────────────────────────────────────────────────────────────


def build_day() -> dict:
    rng = random.Random(SEED)
    new_id = Ids(random.Random(SEED + 1))
    tenders = Tenders(random.Random(SEED + 2))
    specs = sale_specs(rng)

    plans = {
        "D1": {
            "cashier": "@user:cashier1",
            "open": at("08:00"),
            "firstSale": at("08:10"),
            "lastSale": at("20:30"),
            "close": at("21:00"),
            "opening": {"SYP": 25_000_000, "USD": 10_000},
            "movements": [
                ("10:30", "pay_in", "SYP", 10_000_000, None, "فكّة من الخزنة"),
                ("12:15", "expense", "SYP", 250_000, "6105", "أجرة نقل بضاعة"),
                ("16:00", "pay_out", "USD", 5_000, None, "تسليم دولار للخزنة"),
            ],
            "countedDifference": {"SYP": 100_000, "USD": 0},  # +1,000 ل.س (23 › 4)
        },
        "D2": {
            "cashier": "@user:cashier2",
            "open": at("09:00"),
            "firstSale": at("09:05"),
            "lastSale": at("20:40"),
            "close": at("21:15"),
            "opening": {"SYP": 15_000_000, "USD": 5_000},
            "movements": [
                ("13:00", "pay_out", "SYP", 5_000_000, None, "سحب للخزنة بطلب المدير"),
                ("15:30", "pay_in", "USD", 2_000, None, "فكّة دولار من الخزنة"),
                ("18:30", "safe_drop", "SYP", 20_000_000, None, "الدرج ممتلئ"),
            ],
            "countedDifference": {"SYP": -50_000, "USD": 0},  # −500 ل.س
        },
    }

    devices = {}
    for dev, plan in plans.items():
        docs = []  # (time, type, payload, extra)
        shift_id = new_id(plan["open"])
        docs.append(
            {
                "id": shift_id,
                "time": plan["open"],
                "type": "shift_open",
                "payload": {
                    "openedBy": plan["cashier"],
                    "mode": "per_cashier",
                    "handoverFromShiftId": None,
                    "opening": [
                        {"currency": c, "amountMinor": a, "denominations": None} for c, a in plan["opening"].items()
                    ],
                },
            }
        )
        n = len(specs[dev])
        span = (plan["lastSale"] - plan["firstSale"]) / (n - 1)
        for k, spec in enumerate(specs[dev], start=1):
            dt = plan["firstSale"] + span * (k - 1) + timedelta(seconds=rng.randint(0, 50))
            dt = dt.replace(microsecond=rng.randint(0, 999) * 1000)
            offline = k in OFFLINE_RANGE[dev]
            pattern = tenders.pattern(spec["pattern"])
            spec = {**spec, "tenders": pattern}
            min_due = PATTERN_MIN_DUE.get(spec["pattern"], 0)
            if min_due:
                rate = rate_at(dt)
                while True:
                    probe = build_sale({**spec, "tenders": lambda due, r: ([tenders.cash("SYP", syp_due(due) + 10_000_000)], "SYP")}, dt, offline)
                    if probe["totals"]["totalMinor"] + spec.get("tip", 0) >= min_due:
                        break
                    spec["items"].append({"sku": "P07", "qty": 1000})
            payload = build_sale(spec, dt, offline)
            payload["shiftId"] = shift_id
            payload["cashierId"] = plan["cashier"]
            docs.append(
                {
                    "id": new_id(dt),
                    "time": dt,
                    "type": "sale",
                    "payload": payload,
                    "offline": offline,
                    "pattern": spec["pattern"],
                    "tag": spec.get("tag"),
                }
            )
        for hhmm, kind, currency, amount, account, reason in plan["movements"]:
            dt = at(hhmm)
            rate = None if currency == BASE else rate_at(dt)
            docs.append(
                {
                    "id": new_id(dt),
                    "time": dt,
                    "type": "cash_movement",
                    "payload": {
                        "shiftId": shift_id,
                        "kind": kind,
                        "currency": currency,
                        "amountMinor": amount,
                        "baseCurrency": BASE,
                        "rate": rate,
                        "baseAmountMinor": convert(amount, currency, BASE, rate),
                        "reason": reason,
                        "expenseAccountCode": account,
                        "reference": None,
                        "performedBy": plan["cashier"],
                        "approval": approval(dt, False),
                    },
                }
            )
        docs.sort(key=lambda d: d["time"])
        docs.append({"id": new_id(plan["close"]), "time": plan["close"], "type": "shift_close", "payload": None})
        devices[dev] = {"plan": plan, "docs": docs, "shiftId": shift_id}

    # numbering and envelopes, in each device's creation order (08 › الترقيم)
    for dev, d in devices.items():
        counters: dict[str, int] = {}
        for seq, doc in enumerate(d["docs"], start=1):
            series = {"sale": "INV", "shift_open": "SFT", "cash_movement": "CSH"}.get(doc["type"])
            if series:
                counters[series] = counters.get(series, 0) + 1
                doc["number"] = doc_number(series, dev, counters[series])
            else:
                doc["number"] = None
            doc["seq"] = seq
        d["lastIssued"] = counters
    return {"devices": devices, "plans": plans}
