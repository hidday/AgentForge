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
      // src/generated/prisma/** is Prisma-generated client code (checked in
      // by `prisma generate`), not hand-written logic; it has no branches of
      // ours to test and regenerates on schema changes.
      // src/runtime/runnerTypes.ts contains only `interface` declarations
      // (no runtime statements at all — TypeScript erases interfaces at
      // compile time), so there is no executable code for a test to cover.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
