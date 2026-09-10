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
      // src/generated/prisma/** is Prisma-generated client code (regenerated
      // by `prisma generate`, marked "Do not edit directly" with @ts-nocheck);
      // it is not hand-written and has no behavior of ours to unit test.
      exclude: ["src/server.ts", "src/generated/**"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
