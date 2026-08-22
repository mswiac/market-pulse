---
bootstrapped_at: 2026-06-14T15:30:00Z
starter_id: angular
starter_name: Angular
project_name: market-pulse
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: angular
package_manager: npm
project_name: market-pulse
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
```

**Why this stack:**

A solo backend developer with 10+ years of Java/Scala experience learning Angular while shipping a market-alerts MVP in 3 weeks after-hours. Angular is the natural frontend choice for a developer already fluent in DI, typed systems, and opinionated frameworks — its Component/Injectable model maps directly to Spring Boot patterns, making the learning curve significantly shallower than for a JS-native developer. The backend is Cloudflare Workers (Hono) with D1 for persistence, Cron Triggers for the daily alert evaluation job, and Resend for email notifications — the entire stack lives within the Cloudflare ecosystem. Split architecture (Angular SPA on Cloudflare Pages + Hono Workers API) was chosen consciously; the operational complexity of CORS and two CLIs is trivial for a seasoned backend engineer. Auth and background jobs are must-haves per PRD FRs. GitHub Actions with auto-deploy-on-merge keeps the pipeline simple for a solo developer.

## Pre-scaffold verification

| Signal      | Value                                              | Severity | Notes                                                    |
| ----------- | -------------------------------------------------- | -------- | -------------------------------------------------------- |
| npm package | @angular/cli v22.0.1 published 2026-06-11          | fresh    | resolved from cmd_template (`npx @angular/cli new ...`)  |
| GitHub repo | not run                                            | —        | docs_url is `https://angular.dev` — not a GitHub URL     |

## Scaffold log

**Resolved invocation**: `npx @angular/cli new bootstrap-scaffold --defaults --routing --style scss --skip-tests --ssr false`

> Note: `subdir-then-move` uses `.bootstrap-scaffold` as the default temp directory name. The Angular CLI v22 rejects names starting with `.` (pattern validation: `^[a-zA-Z0-9-~][a-zA-Z0-9-._~]*$`). The temp directory was renamed to `bootstrap-scaffold` (no leading dot) to satisfy the CLI constraint. The move-up mechanic and conflict policy were applied identically.

**Strategy**: subdir-then-move (adapted: temp dir `bootstrap-scaffold` instead of `.bootstrap-scaffold`)
**Exit code**: 0
**Files moved**: 18
**Conflicts (.scaffold siblings)**: `README.md.scaffold`
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**temp dir cleanup**: deleted (bootstrap-scaffold/)

Files moved:
- `.editorconfig`
- `.gitignore`
- `.prettierrc`
- `.vscode/extensions.json`
- `.vscode/launch.json`
- `.vscode/mcp.json`
- `.vscode/tasks.json`
- `angular.json`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.spec.json`
- `node_modules/` (installed tree)
- `public/favicon.ico`
- `src/main.ts`
- `src/index.html`
- `src/styles.scss`
- `src/app/app.config.ts`
- `src/app/app.html`
- `src/app/app.routes.ts`
- `src/app/app.scss`
- `src/app/app.ts`

Additional note: `.vscode` in cwd existed as a WSL2 character device (null device, `crw-rw-rw- 1 nobody nogroup 1, 3`). It was removed and replaced with the scaffold's `.vscode/` directory containing Angular's recommended VS Code config.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 3 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: 0/1/0/0 direct of total 0/3/0/0

#### CRITICAL findings

_None._

#### HIGH findings

1. **@angular/build** (direct dependency)
   - Via: `esbuild`, `vite`
   - Fix available: No
   - Root cause: `esbuild` (see below)

2. **esbuild** (transitive)
   - Advisory: GHSA-gv7w-rqvm-qjhr — Missing binary integrity verification in Deno module enables remote code execution via NPM_CONFIG_REGISTRY (CVSS 8.1)
   - Range: `>=0.17.0 <0.28.1`
   - Fix available: No (no fixed version in range yet)

3. **vite** (transitive, via esbuild)
   - Advisory: transitive from esbuild HIGH above
   - Range: `4.2.0-beta.0 - 8.0.3`
   - Fix available: Yes (but gated on esbuild upstream fix)

#### MODERATE findings

_None._

#### LOW / INFO findings

_None._ (The esbuild advisory GHSA-g7r4-m6w7-qqqr — arbitrary file read on Windows dev server — is LOW severity, CVSS 2.5, affecting esbuild `>=0.27.3 <0.28.1`.)

## Hints recorded but not acted on

| Hint                    | Value                        |
| ----------------------- | ---------------------------- |
| bootstrapper_confidence | verified                     |
| quality_override        | false                        |
| path_taken              | custom                       |
| self_check_answers      | all true (5 checks)          |
| team_size               | solo                         |
| deployment_target       | cloudflare-pages             |
| ci_provider             | github-actions               |
| ci_default_flow         | auto-deploy-on-merge         |
| has_auth                | true                         |
| has_payments            | false                        |
| has_realtime            | false                        |
| has_ai                  | false                        |
| has_background_jobs     | true                         |

These fields are preserved here for the future M1L4 "Memory Architecture" skill, which will use them to generate `CLAUDE.md`, `AGENTS.md`, and CI workflow configuration.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `README.md.scaffold` — the Angular CLI's default README vs your existing empty one. Keep whichever serves you.
- Address the 3 HIGH audit findings per your project's risk tolerance. The `esbuild` advisory (GHSA-gv7w-rqvm-qjhr) has no fix available yet; it affects the Angular build toolchain but not your production bundle. Monitor the Angular CLI releases for an update.
- This scaffold is the Angular SPA only. The Hono + Cloudflare Workers backend is a separate project — use `/10x-bootstrapper` in a second directory with a `hono` hand-off when ready.
