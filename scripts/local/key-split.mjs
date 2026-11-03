#!/usr/bin/env node
// The backup key in three parts, any two of which open the backups (ADR-0014, owner's note 1;
// task M0-6). Shamir's secret sharing over GF(256), one degree-1 polynomial per byte of the key:
// one part alone says nothing about the key (every key is equally likely given it), two give it
// back exactly. No dependency: node:crypto only.
//
//   node scripts/local/key-split.mjs split            reads the key from SERVA_BACKUP_PASSPHRASE,
//                                                     prints the three parts
//   node scripts/local/key-split.mjs combine <part> <part> [<part>]
//                                                     prints the key (parts may also come on stdin,
//                                                     one per line)
//
// A part reads SK1-<key id>-<n>-<data>-<check>. The key id (8 hex of the key's sha256) tells which
// backups it belongs to; the check (6 hex) catches a mistyped part before it is used. Spaces are
// ignored, so the paper copy can print the data in groups of four.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PARTS = 3;
const THRESHOLD = 2;

// GF(256) with the AES polynomial x^8 + x^4 + x^3 + x + 1
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => {
  if (b === 0) throw new Error('division by zero');
  return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255];
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const keyId = (key) => sha256(Buffer.from(key, 'utf8')).slice(0, 8);
const checkOf = (id, n, data) => sha256(`SK1-${id}-${n}-${data}`).slice(0, 6);

/** Three parts of `key` (a string); any THRESHOLD of them give it back. */
export function split(key, random = randomBytes) {
  const bytes = Buffer.from(key, 'utf8');
  if (bytes.length === 0) throw new Error('The key is empty.');
  const id = keyId(key);
  // One random polynomial per byte: f(x) = key + c1·x (+ c2·x² … for a higher threshold)
  const coefficients = Array.from({ length: THRESHOLD - 1 }, () => random(bytes.length));
  const parts = [];
  for (let n = 1; n <= PARTS; n++) {
    const out = Buffer.alloc(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      let y = 0;
      for (let k = coefficients.length - 1; k >= 0; k--) y = mul(y ^ coefficients[k][i], n);
      out[i] = y ^ bytes[i];
    }
    const data = out.toString('hex');
    parts.push(`SK1-${id}-${n}-${data}-${checkOf(id, n, data)}`);
  }
  return parts;
}

/** Reads one part, refusing anything mistyped. */
export function parsePart(text) {
  const clean = String(text).replace(/\s+/g, '');
  const m = /^SK1-([0-9a-f]{8})-([1-9])-([0-9a-f]+)-([0-9a-f]{6})$/i.exec(clean);
  if (!m) throw new Error(`Not a key part: ${String(text).slice(0, 24)}…`);
  const [, id, n, data, check] = m.map((v) => v.toLowerCase());
  if (data.length % 2 !== 0 || checkOf(id, n, data) !== check) {
    throw new Error(`Key part ${n} is mistyped (its check does not match). Copy it again.`);
  }
  return { id, n: Number(n), data: Buffer.from(data, 'hex') };
}

/** The key, from at least THRESHOLD different parts of the same key. */
export function combine(texts) {
  const parts = texts.map(parsePart);
  const ids = new Set(parts.map((p) => p.id));
  if (ids.size > 1) throw new Error(`These parts belong to different keys (${[...ids].join(', ')}).`);
  const unique = [...new Map(parts.map((p) => [p.n, p])).values()];
  if (unique.length < THRESHOLD) {
    throw new Error(`One part is not enough: give ${THRESHOLD} different parts of the key.`);
  }
  const used = unique.slice(0, THRESHOLD);
  const length = used[0].data.length;
  if (used.some((p) => p.data.length !== length)) throw new Error('The parts have different lengths.');
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    // Lagrange interpolation at x = 0
    let value = 0;
    for (const a of used) {
      let basis = 1;
      for (const b of used) if (a !== b) basis = mul(basis, div(b.n, a.n ^ b.n));
      value ^= mul(a.data[i], basis);
    }
    out[i] = value;
  }
  const key = out.toString('utf8');
  if (keyId(key) !== used[0].id) throw new Error('The parts do not give back the key they were made from.');
  return key;
}

/** The paper copy of a part: the data in groups of four, easy to read and type. */
export const forPaper = (part) => {
  const [prefix, id, n, data, check] = part.split('-');
  return `${prefix}-${id}-${n}-\n${data.match(/.{1,4}/g).join(' ')}\n-${check}`;
};

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'split') {
    const key = process.env.SERVA_BACKUP_PASSPHRASE ?? '';
    if (key.length < 16) throw new Error('SERVA_BACKUP_PASSPHRASE is missing or too short.');
    const parts = split(key);
    const roles = [
      'Part 1, the owner: keep it in your password manager or phone (not on the server computer).',
      'Part 2, Serva: give it to Serva support, who keep it for you.',
      'Part 3, paper: print it, put it in a sealed envelope, keep it away from the shop.',
    ];
    console.log(`Backup key ${keyId(key)}: three parts, any two open the backups, one alone cannot.\n`);
    parts.forEach((p, i) => console.log(`${roles[i]}\n${i === 2 ? forPaper(p) : p}\n`));
    return;
  }
  if (command === 'combine') {
    const texts =
      rest.length > 0
        ? rest
        : readFileSync(0, 'utf8')
            .split('\n\n')
            .flatMap((b) => b.split(/\n(?=SK1-)/));
    const parts = texts.map((t) => t.trim()).filter(Boolean);
    process.stdout.write(`${combine(parts)}\n`);
    return;
  }
  throw new Error('Usage: key-split.mjs split | combine <part> <part> [<part>]');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✘ ${error.message}`);
    process.exit(1);
  }
}
