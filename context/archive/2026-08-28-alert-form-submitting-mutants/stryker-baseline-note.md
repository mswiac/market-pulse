# Stryker baseline — alert-form.ts:146-181 (pre-change)

Command:
`npx stryker run stryker.config.app.json --mutate "src/app/features/alerts/alert-form/alert-form.ts:146-181"`

Run 2026-08-28 21:06 on pristine `alert-form.spec.ts` (4 validator tests, zero
`onSubmit` coverage). Whole-file scope is infeasible — instrumenting the
`form = this.fb.nonNullable.group({...})` initializer widens `this.form`'s type
and `strictTemplates` fails to compile `alert-form.html`; hence the `:146-181`
line range (`onSubmit` + `messageFor`).

## Result: 42 / 42 survived (0 killed) — mutation score 0.00

By line (mutators):

| Line | # | Mutators | In #114 scope? |
| --- | --- | --- | --- |
| 146 | 1 | BlockStatement (`onSubmit` body) | guard |
| 147 | 5 | ConditionalExpression, LogicalOperator ×2 | **guard — target** |
| 149 | 1 | CallExpression (`formError.set(null)`) | borderline |
| 150 | 1 | BooleanLiteral (`submitting.set(true)`) | **submitting — target** |
| 152 | 1 | ObjectLiteral (payload) | out — payload construction (#110) |
| 158 | 2 | CallExpression, ObjectLiteral (`request$.subscribe`) | partial — error path |
| 159 | 2 | ArrowFunction, BooleanLiteral (`next: () => dialogRef.close(true)`) | out — success-close (#110) |
| 160 | 1 | BlockStatement (error handler body) | **submitting — target** |
| 161 | 1 | BooleanLiteral (`submitting.set(false)`) | **submitting — target** |
| 162 | 1 | CallExpression (`formError.set(messageFor(err))`) | **messageFor — target** |
| 167 | 1 | BlockStatement (`messageFor` body) | messageFor |
| 168 | 3 | ConditionalExpression, BlockStatement (`err instanceof HttpErrorResponse`) | messageFor |
| 169 | 4 | ConditionalExpression, BlockStatement, EqualityOperator (`status === 409`) | **messageFor — target** |
| 170 | 1 | StringLiteral (duplicate msg) | **messageFor — target** |
| 172 | 4 | ConditionalExpression, EqualityOperator, BlockStatement (`status === 404`) | **messageFor — target** |
| 173 | 1 | StringLiteral (notFound msg) | **messageFor — target** |
| 175 | 1 | OptionalChaining (`err.error?.code`) | out — deep edge (#110) |
| 176 | 9 | ConditionalExpression, LogicalOperator, EqualityOperator, BlockStatement, StringLiteral (`status === 400 && code === 'rsi_not_eligible'`) | **messageFor — target** |
| 177 | 1 | StringLiteral (rsi msg) | **messageFor — target** |
| 180 | 1 | StringLiteral (generic msg) | **messageFor — target** |

Targeted class ≈ 34 mutants (L146-147, L150, L160-162, L167-180 branch logic).
Expected residual survivors after Phase 1+2 (out of #114 scope → #110):
L152 (payload object), L158-159 (success-path subscribe / dialog-close — no
success test), L175 (optional-chaining edge), possibly L149.

## alert-form.html:85 `[disabled]` binding — deliberate-break (not Stryker)

`|| loadError()` → `&& loadError()`: fails "keeps the submit button disabled …
while the create is in flight" + "… while an edit is in flight" (2 tests).
The Angular `command` runner does not mutate `.html` templates, so this is
verified by hand, not by the Stryker score.
