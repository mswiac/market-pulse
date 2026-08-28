#!/usr/bin/env node
// PreToolUse hook: blocks any tool call that would surface the contents of a
// local secrets / credential file into the conversation — e.g. `Read` on the
// file, a `Bash` command that cats/greps it, or a `Grep` search targeting it.
// Being gitignored does not make a file safe to dump in full; only a single
// named key should ever be extracted (via a targeted grep run by the user, or
// a direct question to the user), never the whole file.
//
// Guarded paths:
//   - .dev.vars                    Worker local secrets (API keys, password pepper)
//   - e2e/.env                     E2E test-account credentials
//   - playwright/.auth/            saved Playwright session tokens (user.json)
//
// Registered in .claude/settings.json under PreToolUse for Read/Grep/Glob/Bash.
// (Filename kept for history — it now covers more than .dev.vars.)

const TARGETS = ['.dev.vars', 'e2e/.env', 'playwright/.auth'];

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

function mentionsTarget(value) {
  return typeof value === 'string' && TARGETS.some((target) => value.includes(target));
}

const raw = await readStdin();

let input;
try {
  input = JSON.parse(raw);
} catch {
  // Unparseable input — fail open rather than block unrelated tool calls.
  process.exit(0);
}

const toolName = input.tool_name;
const toolInput = input.tool_input || {};

const hit =
  (toolName === 'Read' && mentionsTarget(toolInput.file_path)) ||
  (toolName === 'Grep' && (mentionsTarget(toolInput.path) || mentionsTarget(toolInput.glob) || mentionsTarget(toolInput.pattern))) ||
  (toolName === 'Glob' && mentionsTarget(toolInput.pattern)) ||
  (toolName === 'Bash' && mentionsTarget(toolInput.command));

if (hit) {
  process.stderr.write(
    'Blocked by block-dev-vars hook: this tool call references a guarded local secrets / ' +
      'credential file (.dev.vars, e2e/.env, or playwright/.auth/). Do not read or print its ' +
      'contents. If a single value is needed, ask the user directly instead.',
  );
  process.exit(2);
}

process.exit(0);
