import { describe, it, expect, afterEach } from "vitest";
import { getPrismaClient, disconnectPrisma } from "../../src/db/prisma.js";

describe("getPrismaClient / disconnectPrisma", () => {
  afterEach(async () => {
    await disconnectPrisma();
  });

  it("returns the same client instance on repeated calls (singleton)", () => {
    const first = getPrismaClient();
    const second = getPrismaClient();
    expect(first).toBe(second);
  });

  it("creates a fresh client after disconnecting", async () => {
    const first = getPrismaClient();
    await disconnectPrisma();
    const second = getPrismaClient();
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is a no-op when no client has been created", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
