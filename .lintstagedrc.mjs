import path from 'node:path';
import { existsSync } from 'node:fs';

// Same convention as .claude/hooks/test-edited-file.mjs and test-plan.md
// §6.1: src/worker/{lib,routes}/foo.ts / src/worker/scheduled.ts ->
// test/worker/foo.test.ts. Duplicated rather than shared because the two
// scripts run in unrelated contexts (a Claude Code hook vs. a git hook).
function mapToTestFile(relPath) {
  if (relPath.startsWith(`test${path.sep}worker${path.sep}`) && relPath.endsWith('.test.ts')) {
    return relPath;
  }
  const inWorkerScope =
    relPath.startsWith(`src${path.sep}worker${path.sep}lib${path.sep}`) ||
    relPath.startsWith(`src${path.sep}worker${path.sep}routes${path.sep}`) ||
    relPath === `src${path.sep}worker${path.sep}scheduled.ts`;
  if (!inWorkerScope) return null;

  const moduleName = path.basename(relPath, '.ts');
  const candidate = path.join('test', 'worker', `${moduleName}.test.ts`);
  return existsSync(candidate) ? candidate : null;
}

function runScopedWorkerTests(absPaths) {
  const testFiles = new Set();
  for (const absPath of absPaths) {
    const relPath = path.relative(process.cwd(), absPath);
    const testFile = mapToTestFile(relPath);
    if (testFile) testFiles.add(testFile);
  }
  if (testFiles.size === 0) return [];
  return [`vitest run ${[...testFiles].join(' ')}`];
}

export default {
  '*.{ts,html}': 'eslint',
  '{src/worker/**/*.ts,test/worker/**/*.test.ts}': runScopedWorkerTests,
};
