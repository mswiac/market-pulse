#!/usr/bin/env node
// PostToolUse hook: runs ESLint on the single file just Edit'd/Written by
// Claude Code. Scoped to that one file on purpose — a full-repo lint is
// available on request via `npm run lint`, not forced on every edit.
//
// Registered in .claude/settings.json under PostToolUse for Edit/Write.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

const LINTABLE_EXTENSIONS = new Set(['.ts', '.html', '.mjs']);

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
  // Unparseable input — fail open rather than block on a hook-contract issue.
  process.exit(0);
}

if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') process.exit(0);

const filePath = input.tool_input?.file_path;
if (typeof filePath !== 'string' || filePath.length === 0) process.exit(0);
if (path.extname(filePath) === '.ts' && filePath.endsWith('.spec.ts')) process.exit(0);
if (!LINTABLE_EXTENSIONS.has(path.extname(filePath))) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const eslintBin = path.join(projectDir, 'node_modules', '.bin', 'eslint');
if (!existsSync(eslintBin)) process.exit(0);
if (!existsSync(filePath)) process.exit(0);

execFile(eslintBin, ['--no-warn-ignored', filePath], { cwd: projectDir, timeout: 30_000 }, (error, stdout, stderr) => {
  if (!error) process.exit(0);

  // execFile errors on any non-zero exit (lint findings, not just crashes) —
  // stdout carries the findings in that case, stderr only on a real crash.
  const output = stdout.trim().length > 0 ? stdout : stderr;
  process.stderr.write(`ESLint found problems in ${path.relative(projectDir, filePath)}:\n\n${output}`);
  process.exit(2);
});
