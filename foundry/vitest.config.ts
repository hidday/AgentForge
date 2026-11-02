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
      // generated/prisma is Prisma's auto-generated client code (checked in
      // for editor/type support); it has no hand-written logic to test and
      // is regenerated from prisma/schema.prisma by `prisma generate`.
      // runnerTypes.ts contains only `interface`/`type` declarations erased
      // at compile time -- it has zero runtime statements, so there is
      // nothing a test could execute or assert against.
      exclude: ["src/server.ts", "src/generated/prisma/**", "src/runtime/runnerTypes.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
