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
      // with an explicit "Do not edit directly" / @ts-nocheck header); it has
      // no hand-written logic to test.
      // src/runtime/runnerTypes.ts contains only `interface`/`import type`
      // declarations, which TypeScript erases entirely at compile time —
      // there are zero runtime statements to exercise.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
