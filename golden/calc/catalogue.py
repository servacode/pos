"""The golden store: one store, one branch, two devices, about thirty products (23 › بيانات الاختبار).

Prices are minor units (2 decimals) in the product's own currency. Weighed products are sold by the
kilo in thousandths; stock is in base units, thousandths (10 pieces = 10000, 12.5 kg = 12500).
"""

BUSINESS_DATE = "2026-10-30"
TIMEZONE = "Asia/Damascus"  # UTC+3 all year since 2022
BASE = "SYP"
SEED = 20261030

# The day's two rates (23 › 11: «بسعرين للصرف خلال اليوم»); the first is 23's demo rate 130.
RATE_MORNING = {"unit": "USD", "quote": "SYP", "rate": "130"}
RATE_AFTERNOON = {"unit": "USD", "quote": "SYP", "rate": "132"}
RATE_SWITCH_UTC = "2026-10-30T11:00:00.000Z"  # 14:00 in Damascus

# 10 › تمثيل المال: «خطوة تقريب النقد … مثل 5 أو 10 ليرات، وربع دولار»
CASH_STEPS = {"SYP": 1000, "USD": 25}

STORE = {"name": "ماركت الشام", "branchCode": "001", "taxInclusive": True}

DEVICES = {
    "D1": {"code": "001", "name": "كاشير 1"},
    "D2": {"code": "002", "name": "كاشير 2"},
}

USERS = {
    "owner": {"fullName": "أحمد الخطيب", "role": "owner"},
    "manager": {"fullName": "خالد العلي", "role": "manager", "phone": "0933000001"},
    "cashier1": {"fullName": "سامر حداد", "role": "cashier", "phone": "0933000002"},
    "cashier2": {"fullName": "ريم الأحمد", "role": "cashier", "phone": "0933000003"},
}

# Tax rates (10 › نموذج الضرائب السوري; 27). The only fee a market's café corner may carry today
# is the consumption spending fee (رسم الإنفاق الاستهلاكي, 2210); 15% is the illustration rate of
# 10's worked example. T0 is the same fee «خاضع بنسبة صفر» for bakery items.
TAX_RATES = {
    "T15": {"name": "رسم الإنفاق الاستهلاكي 15%", "rateBp": 1500, "kind": "consumption"},
    "T0": {"name": "رسم الإنفاق الاستهلاكي بنسبة صفر", "rateBp": 0, "kind": "consumption"},
}


def p(sku, name, price, currency="SYP", unit="piece", tax=None, kind="stock", stock=0, pack=None, barcode=None):
    return {
        "sku": sku,
        "nameAr": name,
        "priceCurrency": currency,
        "priceMinor": price,
        "unit": unit,
        "tax": tax,
        "type": kind,
        "openingStock": stock if kind == "stock" else None,
        "barcode": barcode or f"62100000{int(sku[1:]):05d}",
        "pack": pack,
    }


PRODUCTS = [
    # 23 › 3: the first-sale products, at the very prices of the scenario
    p("P01", "ماء 1.5 لتر", 5_000, stock=200_000),
    p("P02", "بسكويت", 7_500, stock=150_000),
    p("P03", "لبن", 32_500, stock=120_000),
    p("P04", "شاي", 60_000, stock=100_000),
    p("P05", "سكر 1 كغ", 27_500, stock=150_000),
    # groceries
    p("P06", "رز بسمتي 1 كغ", 145_000, stock=80_000),
    p("P07", "زيت دوار الشمس", 290_000, stock=150_000),
    p("P08", "معكرونة", 21_000, stock=120_000),
    p("P09", "عدس أحمر", 38_550, stock=90_000),
    p("P10", "حمص معلّب", 23_975, stock=100_000),
    # weighed, sold by the kilo
    p("P11", "جبنة بيضاء", 260_000, unit="kg", stock=40_000),
    p("P12", "زيتون أخضر", 180_000, unit="kg", stock=35_000),
    p("P13", "بندورة", 18_000, unit="kg", stock=120_000),
    p("P14", "تفاح", 42_000, unit="kg", stock=90_000),
    # a can sold alone or by the carton of 12 (09 › معامل العبوة)
    p(
        "P15",
        "كولا علبة",
        12_000,
        stock=480_000,
        pack={"packQty": 12_000, "packName": "كرتونة 12", "packPriceMinor": 135_000, "barcode": "16210000000159"},
    ),
    p("P16", "مناديل", 9_500, stock=150_000),
    p("P17", "صابون", 16_025, stock=100_000),
    p("P18", "شامبو", 97_500, stock=60_000),
    p("P19", "معجون أسنان", 31_000, stock=80_000),
    p("P20", "بن محمّص 250 غ", 115_000, stock=50_000),
    # priced in dollars, sold in pounds at the sale's rate (10 › التسعير بعملة والبيع بأخرى)
    p("P21", "سماعات أذن", 1_200, currency="USD", stock=60_000),
    p("P22", "شاحن جوال", 750, currency="USD", stock=60_000),
    p("P23", "بطارية متنقلة", 1_825, currency="USD", stock=50_000),
    p("P24", "كابل شحن", 340, currency="USD", stock=80_000),
    # the café corner: the consumption fee at 15% (prices include it)
    p("P25", "قهوة إسبريسو", 15_000, tax="T15", kind="service"),
    p("P26", "كابتشينو", 22_500, tax="T15", kind="service"),
    p("P27", "عصير برتقال طازج", 30_000, tax="T15", stock=60_000),
    # bakery: the fee at a zero rate
    p("P28", "كرواسان", 17_500, tax="T0", stock=100_000),
    p("P29", "كعكة بالسمسم", 2_650, tax="T0", stock=200_000),
    p("P30", "شوكولا", 13_500, stock=120_000),
]

PRODUCT_BY_SKU = {prod["sku"]: prod for prod in PRODUCTS}

# The role's limit for a discount without a manager (11 › ما يحتاج موافقة): above it the payload
# carries the manager's approval. The value is the scenario's, not a rule from the specs.
CASHIER_DISCOUNT_LIMIT_BP = 1000
