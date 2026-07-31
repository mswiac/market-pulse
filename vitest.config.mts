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
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup/apply-migrations.ts"] },
  };
});
