# Refresh Project Docs Implementation Plan

## Overview

Bring three living documents back in line with what has shipped (issue #207): add the alert pause/resume mention to `README.md` and slim the README down to its essentials by moving reference material into `context/foundation/`; backfill `context/foundation/roadmap.md` with the product-facing changes archived since S-12; and refresh the stale rollout status, spec counts and ledger in `context/foundation/test-plan.md`. Documentation only — no code, tests, migrations or config change.

## Current State Analysis

- `README.md` is 220 lines / 7 sections. "Pages → Alerts" mentions only filters and "New alert" (`README.md:8`), so the Pause/Resume button and "Paused" status from #199 are undocumented. Admin panel, CI / quality gate, Mutation testing and Project structure notes are reference material rather than onboarding.
- `context/foundation/` already holds topic notes (`admin-panel-notes.md`, `stryker-notes.md`). `stryker-notes.md` already contains the Stryker commands and gotchas that README's "Mutation testing" section summarises; `admin-panel-notes.md:4` points back at README's "Admin panel" section.
- `roadmap.md` stops at S-12 (frontmatter `updated: 2026-08-14`). Roughly 14 product-facing changes archived since then have no entry.
- `test-plan.md`: §3 Phase 5 says "not started" although `context/archive/2026-08-25-admin-panel-component-coverage/` is archived; Phase 6 row says "Four Playwright specs" and "State (2026-08-28)" lists four, but `e2e/` now holds 18 spec files from five change folders; §4 e2e row says "Two browser-level smoke scenarios only"; §8 ledger has no entry for the cron work, `worker-test-gaps`, `full-repo-stryker-run`, or the new e2e changes (its latest entry, 2026-10-10 admin infra, is out of date order after 2026-08-28).
- `roadmap.md` and `test-plan.md` are not Prettier-clean on `main`; `README.md`, `stryker-notes.md` and `admin-panel-notes.md` are.

## Desired End State

- `README.md` keeps: intro paragraph, a 2-3 line product summary (pages and admin panel in brief, with links out), **Running locally**, **Deployment**, and a short "More documentation" link list. Alert pause/resume is mentioned.
- New `context/foundation/app-overview.md` (Pages + Admin panel) and `context/foundation/ci-and-repo-notes.md` (CI / quality gate + Project structure notes). Mutation testing README content is dropped in favour of `stryker-notes.md`, which already carries it.
- `roadmap.md` has a row in "At a glance" and a bullet in "Done" for each backfilled change, with `updated` bumped.
- `test-plan.md` reflects Phase 5 shipped, the real e2e inventory, and ledger entries for the unrecorded work; the risk map is untouched.
- Verified by: every file path referenced from the edited docs exists, no dangling README section references remain, Prettier clean on files that were clean before.

### Key Discoveries:

- `stryker-notes.md` already documents both profiles and commands, so no new mutation file is needed.
- `admin-panel-notes.md:4` references README's "Admin panel" section and must be repointed.
- Remaining README text cross-references sections that will move: "see 'Admin panel' above" (Local secrets) and "see 'End-to-end tests' above" (CI section, which moves). Both must be fixed.
- `roadmap.md` Done bullets use the format `- **<ID>: <Outcome>** — Archived <date> → <archive path>. Lesson: —.`; the archive step stamps `archived_at` in each `change.md`.

## What We're NOT Doing

- Not running `/10x-roadmap` or `/10x-test-plan --refresh`; no new risks, no risk-map or strategy (§1–§5) changes.
- Not adding full `### S-NN` bodies, Backlog Handoff rows or Streams entries for backfilled items — table row plus Done bullet only.
- Not putting test-only archives (`worker-test-gaps`, `full-repo-stryker-run`, `e2e-*`) in the roadmap; they go to the test-plan ledger.
- Not reformatting `roadmap.md` / `test-plan.md` with Prettier (pre-existing drift, would bloat the diff).
- Not touching `CLAUDE.md`, code, tests, `docs/` or the archive.

## Implementation Approach

Three phases, one per document group, each independently reviewable. Content moves are verbatim where possible (relocate, then fix only cross-references and stale facts), so the diff shows relocation rather than rewrite. English throughout (repo rule).

## Phase 1: README pause mention and split

### Overview

Add the pause/resume mention, relocate reference sections, and leave README as a short entry point.

### Changes Required:

#### 1. App overview note

**File**: `context/foundation/app-overview.md` (new)

**Intent**: Hold the full Pages and Admin panel descriptions moved out of README, with the pause/resume addition, so there is one canonical description of user-facing behaviour.

**Contract**: Sections `## Pages` and `## Admin panel`, content moved from README. The Alerts bullet gains: pause/resume button per alert, "Paused" status, paused alerts are skipped by the daily cron (no emails, no re-arm) until resumed. Keeps the pointer to `admin-panel-notes.md`. Starts with a one-line statement of what the file is.

#### 2. CI and repo notes

**File**: `context/foundation/ci-and-repo-notes.md` (new)

**Intent**: Hold the CI / quality gate section and the Project structure notes moved out of README.

**Contract**: Sections `## CI / quality gate` and `## Project structure notes`, content moved verbatim, with references to "End-to-end tests above" rewritten to point at README's "End-to-end tests (Playwright)" section by name and "Deployment" by name; the mutation bullet points to `stryker-notes.md`.

#### 3. README

**File**: `README.md`

**Intent**: Shrink to intro, brief product summary, Running locally, Deployment, and a link list.

**Contract**: Remove `## Pages`, `## Admin panel`, `## CI / quality gate`, `## Mutation testing`, `## Project structure notes`. Replace Pages/Admin with a 2-3 line summary (dashboard, alerts with filters and pause/resume, history, admin panel for admins) linking to `context/foundation/app-overview.md`. Add `## More documentation` listing `app-overview.md`, `admin-panel-notes.md`, `ci-and-repo-notes.md`, `stryker-notes.md`, `test-plan.md`. Fix the "see 'Admin panel' above" reference in Local secrets to point to `app-overview.md`; fix the "Checks before pushing" and E2E references that targeted moved sections.

#### 4. Admin panel notes

**File**: `context/foundation/admin-panel-notes.md`

**Intent**: Repoint the reference from README's removed "Admin panel" section.

**Contract**: Line 4 now references `app-overview.md`'s "Admin panel" section.

### Success Criteria:

#### Automated Verification:

- Moved sections are gone from README and present in the new files: `grep -c "^## " README.md` shows only intro-level sections, `grep -n "^## " context/foundation/app-overview.md context/foundation/ci-and-repo-notes.md`
- No dangling section references: `grep -nE "Admin panel\" (above|section)|End-to-end tests\" above" README.md context/foundation/*.md` returns nothing stale
- Every path referenced in README and the two new files exists: `grep -ohE "(context|src|e2e|test|\.github)/[A-Za-z0-9_./-]+" README.md context/foundation/app-overview.md context/foundation/ci-and-repo-notes.md | sort -u | xargs -I{} sh -c 'test -e "{}" || echo MISSING {}'` prints no MISSING
- Prettier clean: `npx prettier --check README.md context/foundation/app-overview.md context/foundation/ci-and-repo-notes.md context/foundation/admin-panel-notes.md`
- Only Markdown changed: `git diff --name-only main | grep -v '\.md$'` prints nothing

#### Manual Verification:

- README reads as a coherent entry point (intro, summary, run locally, deploy, links) and the pause/resume mention is accurate
- No content from the removed sections was lost (spot-check Admin panel and CI workflow bullets against the new files)

**Implementation Note**: After automated verification passes, pause for the human to confirm the manual checks before the phase commit.

---

## Phase 2: Roadmap backfill

### Overview

Record the product-facing changes shipped since S-12 in `roadmap.md`.

### Changes Required:

#### 1. Roadmap rows and Done entries

**File**: `context/foundation/roadmap.md`

**Intent**: Make the roadmap complete up to now without inventing full slice bodies for work that is already shipped.

**Contract**: Append rows `S-13`…`S-26` (Status `done`) to `## At a glance`, and matching bullets to `## Done`, in archive order, for these change IDs: `admin-cron-trigger`, `alert-list-long-names`, `remove-user-loading-flash`, `ai-review-workflow`, `alerts-list-filtering`, `instrument-picker-search`, `alerts-ux-polish`, `cron-run-capacity`, `dashboard-page`, `per-market-cron-triggers`, `admin-per-market-refresh`, `cron-failure-email`, `add-instrument-currency-prefill`, `manual-alert-pause`. Outcome text is one line taken from each archived `change.md`/`plan-brief.md`; prerequisites column `—` unless the archived plan names one; PRD refs `—`. Done bullets use the existing format with each change's real `archived_at` date and archive folder path. Table sorted by archive date, which differs from the S-NN dependency order of earlier rows — acceptable since backfilled items are independent. Bump frontmatter `updated` to today. Do not touch existing rows or Backlog Handoff.

### Success Criteria:

#### Automated Verification:

- Every backfilled archive path exists: `grep -oE "context/archive/[0-9-]+[a-z0-9-]+/" context/foundation/roadmap.md | sort -u | xargs -I{} test -d {}`
- Each of the 14 change IDs appears in both the table and Done: `for id in admin-cron-trigger alert-list-long-names remove-user-loading-flash ai-review-workflow alerts-list-filtering instrument-picker-search alerts-ux-polish cron-run-capacity dashboard-page per-market-cron-triggers admin-per-market-refresh cron-failure-email add-instrument-currency-prefill manual-alert-pause; do [ "$(grep -c "$id" context/foundation/roadmap.md)" -ge 2 ] || echo MISSING $id; done`
- Existing rows unchanged: `git diff main -- context/foundation/roadmap.md | grep '^-' | grep -v '^---'` shows only the frontmatter `updated` line

#### Manual Verification:

- Outcome lines read accurately and none overstate what shipped
- Placement/ordering in the table and Done list looks sensible

**Implementation Note**: Pause for human confirmation of the manual checks before the phase commit.

---

## Phase 3: Test-plan targeted refresh

### Overview

Correct stale status and inventory in `test-plan.md` and log the unrecorded work, without touching the risk map or strategy.

### Changes Required:

#### 1. Header, rollout table and Phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: Make the rollout status and e2e description truthful.

**Contract**: Header gets a dated note (this refresh: targeted manual edit, no risk-map change). §3 Phase 5 row: Status `shipped`, change folder `context/archive/2026-08-25-admin-panel-component-coverage/`. §3 Phase 6 row: replace "Four Playwright specs" with the real inventory (spec count counted at implementation time via `ls e2e/*.spec.ts e2e/admin/*.spec.ts`) and list the follow-on change folders (`e2e-admin-account-infra`, `e2e-user-flows`, `e2e-admin-management`, `e2e-admin-cron-run`); add one short "State (2026-10-10)" paragraph under Phase 6 after the existing 2026-08-28 one rather than rewriting it. §4 e2e row: replace "Two browser-level smoke scenarios only" with the broader description.

#### 2. Ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Record work that was never logged.

**Contract**: Add §8 entries (dated, one to three lines each, grouped) for: `admin-cron-trigger`/`cron-run-capacity`/`per-market-cron-triggers`/`admin-per-market-refresh`/`cron-failure-email` (cron behaviour covered by worker tests; no risk-map delta), `worker-test-gaps`, `full-repo-stryker-run`, `manual-alert-pause` (worker + component + e2e coverage), and the e2e change series. Move the existing out-of-order 2026-10-10 admin-infra entry into chronological position. Update "Strategy last reviewed" only if the human agrees it was effectively reviewed; otherwise leave it.

### Success Criteria:

#### Automated Verification:

- Stale phrases gone: `grep -nE "Four Playwright specs|not started|Two browser-level smoke scenarios only" context/foundation/test-plan.md` returns nothing
- Referenced archive paths exist: `grep -oE "context/archive/[0-9-]+[a-z0-9-]+/" context/foundation/test-plan.md | sort -u | xargs -I{} test -d {}`
- Risk map and strategy untouched: `git diff main -- context/foundation/test-plan.md | grep -E '^[-+]\| [0-9] \|'` prints no risk-table rows
- Only Markdown changed: `git diff --name-only main | grep -v '\.md$'` prints nothing

#### Manual Verification:

- Spec counts and Phase 5/6 statements match reality (`ls e2e` and the archive)
- Ledger entries are accurate and in chronological order

**Implementation Note**: Pause for human confirmation of the manual checks before the phase commit.

---

## Testing Strategy

Docs-only: verification is path-existence checks, stale-phrase greps, Prettier on files that were clean before, a "Markdown only" diff guard, and human read-through. No automated test suite is affected; `npm run ci` is not required but the pre-push hook will run as usual.

## Migration Notes

None. Links into the moved sections (`README.md#admin-panel` anchors) were grepped repo-wide at plan time and only `admin-panel-notes.md` references the Admin panel section; re-grep in Phase 1 to confirm.

## References

- Issue: #207
- Existing notes convention: `context/foundation/admin-panel-notes.md`, `context/foundation/stryker-notes.md`
- Roadmap Done format: `context/foundation/roadmap.md` (`## Done`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: README pause mention and split

#### Automated

- [x] 1.1 Moved sections removed from README and present in new foundation files
- [x] 1.2 No dangling section references to moved README sections
- [x] 1.3 Every path referenced in README and new files exists
- [x] 1.4 Prettier clean on README and touched foundation notes
- [x] 1.5 Diff contains only Markdown files

#### Manual

- [ ] 1.6 README reads as a coherent entry point and pause/resume mention is accurate
- [ ] 1.7 No content lost from the removed sections

### Phase 2: Roadmap backfill

#### Automated

- [ ] 2.1 Every backfilled archive path exists
- [ ] 2.2 Each of the 14 change IDs appears in both table and Done
- [ ] 2.3 Existing roadmap rows unchanged (only frontmatter `updated` differs)

#### Manual

- [ ] 2.4 Outcome lines read accurately
- [ ] 2.5 Table and Done ordering looks sensible

### Phase 3: Test-plan targeted refresh

#### Automated

- [ ] 3.1 Stale phrases gone from test-plan.md
- [ ] 3.2 Referenced archive paths exist
- [ ] 3.3 Risk map and strategy rows untouched
- [ ] 3.4 Diff contains only Markdown files

#### Manual

- [ ] 3.5 Spec counts and Phase 5/6 statements match reality
- [ ] 3.6 Ledger entries accurate and chronological
