import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // server.ts is the process entrypoint (starts Fastify, binds ports);
      // it is exercised by running the app, not by unit tests.
      // src/generated/prisma/** is Prisma's auto-generated client (gitignored,
      // regenerated fresh by `prisma generate` on every install) -- it is not
      // source we own or can meaningfully unit test.
      // src/runtime/runnerTypes.ts contains only `export interface` type
      // declarations with zero runtime statements (TypeScript erases them at
      // compile time), so there is nothing executable to cover.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
