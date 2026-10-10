# E2E generation prompt — account flow

Filled from `.claude/skills/10x-e2e/references/e2e-prompt-template.md`. Seed
(`e2e/seed.spec.ts`) and the E2E rules (`CLAUDE.md`) are the levers — this file
carries only what they can't know.

```text
We are adding E2E tests for these risks from context/foundation/test-plan.md:
Risk #4 (auth form input handling regresses silently) and Risk #6 (session
boundary): a user can register, log out, and log back in; a wrong password or a
taken email is rejected with a message; after logout protected pages are gone.

Research anchor:
register.ts navigates to '/' on success; the shell "Wyloguj" button calls
AuthService.logout() and navigates to /login; authGuard redirects an
unauthenticated visit to /login. Login failure renders "Nieprawidłowy e-mail
lub hasło."; a 409 on register renders "Ten adres e-mail jest już
zarejestrowany.".

Business scenarios (one observable behavior each):
1. Register -> reach the dashboard -> log out -> /alerts redirects to login ->
   log in again with the same credentials -> dashboard.
2. Wrong password -> error message, still on /login.
3. Registering an already-registered email -> taken message, not logged in.

Real boundaries (do not mock): POST /api/register, /api/login, /api/logout,
session cookie, authGuard, router, D1.

Mocked boundaries (mock at network layer):
None.

Cleanup: users are global rows and only an admin can delete them, so the spec
lives in e2e/admin/, starts with an empty storageState (anonymous browser), and
removes every created user through an admin-session request context.
```
