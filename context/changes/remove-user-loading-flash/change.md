---
change_id: remove-user-loading-flash
title: Fix "no users" flash on Remove user admin page before picker loads
status: impl_reviewed
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

GitHub issue #149: "Remove user" admin page flashes "No users available to remove." before the user picker loads.

Root cause: `users` signal starts as `[]`, and `noUsers` computed (`users().length === 0`) evaluates true until `fetchUsers()` resolves — there's no distinct loading state, so the empty-state error branch renders briefly on every page load.

Files: src/app/features/admin/remove-user/remove-user.ts, src/app/features/admin/remove-user/remove-user.html

Suggested direction (not decided, needs planning): add a `loading` signal (default true, cleared in fetchUsers()'s next/error callback), gate the three template branches on it: loading → spinner/nothing, else loadError → error, else noUsers → empty state, else → picker.
