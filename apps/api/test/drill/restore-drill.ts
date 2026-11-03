/**
 * The working day of the restore drill (task M0-7), against a running server over HTTPS, the way
 * real tills reach it. Used by scripts/local/ci-checks.sh in .github/workflows/local-server.yml:
 *
 *   tsx test/drill/restore-drill.ts seed <state.json>          a store opened through the real
 *        sign-up (on-screen test code), two tills linked by the owner, and their first documents
 *   tsx test/drill/restore-drill.ts after-backup <state.json>  the documents made after the backup
 *        was taken: a restore loses them from the server, never from the tills
 *   tsx test/drill/restore-drill.ts resend <state.json>        after the restore (new epoch), each
 *        till sends everything it holds again, as the sync client does; every document must come
 *        back accepted or as a duplicate
 *
 * API_BASE (default https://localhost) is the server; NODE_EXTRA_CA_CERTS its local CA.
 * The state file keeps the tills' tokens and documents between the steps: it stands for what the
 * tills keep on their own disks.
 */
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildSalePayload,
  TERMS_VERSION,
  type ActivatedDevice,
  type CashMovementPayload,
  type ProductDetail,
  type SaleCartLine,
  type SalePayload,
  type ShiftClosePayload,
  type ShiftOpenPayload,
  type TradeRate,
} from '@serva/core';
import {
  createUuidV7,
  formatDocNumber,
  payloadHash,
  seriesOf,
  type DocType,
  type PushResponse,
  type SyncDocument,
} from '@serva/sync';

const API = process.env.API_BASE ?? 'https://localhost';
const DATE = '2026-10-30';
const USD_130: TradeRate = { unit: 'USD', quote: 'SYP', rate: '130' };
const newId = createUuidV7();
const SALES_BEFORE = 30;
const SALES_AFTER = 10;

interface Till {
  name: string;
  token: string;
  code: string;
  branchCode: string;
  /** Everything the till made, in order: what it keeps until the server confirms it */
  documents: SyncDocument[];
  /** How many of them were sent before the backup */
  sentBeforeBackup: number;
}

interface State {
  phone: string;
  password: string;
  branchId: string;
  /** Code of a till linked after the backup: the restore forgets it, the till keeps using it */
  forgottenTillCode?: string;
  tenantId: string;
  userId: string;
  products: { productId: string; variantId: string; name: string; priceMinor: number }[];
  tills: Till[];
}

async function call<T>(method: string, path: string, body?: unknown, authorization?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authorization ? { authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const devicePublicKey = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .publicKey.export({ type: 'spki', format: 'der' })
    .toString('base64url');

/** A document as a till makes it: one seq for all, a counter per series. */
function documentMaker(till: Till) {
  let seq = till.documents.length;
  const counters = new Map<string, number>();
  for (const d of till.documents) {
    const series = seriesOf(d.type);
    if (series) counters.set(series, (counters.get(series) ?? 0) + 1);
  }
  return (type: DocType, payload: unknown): SyncDocument => {
    seq += 1;
    const series = seriesOf(type);
    const n = series ? (counters.get(series) ?? 0) + 1 : 0;
    if (series) counters.set(series, n);
    const body = {
      id: newId(),
      seq,
      type,
      number: series
        ? formatDocNumber({ series, branchCode: till.branchCode, deviceCode: till.code, sequence: n })
        : null,
      deviceTime: `${DATE}T09:${String(seq % 60).padStart(2, '0')}:00.000Z`,
      businessDate: DATE,
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps: [],
      payload: payload as Record<string, unknown>,
    };
    const doc: SyncDocument = { ...body, hash: payloadHash(body) };
    till.documents.push(doc);
    return doc;
  };
}

function cartLine(product: State['products'][number], qty: number): SaleCartLine {
  return {
    lineNo: 1,
    productId: product.productId,
    variantId: product.variantId,
    name: product.name,
    qty,
    priceCurrency: 'SYP',
    priceMinor: product.priceMinor,
    taxRateBp: 0,
  };
}

/** Sale k of a till: cash in pounds, card, or dollars with change in dollars, by turn. */
function salePayload(state: State, shiftId: string, k: number): SalePayload {
  const product = state.products[k % state.products.length]!;
  const qty = (1 + (k % 3)) * 1000;
  const due = (product.priceMinor * qty) / 1000;
  const base = {
    currency: 'SYP' as const,
    taxInclusive: true,
    exchangeRates: [USD_130],
    shiftId,
    cashierId: state.userId,
    cashSteps: { SYP: 1000, USD: 25 },
    lines: [cartLine(product, qty)],
  };
  switch (k % 3) {
    case 0:
      return buildSalePayload({
        ...base,
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: due + 1_000 }],
      });
    case 1:
      return buildSalePayload({
        ...base,
        payments: [{ method: 'card', currency: 'SYP', amountMinor: due, reference: `C${k}` }],
      });
    default:
      return buildSalePayload({
        ...base,
        payments: [{ method: 'cash', currency: 'USD', amountMinor: Math.ceil(due / 130) + 100 }],
        changeCurrency: 'USD',
      });
  }
}

