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
      // src/generated/prisma/** is Prisma-generated client code (marked
      // "Do not edit directly" with @ts-nocheck); it has no hand-written
      // logic to test.
      // runnerTypes.ts contains only `interface`/`type` declarations, which
      // are erased at compile time; there is no executable statement in the
      // file for a test to exercise.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
