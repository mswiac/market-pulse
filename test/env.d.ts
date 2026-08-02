declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PASSWORD_PEPPER: string;
    ASSETS: Fetcher;
    RESEND_API_KEY: string;
    RESEND_VERIFIED_EMAIL: string;
    ADMIN_EMAILS: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
  interface GlobalProps {
    mainModule: typeof import("../src/worker/index");
  }
}
