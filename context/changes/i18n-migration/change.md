---
change_id: i18n-migration
title: Adopt Angular i18n ($localize) to move Polish strings out of source code
status: implemented
created: 2026-07-19
updated: 2026-07-19
archived_at: null
---

## Notes

Decided in chat: replace hardcoded Polish UI strings in templates/`.ts` with Angular's
built-in i18n (`$localize` + XLIFF), not ngx-translate or a custom message dictionary.
Source-language templates will read in English; `messages.pl.xlf` holds the Polish
translations; build compiles a single `pl` locale output (no multi-locale switching
needed — the app is Polish-only).

Motivation: user does not want Polish strings living directly in source code, independent
of GitHub issue #23 (which is just a straight EN→PL translation of `login.html`/
`register.html` text, no i18n framework involved).

Confirmed non-issue: this is purely a build-time transform on the Angular frontend
(deployed as static output to Cloudflare Pages) — no runtime translation lookup, no
impact on the Cloudflare Workers CPU budget (that budget applies only to the Hono
backend/cron; see the PBKDF2-cap note).

Rough estimate discussed: ~110-125 hand-written lines changed (i18n attributes across
5 templates + `$localize` wraps in 4 `.ts` files + angular.json/package.json/tsconfig/
main.ts config), plus ~700-900 lines of largely auto-generated XLIFF content
(`messages.xlf` source + `messages.pl.xlf` translations) for the ~58 existing
user-facing strings currently in the app.
