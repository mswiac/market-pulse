# Add-instrument currency prefill — Plan Brief

> Full plan: `context/changes/add-instrument-currency-prefill/plan.md`

## What & Why

The admin add-instrument form keeps EUR as currency regardless of type, forcing a manual change for every PL or US stock. Prefill the currency from the selected type (issue #200).

## Starting Point

`onTypeChange` already prefills the suffix from `SUFFIX_DEFAULTS` on a type change only. Currency is a signal defaulting to EUR.

## Desired End State

PL companies -> PLN, US companies -> USD, Index -> EUR; the admin can still override, and the override survives edits to other fields.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Index / unmapped types | Reset to EUR on every type change | Consistent with the suffix, which also resets; avoids a stale PLN after pl -> index |
| Mechanism | `CURRENCY_DEFAULTS` map in `onTypeChange` | Same pattern as `SUFFIX_DEFAULTS` |
| Tests | Unit + one E2E case for PL | Unit proves the logic, E2E proves the payload reaches the API |

## Scope

**In scope:** component change, unit test, one E2E case.

**Out of scope:** backend, new currencies, suffix behaviour, `resetForm`.

## Architecture / Approach

Frontend only: a lookup map applied in `onTypeChange`, falling back to the first currency in the list.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Prefill currency | Component change + unit + E2E | None significant |

**Prerequisites:** none. **Estimated effort:** one short session.

## Open Risks & Assumptions

- Resetting on every type change overwrites a manually chosen currency when the type is changed again; accepted, mirrors the suffix.

## Success Criteria (Summary)

- Type switch shows PLN / USD / EUR in the select.
- PL submit sends `currency: "PLN"`; existing E2E still passes.
