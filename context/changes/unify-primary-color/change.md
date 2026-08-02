---
change_id: unify-primary-color
title: Unify primary color across buttons, table/list headers, and sidebar menu
status: implemented
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

unify the primary color used for buttons, table/list headers, and the sidebar menu — mat-toolbar doesn't inherit the M3 theme the way buttons do, and table/list headers + active menu link use --mat-sys-secondary-container instead of the buttons' --mat-sys-primary (GitHub issue #62)
