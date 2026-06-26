# Review Follow-ups: backend-scaffold

## F3 — notification_email format guard (defer to S-01)

**Finding**: `migrations/0001_create_users.sql:5` — `notification_email TEXT NOT NULL` accepts any non-null string. Migration is already applied to local and remote D1.

**Action for S-01 planning**:
1. Add a new migration (e.g. `0002_add_email_check.sql`) with a `CHECK` constraint as defense-in-depth:
   ```sql
   -- Cannot ALTER TABLE in SQLite to add CHECK; recreate via new migration or accept app-layer-only validation
   ```
   Note: SQLite does not support `ALTER TABLE ... ADD CONSTRAINT`. If a schema-level guard is wanted, the table must be recreated. Evaluate cost vs. benefit during S-01 planning — application-layer validation in the registration endpoint is likely sufficient.
2. Validate email format in the S-01 registration endpoint before any DB insert.
