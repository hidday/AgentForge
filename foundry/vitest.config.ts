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
      // src/generated/** is Prisma-generated client code, not hand-written
      // logic; it is regenerated from the schema and owned by `prisma generate`.
      // runnerTypes.ts contains only `export interface`/`import type`
      // declarations, which are fully erased at compile time (no runtime
      // statements exist to exercise).
      exclude: ["src/server.ts", "src/generated/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
