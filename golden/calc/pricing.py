"""The invoice, in the seven fixed steps of 10 › حساب الفاتورة (steps 1-5 here; 6-7 in settle.py).

1. line gross = price x quantity                       (rounded per line, half away from zero)
2. line discount (percent or amount), never above the line gross
3. the invoice discount is split over the lines in proportion to each line's net; the leftover
   qirsh go to the lines with the largest fraction, ties by the fixed line number (line_no)
4. tax per line on the net, or extracted from it when prices include tax; with inclusive prices
   the line also gets «الإجمالي قبل الضريبة» and «الخصم قبل الضريبة», the discount by SUBTRACTION
5. invoice total = sum of the line totals, exact, no cash rounding

Amounts are minor units of the invoice currency, quantities thousandths, rates basis points.
"""

from dataclasses import dataclass, field

from money import div_round, floor_and_fraction


@dataclass
class CartLine:
    line_no: int
    unit_price: int  # one pack in the invoice currency (minor)
    qty: int  # packs, thousandths
    tax_bp: int
    discount: dict | None = None  # {"type": "percent", "bp"} | {"type": "amount", "minor"}


@dataclass
class PricedLine:
    line_no: int
    gross: int
    line_discount: int
    share: int = 0
    net: int = 0
    tax: int = 0
    gross_ex_tax: int = 0
    discount_ex_tax: int = 0
    net_ex_tax: int = 0
    total: int = 0

    def as_payload(self) -> dict:
        return {
            "grossMinor": self.gross,
            "lineDiscountMinor": self.line_discount,
            "invoiceDiscountShareMinor": self.share,
            "netMinor": self.net,
            "taxMinor": self.tax,
            "grossExTaxMinor": self.gross_ex_tax,
            "discountExTaxMinor": self.discount_ex_tax,
            "netExTaxMinor": self.net_ex_tax,
            "totalMinor": self.total,
        }


@dataclass
class PricedInvoice:
    lines: list[PricedLine]
    invoice_discount: int
    totals: dict = field(default_factory=dict)


def discount_amount(base: int, discount: dict | None) -> int:
    """A percent discount is rounded once (half away from zero); an amount is taken as given; both capped at the base."""
    if discount is None:
        return 0
    if discount["type"] == "percent":
        amount = div_round(base * discount["bp"], 10_000)
    else:
        amount = discount["minor"]
    return max(0, min(amount, base))


def allocate(total: int, weights: list[tuple[int, int]]) -> dict[int, int]:
    """
    Splits `total` over (line_no, weight) in proportion to the weights (10 › step 3): every line
    gets the floor of its exact share, then the leftover units go one each to the lines with the
    largest fractional part; equal fractions go to the smaller line_no first.
    """
    out = {line_no: 0 for line_no, _ in weights}
    weight_sum = sum(w for _, w in weights)
    if total == 0 or weight_sum == 0:
        return out
    fractions = []
    for line_no, w in weights:
        whole, frac = floor_and_fraction(total * w, weight_sum)
        out[line_no] = whole
        fractions.append((frac, line_no))
    leftover = total - sum(out.values())
    # largest fraction first; ties by the smaller line number
    fractions.sort(key=lambda f: (-f[0], f[1]))
    for i in range(leftover):
        out[fractions[i][1]] += 1
    return out


def price_invoice(lines: list[CartLine], invoice_discount: dict | None, tax_inclusive: bool) -> PricedInvoice:
    priced: list[PricedLine] = []
    for line in sorted(lines, key=lambda l: l.line_no):
        gross = div_round(line.unit_price * line.qty, 1000)  # step 1
        ld = discount_amount(gross, line.discount)  # step 2
        priced.append(PricedLine(line_no=line.line_no, gross=gross, line_discount=ld))

    nets_before = [(p.line_no, p.gross - p.line_discount) for p in priced]
    inv_disc = discount_amount(sum(n for _, n in nets_before), invoice_discount)  # step 3
    shares = allocate(inv_disc, nets_before)

    by_no = {l.line_no: l for l in lines}
    for p in priced:
        bp = by_no[p.line_no].tax_bp
        p.share = shares[p.line_no]
        p.net = p.gross - p.line_discount - p.share
        if tax_inclusive:  # step 4, prices include tax: tax = net x r / (1 + r)
            p.tax = div_round(p.net * bp, 10_000 + bp)
            p.gross_ex_tax = p.gross - div_round(p.gross * bp, 10_000 + bp)
            p.net_ex_tax = p.net - p.tax
            p.discount_ex_tax = p.gross_ex_tax - p.net_ex_tax  # by subtraction, never by division
            p.total = p.net
        else:  # prices exclude tax: tax = net x r
            p.tax = div_round(p.net * bp, 10_000)
            p.gross_ex_tax = p.gross
            p.net_ex_tax = p.net
            p.discount_ex_tax = p.gross - p.net
            p.total = p.net + p.tax

    s = lambda attr: sum(getattr(p, attr) for p in priced)  # noqa: E731
    totals = {
        "grossMinor": s("gross"),
        "lineDiscountMinor": s("line_discount"),
        "invoiceDiscountMinor": s("share"),
        "discountMinor": s("line_discount") + s("share"),
        "netMinor": s("net"),
        "grossExTaxMinor": s("gross_ex_tax"),
        "discountExTaxMinor": s("discount_ex_tax"),
        "netExTaxMinor": s("net_ex_tax"),
        "taxMinor": s("tax"),
        "totalMinor": s("total"),  # step 5: exact, never cash-rounded
    }
    return PricedInvoice(lines=priced, invoice_discount=inv_disc, totals=totals)
