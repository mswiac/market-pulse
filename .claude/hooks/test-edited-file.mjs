#!/usr/bin/env node
// PostToolUse hook: runs the single Vitest file covering the module Claude
// Code just Edit'd/Written — scoped, not the full `npm run test:worker`
// suite (that stays manual / CI / a future pre-commit gate).
//
// Scoping is by filename convention (test-plan.md §6.1: `src/worker/lib/foo.ts`
// / `src/worker/routes/foo.ts` -> `test/worker/foo.test.ts`), not import-graph
// analysis — most of this repo's worker tests dispatch through
// `exports.default.fetch()` from `cloudflare:workers` rather than a direct ES
// import of the handler under test, so there's no static import edge to trace
// (see stryker.config.json's `vitest.related: false` and its CLAUDE.md note
// for the same underlying gotcha).
//
// Registered in .claude/settings.json under PostToolUse for Edit/Write.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

const raw = await readStdin();

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') process.exit(0);

const filePath = input.tool_input?.file_path;
if (typeof filePath !== 'string' || filePath.length === 0) process.exit(0);
if (path.extname(filePath) !== '.ts') process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relPath = path.relative(projectDir, filePath);

let testRelPath;
if (relPath.startsWith(`test${path.sep}worker${path.sep}`) && relPath.endsWith('.test.ts')) {
  testRelPath = relPath;
} else if (
  relPath.startsWith(`src${path.sep}worker${path.sep}lib${path.sep}`) ||
  relPath.startsWith(`src${path.sep}worker${path.sep}routes${path.sep}`) ||
  relPath === `src${path.sep}worker${path.sep}scheduled.ts`
) {
  const moduleName = path.basename(filePath, '.ts');
  testRelPath = path.join('test', 'worker', `${moduleName}.test.ts`);
} else {
  process.exit(0);
}

const testAbsPath = path.join(projectDir, testRelPath);
if (!existsSync(testAbsPath)) process.exit(0);

const vitestBin = path.join(projectDir, 'node_modules', '.bin', 'vitest');
if (!existsSync(vitestBin)) process.exit(0);

execFile(vitestBin, ['run', testRelPath], { cwd: projectDir, timeout: 60_000 }, (error, stdout, stderr) => {
  if (!error) process.exit(0);

  const output = stdout.trim().length > 0 ? stdout : stderr;
  process.stderr.write(`vitest found failures in ${testRelPath} (covers ${relPath}):\n\n${output}\n`);
  process.exit(2);
});
