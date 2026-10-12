import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  describe("create", () => {
    it("creates an event with the provided payload and maps the result", async () => {
      const row = makeRow({ payloadJson: { foo: "bar" } });
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual(row);
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      const prisma = makePrisma({ create: vi.fn().mockResolvedValue(row) });
      const repo = new EventRepository(prisma);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered ascending by creation time and maps every row", async () => {
      const rows = [makeRow({ id: "a" }), makeRow({ id: "b", eventType: "PLAN_APPROVED" })];
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue(rows) });
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[1].eventType).toBe("PLAN_APPROVED");
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrisma({ findMany: vi.fn().mockResolvedValue([]) });
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
