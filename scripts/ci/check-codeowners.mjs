// ADR-0001: every financial-kernel path exists and has an owner in .github/CODEOWNERS,
// and every file the kernel imports is listed too.
//
// Two lists, because following imports all the way would swallow the whole server:
//   kernel-paths.txt   the kernel itself; each file is read and its imports checked
//   kernel-reached.txt what the kernel imports; owned, but not followed any further
// So the check reaches exactly one step past the kernel. That one step is what catches a
// NEW financial file nobody added by hand: the kernel file importing it fails this check
// until the file is listed and owned.
//
// Usage: node scripts/ci/check-codeowners.mjs [codeowners-file] [kernel-list-file] [reached-list-file]
// Plain prefix matching only (CODEOWNERS here uses no wildcards), no regular expressions.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const codeownersFile = process.argv[2] ?? '.github/CODEOWNERS';
const kernelFile = process.argv[3] ?? 'scripts/ci/kernel-paths.txt';
const reachedFile = process.argv[4] ?? 'scripts/ci/kernel-reached.txt';

const meaningful = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

const rules = meaningful(readFileSync(codeownersFile, 'utf8')).map((line) => {
  const [pattern, ...owners] = line.split(' ').filter(Boolean);
  return { pattern, owners };
});
const problems = [];
for (const rule of rules) {
  if (rule.owners.length === 0) problems.push(`no owner for ${rule.pattern}`);
  if (!rule.pattern.startsWith('/')) problems.push(`not anchored at the repo root: ${rule.pattern}`);
  if (rule.pattern.includes('*')) problems.push(`wildcards are not allowed here: ${rule.pattern}`);
}

const owned = (path) =>
  rules.some(({ pattern, owners }) => {
    if (owners.length === 0) return false;
    const p = pattern.slice(1);
    return p.endsWith('/') ? path.startsWith(p) : path === p;
  });

const kernelList = meaningful(readFileSync(kernelFile, 'utf8'));
const reachedList = meaningful(readFileSync(reachedFile, 'utf8'));

for (const [label, list] of [
  ['kernel', kernelList],
  ['reached', reachedList],
]) {
  for (const path of list) {
    const isDir = path.endsWith('/');
    if (!existsSync(path)) problems.push(`${label} path does not exist: ${path}`);
    else if (statSync(path).isDirectory() !== isDir)
      problems.push(`${label} path kind differs (file or directory): ${path}`);
    if (!owned(path)) problems.push(`${label} path has no owner in ${codeownersFile}: ${path}`);
  }
}
for (const path of reachedList) {
  if (path.endsWith('/')) problems.push(`${reachedFile} lists files, not directories: ${path}`);
}

// --- Everything the kernel imports is listed ---
// A listed directory is kernel in full; a listed file is kernel on its own.
const kernelDirs = kernelList.filter((p) => p.endsWith('/'));
const kernelFiles = new Set(kernelList.filter((p) => !p.endsWith('/')));
const isKernel = (path) => kernelFiles.has(path) || kernelDirs.some((dir) => path.startsWith(dir));
const reached = new Set(reachedList);
const isListed = (path) => isKernel(path) || reached.has(path);

const sourceFile = (path) => path.endsWith('.ts') || path.endsWith('.tsx');
const walk = (dir, found = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (sourceFile(path)) found.push(path);
  }
  return found;
};

// Linear, no backtracking: a literal "from", spaces, then a quoted specifier.
const importPattern = /from\s*['"]([^'"]+)['"]/g;
// Node resolves a relative import to one of these, in this order.
const resolveImport = (from, specifier) => {
  const base = normalize(join(dirname(from), specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
};

const actuallyReached = new Set();
const kernelSources = [
  ...[...kernelFiles].filter((p) => sourceFile(p) && existsSync(p)),
  ...kernelDirs.filter((d) => existsSync(d)).flatMap((d) => walk(d)),
];
for (const path of kernelSources) {
  const source = readFileSync(path, 'utf8');
  for (const [, specifier] of source.matchAll(importPattern)) {
    if (!specifier.startsWith('.')) continue; // a package, not a file in this repository
    const target = resolveImport(path, specifier);
    if (target === null) continue; // a type-only or generated path; tsc reports a real break
    if (!isListed(target))
      problems.push(
        `kernel file ${path} imports ${target}, which is in neither ${kernelFile} nor ${reachedFile}`,
      );
    if (!isKernel(target)) actuallyReached.add(target);
  }
}
// A stale entry would quietly widen the list, so it has to go when the import does.
for (const path of reachedList) {
  if (!path.endsWith('/') && !actuallyReached.has(path))
    problems.push(`${reachedFile} lists ${path}, which the kernel no longer imports: remove it`);
}

if (problems.length > 0) {
  console.error(`CODEOWNERS check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`CODEOWNERS check passed: ${rules.length} rules, every kernel path exists and is owned.`);
