# Stryker after — alert-form.ts:146-181 (post-change)

Command (identical to baseline):
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:146-181"`

Run 2026-08-28 21:22 on the final `alert-form.spec.ts` (4 validator + 7
submit-guard + 6 messageFor blocks = 17 tests).

## Result: 37 / 42 detected (88.10%) — was 0 / 42 (0.00%)

| | baseline | after |
| --- | --- | --- |
| Killed | 0 | 33 |
| Timeout (detected) | 0 | 4 |
| Survived | 42 | 5 |

Timeouts are detections — a mutant that empties `onSubmit`'s body / guard /
`subscribe` / error handler makes an in-flight test wait forever for state that
never arrives; Stryker's timeout catches it. Detected: L146, L147, L158, L160.

## Targeted class (issue #114) — 100 % dead

| Mutant | Line | Status |
| --- | --- | --- |
| `if (form.invalid \|\| submitting() \|\| loadError()) return;` (Conditional, Logical ×2) | 147 | Killed / Timeout |
| `submitting.set(true)` → `set(false)` | 150 | Killed |
| error handler body / `submitting.set(false)` → `set(true)` | 160–161 | Killed / Timeout |
| `formError.set(messageFor(err))` | 162 | Killed |
| `messageFor`: `instanceof` block, `status === 409/404`, `status === 400 && code === 'rsi_not_eligible'` (Conditional, Equality, Logical), every `$localize` StringLiteral | 168–180 | Killed |

Plus `alert-form.html:85` `[disabled]="… \|\| submitting() \|\| loadError()"`:
`\|\|` → `&&` fails "keeps the submit button disabled … in flight" (create + edit,
2 tests). Verified by deliberate break — the Angular `command` runner does not
mutate `.html` templates, so this is not in the Stryker score.

## 5 residual survivors — all outside #114's scope → #110 backlog

| Line | Mutant | Why out of scope |
| --- | --- | --- |
| 149 | `formError.set(null)` → removed | "clear stale error on retry" — not the submit guard or the error-map; needs a fail-then-resubmit test |
| 152 | `payload` object → `{}` | payload construction, not the guard; needs a `toHaveBeenCalledWith` assertion |
| 159 | `next: () => dialogRef.close(true)` → `() => undefined` | success-path dialog close — no success test in this change |
| 159 | `dialogRef.close(true)` → `close(false)` | same — the success-close argument |
| 168 | `if (err instanceof HttpErrorResponse)` → `if (true)` | **equivalent** for realistic inputs: a non-`HttpErrorResponse` `err` falls through `status === 409/404`, `err.error?.code`, `status === 400 && …` (all false) and returns the generic message — exactly the original's `else` path. Only a `null`/`undefined` thrown value would differ, which no HTTP client produces. |
