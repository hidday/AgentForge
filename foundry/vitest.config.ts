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
        // Prisma-generated client code (gitignored, @ts-nocheck'd, regenerated
        // by `prisma generate`); it is not hand-written and not unit-testable.
        "src/generated/**",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
