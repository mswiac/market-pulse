declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PASSWORD_PEPPER: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
  interface GlobalProps {
    mainModule: typeof import("../src/worker/index");
  }
}
