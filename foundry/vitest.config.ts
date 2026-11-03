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
      // src/generated/prisma/** is Prisma-generated client code ("Do not
      // edit directly"); it is untestable application logic, not ours.
      // runnerTypes.ts contains only `export interface` declarations, which
      // TypeScript erases entirely at compile time (zero emitted statements);
      // there is no executable code in the file for any test to exercise.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
