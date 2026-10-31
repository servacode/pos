# Step 6 contract: the setup wizard, subscription payment, and the platform panel

Phase 1, scenarios 1, 6 and 7 of `23 › المرحلة 1`. The server, the store screens and the platform panel are built from this contract. The code is the reference and this page is the map. Spec tabs are cited as `NN › section`. Each contract file starts with its route list, with the permission, the input schema and the answer type for every route.

## At a glance

| What                                                                                                                                                                         | Where                                       | Used by                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Sectors (family, icon, suggested features in order, sample items), the 23 feature switches, `suggestFeatures`, `featuresToOffer`, `needsTaxNotice`                           | `packages/core/src/sectors.ts`              | server, web            |
| Wizard routes, `currentOnboardingStep`, `priceDemoSale`, the starter catalogue, `PATCH /v1/settings/features`, governorates, the shop phone and colour checks                | `packages/core/src/contracts/onboarding.ts` | server, store screens  |
| `POST /v1/uploads` for the logo and the receipt, `sniffImageType`, `base64DecodedLength`                                                                                     | `packages/core/src/contracts/uploads.ts`    | server, store screens  |
| Subscription, plans, payment accounts, invoices, payments, `subscriptionState`, `allowedWhenReadOnly`, amounts and periods, `normalizeTransactionNumber`                     | `packages/core/src/contracts/billing.ts`    | server, store screens  |
| Platform gate, stores, payments queue, plans, billing rate, payment accounts, approvals, agents, audit log, team                                                             | `packages/core/src/contracts/platform.ts`   | server, platform panel |
| `store.setup` (owner only); `PLATFORM_PERMISSIONS`, `PLATFORM_ROLE_PERMISSIONS`, `platformCan`                                                                               | `packages/core/src/permissions.ts`          | server, both UIs       |
| `read_only` (403), `duplicate_transaction` (409), `awaiting_second_approval` (202 status)                                                                                    | `packages/core/src/contracts/errors.ts`     | server, both UIs       |
| Additive fields: `registerStoreInput.agentVia`, optional `MeResponse.subscription.state/access/provisionalUntil`, `MeResponse.onboarding`, `.features`; `isDemo` on products | `contracts/auth.ts`, `contracts/catalog.ts` | server, web            |

### Store routes

- **Wizard:** `GET /v1/catalog/sectors`, then `GET /v1/onboarding`. Next come `PUT /v1/onboarding/business`, `/features`, `/store` and `/currency`. Each of these takes its fields or `{ "skip": true }`. Then `POST /v1/onboarding/demo-sale`, `GET /v1/catalog/starter?sector=`, `POST /v1/onboarding/starter-catalog` (`items`, `demo` or `clear_demo`), `POST /v1/onboarding/complete` and `PATCH /v1/settings/features`.
- **Billing** (every route needs `subscription.manage`): `GET /v1/subscription`, `GET /v1/subscription/plans`, `GET /v1/payment-methods`, `GET` and `POST /v1/subscription/invoices`, `GET /v1/subscription/invoices/{id}`, `POST /v1/subscription/invoices/{id}/payments` and `GET /v1/subscription/payments`.
- **Files:** `POST /v1/uploads` (base64 JSON; route body limit 3 MB) and `GET /v1/uploads/{id}`.

### Platform routes (`/v1/platform/*`)

- **Sign-in:** `auth/login`, then `auth/totp`, `auth/refresh`, `auth/logout` and `me`.
- **Stores:** `stores` (filters), `stores/{id}`, and `/extend`, `/suspend`, `/resume` and `/notes`.
- **Payments:** `payments` (pending first), `payments/{id}`, and `/receipt`, `/confirm`, `/reject` and `/unconfirm`.
- **Plans and accounts:** `plans` (GET, POST, PATCH), `billing-rate` (GET, PUT), `payment-methods` (GET, POST, PATCH) and `approvals` (with `/approve` and `/cancel`).
- **Agents and the log:** `agents` (GET, POST, PATCH), `audit-logs` and `team`.
- **Public:** `GET /v1/public/agents/{code}`.

## The flows in one line each