async function push(till: Till, docs: SyncDocument[]): Promise<PushResponse['results']> {
  const results: PushResponse['results'] = [];
  for (let i = 0; i < docs.length; i += 50) {
    const answer = await call<PushResponse>(
      'POST',
      '/v1/sync/push',
      {
        contractVersion: 1,
        appVersion: '1.0.0',
        sentAt: new Date().toISOString(),
        documents: docs.slice(i, i + 50),
      },
      `Device ${till.token}`,
    );
    results.push(...answer.results);
  }
  return results;
}

function expectStatuses(what: string, results: PushResponse['results'], allowed: string[]) {
  const wrong = results.filter((r) => !allowed.includes(r.status));
  if (wrong.length > 0) {
    throw new Error(
      `${what}: ${wrong.length} document(s) not ${allowed.join('/')}: ${JSON.stringify(wrong.slice(0, 3))}`,
    );
  }
}

async function seed(file: string) {
  // 1. A store, opened as a person does it, typing the code the test mode shows on screen.
  const phone = `093${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, '0')}`;
  const password = 'drill-pass-12345';
  const start = await call<{ registrationId: string; testCode?: string }>('POST', '/v1/auth/register', {
    phone,
    fullName: 'متجر تمرين الاستعادة',
    password,
    termsVersion: TERMS_VERSION,
  });
  if (!start.testCode) throw new Error('No on-screen test code: is SERVA_OTP_DELIVERY=screen?');
  const opened = await call<{ accessToken: string; user: { id: string }; tenant: { id: string } }>(
    'POST',
    '/v1/auth/register/verify',
    { registrationId: start.registrationId, code: start.testCode, password },
  );
  const owner = `Bearer ${opened.accessToken}`;
  const me = await call<{ branches: { id: string; code: string }[] }>('GET', '/v1/me', undefined, owner);
  const branch = me.branches[0]!;

  // 2. Three products.
  const products: State['products'] = [];
  for (const [name, priceMinor] of [
    ['رز', 125_000],
    ['سكر', 37_500],
    ['زيت', 260_000],
  ] as const) {
    const p = await call<ProductDetail>(
      'POST',
      '/v1/products',
      { nameAr: name, variants: [{ price: { currency: 'SYP', priceMinor } }] },
      owner,
    );
    products.push({ productId: p.id, variantId: p.variants[0]!.id, name, priceMinor });
  }

  // 3. Two tills, linked by the owner signing in on each.
  const tills: Till[] = [];
  for (const name of ['كاشير التمرين 1', 'كاشير التمرين 2']) {
    const device = await linkTill(owner, branch.id, name);
    tills.push({
      name,
      token: device.token,
      code: device.deviceCode,
      branchCode: branch.code,
      documents: [],
      sentBeforeBackup: 0,
    });
  }

  const state: State = {
    phone,
    password,
    branchId: branch.id,
    tenantId: opened.tenant.id,
    userId: opened.user.id,
    products,
    tills,
  };

  // 4. Each till opens its shift, sells, pays an expense; all of it reaches the server.
  for (const [t, till] of tills.entries()) {
    const doc = documentMaker(till);
    const open = doc('shift_open', {
      openedBy: state.userId,
      mode: 'per_cashier',
      handoverFromShiftId: null,
      opening: [
        { currency: 'SYP', amountMinor: 300_000, denominations: null },
        { currency: 'USD', amountMinor: 5_000, denominations: null },
      ],
    } satisfies ShiftOpenPayload);
    for (let k = 0; k < SALES_BEFORE; k++) doc('sale', salePayload(state, open.id, k + t));
    doc('cash_movement', movement(state, open.id, 'expense', 4_000));
    till.sentBeforeBackup = till.documents.length;
    expectStatuses(`${till.name} before the backup`, await push(till, till.documents), ['accepted']);
  }
  writeFileSync(file, JSON.stringify(state));
  const sent = tills.reduce((n, t) => n + t.sentBeforeBackup, 0);
  console.log(`✔ Store ${phone}, ${tills.length} tills linked by the owner, ${sent} documents accepted`);
}

