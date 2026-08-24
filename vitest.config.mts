import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PASSWORD_PEPPER: "test-pepper-do-not-use-in-prod",
            // Never actually sent anywhere — tests stub `fetch` before any
            // Resend call is made (see test/worker/alert-evaluation.test.ts).
            RESEND_API_KEY: "test-resend-api-key",
            RESEND_VERIFIED_EMAIL: "verified@example.com",
            ADMIN_EMAILS: "admin@example.com,admin2@example.com",
          },
        },
      }),
    ],
    test: {
      // Without an explicit include, Vitest's default glob also picks up
      // src/app/**/*.spec.ts (Angular component tests, run separately via
      // `npm run test` / the @angular/build:unit-test builder) — those need
      // a DOM + the Angular JIT compiler, not the Workers runtime emulation
      // this config provides, and fail here with a JIT-compilation error.
      include: ["test/worker/**/*.test.ts"],
      setupFiles: ["./test/setup/apply-migrations.ts"],
    },
  };
});
