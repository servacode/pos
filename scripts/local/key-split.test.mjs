// Tests of the 2-of-3 backup key (ADR-0014, owner's note 1): every pair of parts opens, one part
// alone does not, and a mistyped or foreign part is refused before it is used.
//   node --test scripts/local/key-split.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { combine, forPaper, keyId, parsePart, split } from './key-split.mjs';

const SCRIPT = fileURLToPath(new URL('./key-split.mjs', import.meta.url));
const passphrase = () => randomBytes(24).toString('hex');

test('every pair of the three parts gives the key back, in any order', () => {
  for (let run = 0; run < 50; run++) {
    const key = passphrase();
    const [a, b, c] = split(key);
    for (const pair of [
      [a, b],
      [b, a],
      [a, c],
      [c, a],
      [b, c],
      [c, b],
    ]) {
      assert.equal(combine(pair), key);
    }
    assert.equal(combine([a, b, c]), key);
  }
});

test('one part is not enough, even given twice', () => {
  const [a, b, c] = split(passphrase());
  for (const part of [a, b, c]) {
    assert.throws(() => combine([part]), /One part is not enough/);
    assert.throws(() => combine([part, part]), /One part is not enough/);
  }
});

test('one part says nothing about the key: any key is equally possible given it', () => {
  // For a degree-1 polynomial over GF(256), each value of part 1 is reached by exactly one random
  // coefficient for every possible key byte. Checked here over all 256 × 256 pairs for one byte.
  const seen = new Map();
  for (let key = 0; key < 256; key++) {
    for (let c = 0; c < 256; c++) {
      const [part] = split(String.fromCharCode(key > 127 ? key - 128 : key), () => Buffer.from([c]));
      const value = parsePart(part).data[0];
      const keys = seen.get(value) ?? new Set();
      keys.add(key > 127 ? key - 128 : key);
      seen.set(value, keys);
    }
  }
  // Every part value is compatible with every one of the 128 single-byte (ASCII) keys
  for (const keys of seen.values()) assert.equal(keys.size, 128);
});

test('the paper copy, with its spaces and line breaks, reads back', () => {
  const key = passphrase();
  const [a, , c] = split(key);
  assert.match(forPaper(c), /^SK1-[0-9a-f]{8}-3-\n([0-9a-f]{4} )+[0-9a-f]{1,4}\n-[0-9a-f]{6}$/);
  assert.equal(combine([a, forPaper(c)]), key);
});

test('a mistyped part is refused, never used', () => {
  const [a, b] = split(passphrase());
  const i = a.lastIndexOf('-') - 3;
  const typo = a.slice(0, i) + (a[i] === '0' ? '1' : '0') + a.slice(i + 1);
  assert.throws(() => combine([typo, b]), /mistyped/);
  assert.throws(() => combine(['hello', b]), /Not a key part/);
});

test('parts of two different keys are refused', () => {
  const [a] = split(passphrase());
  const [, b] = split(passphrase());
  assert.throws(() => combine([a, b]), /different keys/);
});

test('the key id names the key, so a part says which backups it opens', () => {
  const key = passphrase();
  for (const part of split(key)) assert.equal(parsePart(part).id, keyId(key));
});

test('the command line: split prints three parts, combine takes any two', () => {
  const key = passphrase();
  const out = execFileSync('node', [SCRIPT, 'split'], {
    env: { ...process.env, SERVA_BACKUP_PASSPHRASE: key },
    encoding: 'utf8',
  });
  const flat = out.replace(/\n(?![A-Z])/g, '').replace(/\n-/g, '-');
  const parts = flat.match(/SK1-[0-9a-f]{8}-[1-3]-[0-9a-f ]+-[0-9a-f]{6}/g);
  assert.equal(parts.length, 3);
  assert.equal(
    execFileSync('node', [SCRIPT, 'combine', parts[0], parts[2]], { encoding: 'utf8' }).trim(),
    key,
  );
  assert.throws(() => execFileSync('node', [SCRIPT, 'combine', parts[1]], { stdio: 'pipe' }));
});
