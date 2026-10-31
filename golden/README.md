# The golden day (phase 1)

23 › شرط العبور للمرحلة 1: a sale day written in advance, 200 invoices in both currencies (discounts,
split payments, rounding, 50 of them offline and sent twice), must match «ورقة النتائج» to the qirsh,
with balanced entries, nothing lost and nothing doubled.

This folder is that day and its results sheet, computed **independently of the product**: the calculator
is Python with `decimal` and the standard library only, written from specs 10, 23, 08 and 27. It never
imports or reads the product's pricing, sale, money or processor code; it reads
`packages/core/src/contracts/documents.ts` only for the shape of the documents it writes.

| Path                                  | What                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calc/`                               | The calculator: `money.py` (rounding, rates), `pricing.py` (10 › حساب الفاتورة 1–5), `settle.py` (6–7, currencies), `shifts.py`, `ledger.py`, `scenario.py` |
| `calc/build.py`                       | Regenerates everything in `day1/` from the fixed seed                                                                                                       |
| `calc/test_calc.py`                   | The worked examples of 10 and 23 literally, random-sale properties, the glossary, and the determinism of the files                                          |
| `day1/scenario.json`                  | The inputs: store, users, tax rates, 30 products, and the 210 documents of the two devices as they would send them, with the push order                     |
| `day1/expected.json`                  | The results: every invoice, the shifts, stock, journal entries, trial balance, day report and evidence counts                                               |
| `day1/results.xlsx`                   | The results sheet for the owner and the accountant, one tab per subject                                                                                     |
| `day1/RESULTS.md`                     | The same in Arabic for a shopkeeper: the summary, the first 10 invoices in full, the cash per shift, the trial balance                                      |
| `INTERPRETATIONS.md`                  | Every place the specs leave room, with the quote and the reading chosen                                                                                     |
| `DISAGREEMENTS.md`                    | Every difference between the system and the sheet, for the coordinator to decide                                                                            |
| `../apps/api/test/golden-day.test.ts` | The day replayed through the real routes and compared to the qirsh                                                                                          |

## Regenerate

```sh
python3 golden/calc/build.py                                   # writes golden/day1/*
python3 -m unittest discover -s golden/calc -p 'test_*.py'     # the calculator's own tests
pnpm --filter @serva/api exec vitest run test/golden-day.test.ts   # the replay through the system
```

The build is deterministic: the same seed writes the same bytes. `results.xlsx` needs `openpyxl`; the
JSON files and `RESULTS.md` do not. The generated files are excluded from Prettier and never edited by
hand: change the calculator or the scenario, then rebuild.

## Approval

23: «"ورقة النتائج" … يعتمدها المالك ومحاسب قبل بناء المرحلة». **The sheet is not a reference until the
owner and an accountant have approved it**: sign the «الاعتماد» tab of `results.xlsx` or tick the boxes at
the end of `RESULTS.md`. The points they must decide are marked [owner/accountant] in
INTERPRETATIONS.md. Once approved, the sheet is frozen: a later change of the specs makes a new day, it
does not edit this one.

If the system and the sheet disagree, **neither is changed to match**: the difference goes to
DISAGREEMENTS.md with the spec quote, and the coordinator decides.