/** The owner signs in on a till: linked at once (method owner). */
async function linkTill(owner: string, branchId: string, name: string): Promise<ActivatedDevice> {
  const { device } = await call<{ device: ActivatedDevice }>(
    'POST',
    '/v1/devices/activate',
    {
      method: 'owner',
      branchId,
      name,
      kind: 'cashier',
      platform: 'browser',
      publicKey: devicePublicKey(),
      appVersion: '1.0.0',
    },
    owner,
  );
  return device;
}

async function signIn(state: State): Promise<string> {
  const { accessToken } = await call<{ accessToken: string }>('POST', '/v1/auth/login', {
    phone: state.phone,
    password: state.password,
  });
  return `Bearer ${accessToken}`;
}

function movement(state: State, shiftId: string, kind: CashMovementPayload['kind'], amountMinor: number) {
  return {
    shiftId,
    kind,
    currency: 'SYP',
    amountMinor,
    baseCurrency: 'SYP',
    rate: null,
    baseAmountMinor: amountMinor,
    reason: kind === 'expense' ? 'فاتورة كهرباء' : 'فكة',
    expenseAccountCode: kind === 'expense' ? '6102' : null,
    reference: null,
    performedBy: state.userId,
    approval: { userId: state.userId, method: 'pin', at: `${DATE}T08:58:00.000Z`, offline: false },
  } satisfies CashMovementPayload;
}

/** The drawers of a till's close, counted to the qirsh: what its documents put in them, less 500. */
function close(state: State, till: Till, shiftId: string, shiftNumber: string): ShiftClosePayload {
  const drawers = new Map<string, { opening: number; cashIn: number; changeOut: number; payOut: number }>();
  const drawer = (c: string) => {
    let d = drawers.get(c);
    if (!d) drawers.set(c, (d = { opening: 0, cashIn: 0, changeOut: 0, payOut: 0 }));
    return d;
  };
  for (const doc of till.documents) {
    const p = doc.payload as Record<string, unknown>;
    if (doc.type === 'shift_open') {
      for (const o of p.opening as { currency: string; amountMinor: number }[])
        drawer(o.currency).opening += o.amountMinor;
    } else if (doc.type === 'sale') {
      const sale = p as unknown as SalePayload;
      for (const pay of sale.payments)
        if (pay.method === 'cash') drawer(pay.currency).cashIn += pay.amountMinor;
      if (sale.change) drawer(sale.change.currency).changeOut += sale.change.amountMinor;
    } else if (doc.type === 'cash_movement') {
      const m = p as unknown as CashMovementPayload;
      drawer(m.currency).payOut += m.amountMinor;
    }
  }
  return {
    shiftId,
    shiftNumber,
    closedBy: state.userId,
    baseCurrency: 'SYP',
    cash: [...drawers.entries()].map(([currency, d]) => {
      const expected = d.opening + d.cashIn - d.changeOut - d.payOut;
      const difference = currency === 'SYP' ? -500 : 0;
      const rate = currency === 'SYP' ? null : USD_130;
      return {
        currency: currency as 'SYP' | 'USD',
        rate,
        openingMinor: d.opening,
        cashInMinor: d.cashIn,
        changeOutMinor: d.changeOut,
        refundsMinor: 0,
        receiptsMinor: 0,
        payInMinor: 0,
        fxInMinor: 0,
        payOutMinor: d.payOut,
        fxOutMinor: 0,
        dropsMinor: 0,
        expectedMinor: expected,
        countedMinor: expected + difference,
        denominations: null,
        differenceMinor: difference,
        differenceBaseMinor: rate ? difference * 130 : difference,
      };
    }),
    shortageTreatment: 'loss',
    approval: null,
    summary: { saleCount: 0, byMethod: [] },
    forced: false,
  };
}

