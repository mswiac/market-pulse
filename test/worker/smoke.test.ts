import { env } from "cloudflare:workers";
import { it } from "vitest";

it("has the DB binding available", ({ expect }) => {
  expect(env.DB).toBeDefined();
});
