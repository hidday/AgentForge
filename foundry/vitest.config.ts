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
      // src/generated/** is the Prisma client, regenerated verbatim by
      // `prisma generate` from prisma/schema.prisma; it is never hand-written
      // or modified, and tsconfig.json itself excludes it from compilation.
      // src/runtime/runnerTypes.ts contains only `export interface` declarations
      // (no runtime statements survive TS compilation); @vitest/coverage-v8
      // reports a 0-statement module as 0% rather than 100%, so it can never
      // reach 100% coverage regardless of how many tests import it.
      exclude: ["src/server.ts", "src/generated/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
