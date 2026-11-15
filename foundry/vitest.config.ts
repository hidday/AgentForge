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
      // src/generated/** is Prisma's generated client code, not hand-written
      // and regenerated from the schema; excluded from coverage.
      // runnerTypes.ts contains only `interface`/`import type` declarations
      // (no executable statements), so there is nothing a test could cover.
      exclude: ["src/server.ts", "src/generated/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
