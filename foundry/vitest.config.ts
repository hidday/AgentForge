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
      // src/generated/prisma is Prisma-generated client code ("Do not edit
      // directly", @ts-nocheck) checked in for the build; it is not
      // hand-written logic and is exercised transitively via the repository
      // classes that wrap it, not via direct unit tests.
      // src/runtime/runnerTypes.ts contains only `export interface` type
      // declarations (no values, no functions) and is consumed everywhere
      // exclusively via `import type`, which TypeScript erases at compile
      // time; the file therefore compiles to an empty module that is never
      // loaded into the JS runtime, so v8 has no statements to instrument
      // and no test can ever execute it.
      exclude: ["src/server.ts", "src/generated/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
