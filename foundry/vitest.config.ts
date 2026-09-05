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
      // src/generated/** is Prisma's auto-generated client code (regenerated
      // by `prisma generate` from prisma/schema.prisma), not hand-authored.
      exclude: ["src/server.ts", "src/generated/**"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
