#!/usr/bin/env node
// PostToolUse hook: typechecks the single file just Edit'd/Written by Claude
// Code, scoped to just that file's diagnostics — not a full-project check
// (that's `npm run typecheck`, run on request or at CI/pre-commit).
//
// tsc has no native "check just this file" mode when the file participates
// in a larger program (imports pull in the rest of the graph) — so this
// still runs the full project through tsc, but with --incremental so repeat
// runs only re-check what changed, and filters the reported diagnostics
// down to lines that belong to the edited file. A cross-file break this
// edit causes elsewhere in the project will NOT be caught here by design;
// that's what the full `npm run typecheck` / pre-commit gate is for.
//
// Registered in .claude/settings.json under PostToolUse for Edit/Write.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

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
if (filePath.endsWith('.spec.ts')) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relPath = path.relative(projectDir, filePath);

const inWorkerScope = relPath.startsWith(`src${path.sep}worker${path.sep}`) || relPath.startsWith(`test${path.sep}`);
const inAppScope = relPath.startsWith(`src${path.sep}`) && !inWorkerScope;

let tsconfig;
let cacheFile;
if (inWorkerScope) {
  tsconfig = 'tsconfig.worker.json';
  cacheFile = path.join(projectDir, '.claude', 'cache', 'tsc-worker.tsbuildinfo');
} else if (inAppScope) {
  tsconfig = 'tsconfig.app.json';
  cacheFile = path.join(projectDir, '.claude', 'cache', 'tsc-app.tsbuildinfo');
} else {
  process.exit(0);
}

const tscBin = path.join(projectDir, 'node_modules', '.bin', 'tsc');
if (!existsSync(tscBin)) process.exit(0);
if (!existsSync(filePath)) process.exit(0);

mkdirSync(path.dirname(cacheFile), { recursive: true });

const args = ['--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', cacheFile, '-p', tsconfig];

execFile(tscBin, args, { cwd: projectDir, timeout: 60_000 }, (error, stdout) => {
  if (!error) process.exit(0);

  const relevantLines = stdout
    .split('\n')
    .filter((line) => line.startsWith(relPath) || line.startsWith(`./${relPath}`));

  if (relevantLines.length === 0) process.exit(0);

  process.stderr.write(`tsc found problems in ${relPath}:\n\n${relevantLines.join('\n')}\n`);
  process.exit(2);
});
