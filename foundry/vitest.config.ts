import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // server.ts is the process entrypoint (starts Fastify, binds ports);
        // it is exercised by running the app, not by unit tests.
        "src/server.ts",
        // Prisma-generated client code ("Do not edit directly" / @ts-nocheck);
        // it has no hand-written logic to unit test.
        "src/generated/**",
        // Pure type/interface declarations with no runtime code to execute.
        "src/runtime/runnerTypes.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
