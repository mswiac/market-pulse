# E2E generation prompt — admin instrument and user management

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seeds
(`e2e/seed.spec.ts`, `e2e/admin/admin-gate-pass.spec.ts`, cleanup pattern from
`e2e/delete-alert.spec.ts`) and the E2E rules (`CLAUDE.md` § "10xDevs AI
Toolkit - Module 3, Lesson 4") are the levers — this file carries only what they
can't know.

```text
We are adding E2E tests for this risk from context/foundation/test-plan.md:
Risk #8 (admin panel UI for destructive / irreversible actions), applied by
analogy as in the cron-run prompt: add-instrument, remove-instrument and
remove-user are admin screens whose actions write to (and delete from) D1, with
confirm dialogs gating the deletions. Nothing in the browser proves the UI sends
the right target, that the dialog cannot be bypassed, or that a confirmed delete
really persists.

Research anchor:
context/changes/e2e-admin-management/plan.md (GitHub issue #185).
src/app/features/admin/{add-instrument,remove-instrument,remove-user}/ and their
*-confirm dialogs; src/worker/routes/admin.ts (POST /instruments, GET
/instruments/:ticker/impact, DELETE /instruments/:ticker, GET /users, GET
/users/:id/impact, DELETE /users/:id); POST /api/register in
src/worker/routes/auth.ts (returns the new id, sets a session cookie).

Business scenarios (observable behaviors that must stay true):
1. Add instrument: submitting the form makes the instrument selectable in the
   instrument picker (after a full reload), with the typed ticker uppercased.
2. Remove instrument: the impact dialog names the instrument; confirming removes
   it from the picker and the server; cancelling removes nothing.
3. Remove user: the impact dialog names the user's email; confirming removes
   them from the list and they can no longer log in; cancelling keeps them.
4. The admin cannot delete themselves: their own account is not offered in the
   list, and a direct DELETE of their own id is rejected (403 cannot_delete_self).

Real boundaries (do not mock — the risk hides here):
Admin session (storageState), adminGuard, router, dialogs, the admin API and
local D1, instrument list reload, session/login of the removed user.

Mocked boundaries (mock at network layer):
None. Data is created through the API with run-unique ids and removed in
afterEach.

Write Playwright tests following seed.spec.ts patterns and the E2E rules.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression each test catches.
```

**Regressions caught:** the add form posting a wrong/un-normalized payload or not
reloading the instrument list; a delete dialog that can be bypassed, that sends
the wrong ticker/id, or whose confirmed delete does not persist; a cancel that
still deletes; and an admin self-delete guard that stops working.