- **Wizard (04):** each step is saved on its own. It opens at the first step neither saved nor skipped. «complete» fills the defaults (a general store, the suggested features, the sign-up name, pounds with dollar prices at the platform rate, tax inclusive) and returns the summary. After that, every wizard write returns 409 `conflict` and changes go through the settings.
- **Adding a sector later:** `PATCH /v1/settings/features` answers `offers`, the added sectors' features that are not on yet. Nothing is switched on or off by itself, and nothing is deleted.
- **Paying (23 › 6):**
  - Plan and cycle (yearly by default) → invoice `SUB-YYYY-NNNNNN`, in USD and in SYP at the weekly rate, valid 7 days.
  - Upload the receipt → submit the account, transaction number and upload → payment `SBP-…` `pending` «بانتظار التأكيد», and `provisionalUntil` = +72 h.
  - The platform confirms → active for `paidPeriodOnConfirm` (starting at the trial or period end), grace = end + 7 days. Or the platform rejects with a reason, and the provisional activation ends.
- **Read-only (07, 12, 24):** `subscriptionState` decides. Every GET works (browsing, reports, exports). Writes outside `READ_ONLY_ALLOWED_WRITES` answer 403 `read_only`. The exceptions are signing in, paying, legal accept, revoking a device, staff sign-in and the device sync. The push is always accepted, flagged `license_expired` when late. Nothing is deleted.
- **Extend (23 › 6):** `extendEnd` adds days to the current end, or to now if it has passed. 30 + 10 = 40, for that store only.

## Decisions

1. **One state function for everyone.**
   - `subscriptionState(dates, now)` → `trialing | provisional | active | grace | read_only | suspended | cancelled`, plus `access`.
   - The server's guard, `/v1/subscription`, `/v1/me` and the platform list all use it. The DB enum stays as it is.
   - A platform suspension makes the store read-only, not locked out: the owner still signs in and exports (07, 24 › 21). The session gate must stop refusing suspended stores at sign-in.
2. **Transaction numbers are unique across all stores and all methods.**
   - `normalizeTransactionNumber` decides equality: upper case, Latin digits, separators dropped, a loop rather than a regex.
   - The DB holds it with a unique index. The only reuse allowed is the same store resubmitting a number of its own rejected payment.
3. **Provisional activation ships now** (17, 12 and the PlanPay board show it in phase 1). It is granted once per invoice period, and never to a store with a rejected payment (07).
4. **Invoices:** one open invoice per store. A new one voids the others, except one for the same plan and cycle that is still within its price validity, which is reused (200). A payment on an invoice whose price has expired is accepted and flagged `price_expired`, because the owner may have paid on the last day.
5. **SYP amounts** = the exact conversion at the weekly rate, rounded to whole pounds (`subscriptionSypAmount`). The rate itself is the "easy number" of 07.
6. **Uploads are base64 JSON**, with no multipart.
   - The type is checked from the first bytes: JPEG, PNG or WebP. Never SVG.
   - Logos up to 512 KB; receipts up to 2 MB (the web shrinks photos first).
   - Files are stored at `UPLOAD_DIR/<tenant>/<uploadId>`, and the path holds nothing the client sent.
   - The SHA-256 lets the queue flag a receipt image reused for another payment.
7. **Feature switches and plan entitlements are different lists.** `FEATURES` (sectors.ts) show or hide screens. `PLAN_FEATURES` (billing.ts) say what a plan pays for after the trial. The seeded plans' keys are kept.
8. **Suggestions:** each chosen sector's ordered list, taken in the order the sectors were chosen, capped at six (04: «ست ميزات»).
   - Café + bakery gives exactly the design board's six.
   - A quick-service restaurant drops `tables`.
   - Wholesale must acknowledge the e-invoicing notice (07).
9. **The sector catalogue lives in code until the platform's sectors editor exists** (17: phase 5). This covers the sample items with their pound prices for the trial sale. `GET /v1/catalog/sectors` serves it unchanged, so moving it to the DB changes no client.
10. **The trial sale makes no product.** It prices the sector's sample items with the shared `priceDemoSale`, is not numbered and never enters the books. The optional demo data is a separate action, which adds products flagged `isDemo`.
11. **The platform gate is separate** (16, 17):
    - its own audience `serva-platform`;
    - the cookie `serva_prt` on `/v1/platform/auth`;
    - access tokens last 10 min; sign-in ends after 30 min idle and 12 h at most;
    - VPN-only routes (`PLATFORM_ALLOWED_CIDRS`).
