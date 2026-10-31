// ADR-0001: every financial-kernel path exists and has an owner in .github/CODEOWNERS.
// Usage: node scripts/ci/check-codeowners.mjs [codeowners-file] [kernel-list-file]
// Plain prefix matching only (CODEOWNERS here uses no wildcards), no regular expressions.
import { existsSync, readFileSync, statSync } from 'node:fs';

const codeownersFile = process.argv[2] ?? '.github/CODEOWNERS';
const kernelFile = process.argv[3] ?? 'scripts/ci/kernel-paths.txt';

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

for (const path of meaningful(readFileSync(kernelFile, 'utf8'))) {
  const isDir = path.endsWith('/');
  if (!existsSync(path)) problems.push(`kernel path does not exist: ${path}`);
  else if (statSync(path).isDirectory() !== isDir)
    problems.push(`kernel path kind differs (file or directory): ${path}`);
  if (!owned(path)) problems.push(`kernel path has no owner in ${codeownersFile}: ${path}`);
}

if (problems.length > 0) {
  console.error(`CODEOWNERS check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`CODEOWNERS check passed: ${rules.length} rules, every kernel path exists and is owned.`);
