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
        // src/generated/prisma is emitted by `prisma generate` (postinstall);
        // it is generated code, not hand-written logic, and is regenerated
        // verbatim from prisma/schema.prisma on every install.
        "src/generated/**",
        // runnerTypes.ts contains only `export interface` declarations, which
        // TypeScript erases entirely at compile time; there is no executable
        // statement in this file to ever cover.
        "src/runtime/runnerTypes.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
