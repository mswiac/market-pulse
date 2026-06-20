---
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
---

## Why this stack

A solo backend developer with 10+ years of Java/Scala experience learning Angular while shipping a market-alerts MVP in 3 weeks after-hours. Angular is the natural frontend choice for a developer already fluent in DI, typed systems, and opinionated frameworks — its Component/Injectable model maps directly to Spring Boot patterns, making the learning curve significantly shallower than for a JS-native developer. The backend is Cloudflare Workers (Hono) with D1 for persistence, Cron Triggers for the daily alert evaluation job, and Resend for email notifications — the entire stack lives within the Cloudflare ecosystem. Split architecture (Angular SPA on Cloudflare Pages + Hono Workers API) was chosen consciously; the operational complexity of CORS and two CLIs is trivial for a seasoned backend engineer. Auth and background jobs are must-haves per PRD FRs. GitHub Actions with auto-deploy-on-merge keeps the pipeline simple for a solo developer.