async function afterBackup(file: string) {
  const state = JSON.parse(readFileSync(file, 'utf8')) as State;
  let sent = 0;
  for (const [t, till] of state.tills.entries()) {
    const doc = documentMaker(till);
    const open = till.documents[0]!;
    for (let k = 0; k < SALES_AFTER; k++) doc('sale', salePayload(state, open.id, 100 + k + t));
    doc('shift_close', close(state, till, open.id, open.number!));
    const fresh = till.documents.slice(till.sentBeforeBackup);
    expectStatuses(`${till.name} after the backup`, await push(till, fresh), ['accepted']);
    sent += fresh.length;
  }
  // A third till is linked after the backup: the restored server will not know it.
  const third = await linkTill(await signIn(state), state.branchId, 'كاشير بعد النسخة');
  state.forgottenTillCode = third.deviceCode;
  writeFileSync(file, JSON.stringify(state));
  console.log(
    `✔ ${sent} documents made after the backup (sales and both closes) accepted; a third till linked as ${third.deviceCode}`,
  );
}

async function resend(file: string) {
  const state = JSON.parse(readFileSync(file, 'utf8')) as State;
  const started = Date.now();
  const tally = new Map<string, number>();
  for (const till of state.tills) {
    const results = await push(till, till.documents);
    expectStatuses(`${till.name} resending`, results, ['accepted', 'duplicate']);
    for (const r of results) tally.set(r.status, (tally.get(r.status) ?? 0) + 1);
  }
  const lost = state.tills.reduce((n, t) => n + t.documents.length - t.sentBeforeBackup, 0);
  if ((tally.get('accepted') ?? 0) !== lost) {
    throw new Error(
      `After the restore the server should have lost exactly the ${lost} documents made after the backup, ` +
        `and taken them again now; it accepted ${tally.get('accepted') ?? 0}`,
    );
  }
  // Task M0-8: a till linked now must not take the code of the till the restore forgot.
  const next = await linkTill(await signIn(state), state.branchId, 'كاشير بعد الاستعادة');
  if (state.forgottenTillCode && Number(next.deviceCode) <= Number(state.forgottenTillCode)) {
    throw new Error(
      `A till linked after the restore took code ${next.deviceCode}; the till linked after the backup ` +
        `still uses ${state.forgottenTillCode}: their invoice numbers would collide`,
    );
  }
  console.log(
    `✔ A till linked after the restore took code ${next.deviceCode}, past the forgotten ${state.forgottenTillCode}`,
  );
  console.log(
    `✔ Both tills resent everything in ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
      `${tally.get('duplicate') ?? 0} already on the restored server, ${lost} lost by the restore and taken again`,
  );
}

const [command, file] = process.argv.slice(2);
if (!file || !['seed', 'after-backup', 'resend'].includes(command ?? '')) {
  console.error('Usage: restore-drill.ts seed|after-backup|resend <state.json>');
  process.exit(2);
}
const run = command === 'seed' ? seed : command === 'after-backup' ? afterBackup : resend;
run(file).catch((error: unknown) => {
  console.error(`✘ ${(error as Error).message}`);
  process.exit(1);
});
