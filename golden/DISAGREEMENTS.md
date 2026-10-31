# Golden day: where the system and the sheet disagree

`apps/api/test/golden-day.test.ts` replays `golden/day1/scenario.json` through the real system and
compares it with `golden/day1/expected.json`. When the two disagree, neither is changed to match: the
difference is listed here with the spec quote, and the coordinator decides which side is right.

## Run of 2026-10-31 (main at 319987e, without the accounting step)

**No disagreement found** in what the system already does:

| Compared                                                                                        | Result                                                                           |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Push: 210 documents + 50 replays of the offline sales, shuffled, a shift close before its sales | 210 accepted, 50 duplicate, 0 rejected                                           |
| The server's own engine against the printed numbers (`totals_mismatch`)                         | 0 of 200 sales flagged (a sale altered by one qirsh is flagged: the check works) |
| Flags                                                                                           | only `approval_offline`, exactly on the documents with an offline approval       |
| 200 invoices: totals, tip, rounding, change; every line; every payment                          | equal to the qirsh                                                               |
| Stock of the 28 stocked products; the 2 services keep none                                      | equal                                                                            |
| Both shifts                                                                                     | closed, with their SFT numbers                                                   |

**Not compared yet:** the day report, the shift reports, the journal, the trial balance and the evidence
screen. Their routes come with the accounting step (Package A); the test skips them while the routes are
missing and runs them as soon as they are registered. Points where the system may legitimately read the
specs differently are in INTERPRETATIONS.md, items 10, 17–24 and 26 in particular.
