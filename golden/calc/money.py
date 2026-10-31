"""Money arithmetic for the golden calculator, written from spec 10 alone.

10 › تمثيل المال والكميات:
- amounts are integers in the smallest unit of their currency (SYP and USD both have 2 decimals);
- quantities are thousandths (0.250 kg = 250), percentages are basis points (15% = 1500);
- one direct rate per pair: how many pounds for one dollar; converting to the dollar DIVIDES by
  that rate, never multiplies by its inverse;
- rounding is «half away from zero» (2.5 -> 3, -2.5 -> -3).

Everything here uses decimal.Decimal with a wide context, never floats.
"""

from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, getcontext

getcontext().prec = 60

# Decimal's ROUND_HALF_UP is "ties away from zero" (2.5 -> 3, -2.5 -> -3): exactly 10's rule.
HALF_AWAY = ROUND_HALF_UP

DECIMALS = {"SYP": 2, "USD": 2}


def round_half_away(value: Decimal) -> int:
    """Rounds a Decimal to the nearest integer, ties away from zero."""
    return int(value.quantize(Decimal(1), rounding=HALF_AWAY))


def div_round(numerator: int, denominator: int) -> int:
    """numerator / denominator, exact, then rounded once half away from zero."""
    if denominator == 0:
        raise ZeroDivisionError("division by zero")
    return round_half_away(Decimal(numerator) / Decimal(denominator))


def floor_and_fraction(numerator: int, denominator: int) -> tuple[int, Decimal]:
    """Floor of a non-negative quotient and its exact fractional part."""
    q = Decimal(numerator) / Decimal(denominator)
    whole = int(q.to_integral_value(rounding=ROUND_FLOOR))
    return whole, q - whole


def convert(amount: int, from_currency: str, to_currency: str, rate: dict | None) -> int:
    """
    Converts minor units with a direct rate {unit, quote, rate}: one `unit` is worth `rate` units of
    `quote`. unit -> quote multiplies; quote -> unit divides (10: «التحويل إلى الدولار يقسم على هذا
    السعر ولا يضرب في مقلوبه»). One rounding, half away from zero.
    """
    if from_currency == to_currency:
        return amount
    if rate is None:
        raise ValueError(f"no rate for {from_currency}->{to_currency}")
    r = Decimal(rate["rate"])
    scale = Decimal(10) ** (DECIMALS[to_currency] - DECIMALS[from_currency])
    if rate["unit"] == from_currency and rate["quote"] == to_currency:
        return round_half_away(Decimal(amount) * r * scale)
    if rate["unit"] == to_currency and rate["quote"] == from_currency:
        return round_half_away(Decimal(amount) / r * scale)
    raise ValueError(f"rate {rate} does not pair {from_currency} and {to_currency}")


def round_to_step(amount: int, step: int) -> int:
    """Nearest multiple of the cash step, ties away from zero; step 0 = no rounding."""
    if step == 0:
        return amount
    return round_half_away(Decimal(amount) / Decimal(step)) * step


def fmt(minor: int, decimals: int = 2) -> str:
    """12345 -> '123.45' with thousands separators (for the sheets only)."""
    sign = "-" if minor < 0 else ""
    minor = abs(minor)
    whole, frac = divmod(minor, 10**decimals)
    return f"{sign}{whole:,}.{frac:0{decimals}d}"


def fmt_qty(thousandths: int) -> str:
    whole, frac = divmod(thousandths, 1000)
    return f"{whole}" if frac == 0 else f"{whole}.{frac:03d}"
