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
      // src/generated/** is Prisma-generated client code (not hand-written,
      // regenerated from the schema); it is exercised via mocks in tests,
      // never executed directly, so it is excluded from coverage.
      // src/runtime/runnerTypes.ts contains only `interface` declarations,
      // which TypeScript erases entirely at compile time; there is no
      // runtime code in the emitted JS for v8 to exercise or for a test to
      // meaningfully cover.
      exclude: ["src/server.ts", "src/generated/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