12. **2FA is TOTP for now** (RFC 6238, codes used once), with 10 one-time recovery codes. A fresh TOTP (`totp` field) is needed to change a receiving account, approve, or unconfirm a payment.
13. **Two-person rule for receiving accounts** (13, 16):
    - Creating an account, or changing its number, QR, holder, bank, instructions or switching it on, answers 202 `{ status: 'awaiting_second_approval', approval }`.
    - The change applies when another super admin approves, or by itself at +24 h.
    - Stores see `changesAt` on the account until then, never the new number.
    - Switching an account off is immediate, because stopping payments is always safe.
14. **Who can do what** (`PLATFORM_ROLE_PERMISSIONS`):
    - The general manager can do everything.
    - The accountant sees, confirms and rejects payments and sees agents. Only the general manager unconfirms (07 › فصل المهام).
    - Support sees stores and writes notes.
15. **Agents:** the link is `/register?agent=CODE` (`agentReferralPath`). The sign-up sends `agentVia: 'link' | 'code'`, so the panel shows how each store was attributed. An agent's code never changes.
16. **Every platform write and every receipt view writes a `PlatformAuditEntry`** (before and after) in the same transaction.

## Open questions and the default taken

- **Q1. Hardware key (16, 07, 09 require WebAuthn).**
  - **Default:** TOTP, plus recovery codes, VPN, short sessions and step-up codes.
  - `PlatformLoginChallenge.next` gains a `webauthn` stage later, and it then becomes mandatory.
- **Q2. TOTP enrolment at first sign-in** lets anyone holding the password of a not-yet-enrolled account enrol.
  - **Default:** only accounts the seed or an admin marked "enrolment pending" can enrol. Every sign-in and every enrolment alerts the general manager (16).
  - Team create and edit routes (17, phase 1) are left out of this step: they need an invite flow behind the two-person rule. `GET /v1/platform/team` is in.
- **Q3. Who approves?** 17 says the general manager; the TeamAudit board shows support or the accountant approving.
  - **Default:** another super admin, never the requester; otherwise the change runs at 24 h.
- **Q4. Grace after a trial?** 07 puts grace after a renewal date.
  - **Default:** no grace after the trial. The trial goes read-only at its end, and the platform extends trials.
- **Q5. Upgrades with prorating** (07 «الترقية فورية بفرق الأيام») and plan changes from the panel (17, phase 2) are not here.
  - **Default:** a confirmed invoice switches the plan at confirmation and appends its full cycle.
- **Q6. Short, over and unknown payments, tolerance, statement matching and bulk confirm** are phases 3 and 5.
  - **Default:** the queue shows `amount_short` / `amount_over`, and confirming any payment with a check needs a written note.
- **Q7. Draft-then-publish for plan edits** (13 › مسودة ثم نشر).
  - **Default:** a new plan is created hidden (`isActive: false`). Price edits apply to new invoices only, and issued invoices and paid periods keep their price.
  - The founders' price lock (`locked_price_usd`) is not in this step.
- **Q8. The starter catalogue source.** 13 says phase 2, 17 says phase 1.
  - **Default:** the server seeds a small platform table per sector, starting from `scripts/demo-catalog.ts`. The platform editor (`/v1/platform/catalog`) comes later.
- **Q9. The prefilled dollar rate.** 04 says the platform's daily bulletin, and only the weekly billing rate exists.
  - **Default:** `OnboardingState.defaults.usdRate` is the billing rate.
- **Q10. Stopping cashier devices.** Signed device licences (07) are not built, so the server cannot stop an offline device.
  - **Default:** admin writes stop at once, and the push keeps accepting.
  - The next step should carry `access` in the heartbeat answer, or build the licence, so devices stop new sales themselves.
- **Q11. A "developer" platform role** appears on the TeamAudit board but not in the spec. **Default:** the three roles of 07, 09 and the DB enum.
- **Q12. Receipts as PDF** (bank transfers). **Default:** images only; a PDF is photographed.
- **Q13. The seasonal pause** (`paused`) is phase 5. The state list will grow by one key.
- **Q14. The new `/v1/me` fields are optional** so the current server still compiles. The server fills them in this step, and the web treats a missing `access` as `full`.

## Checks

`pnpm --filter @serva/core lint`, `typecheck` and `test` all pass. Note that `pnpm --filter @serva/core lint typecheck test` passes the words to eslint, so run the three separately.

- 406 tests in core.
- 100% of lines and statements covered in the measured (non-contract) files.
- The contract tests give valid and invalid examples for every schema, plus property tests for the state function, amounts, transaction numbers, colours and suggestions.
