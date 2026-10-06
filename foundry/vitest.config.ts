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
      // "do not edit directly" / @ts-nocheck by the generator itself); it is
      // exercised through the repositories that use PrismaClient, not by
      // testing the generated client directly.
      exclude: ["src/server.ts", "src/generated/prisma/**"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
