import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "api",
    payloadJson: { a: 1 },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repo = new EventRepository(prisma as unknown as PrismaClient);
  });

  describe("create", () => {
    it("creates an event with the provided payload", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow());
      const result = await repo.create({
        runId: "run-1",
        eventType: "SOME_EVENT",
        source: "api",
        payloadJson: { a: 1 },
      });
      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "SOME_EVENT",
          source: "api",
          payloadJson: { a: 1 },
        },
      });
      expect(result.id).toBe("event-1");
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      await repo.create({ runId: "run-1", eventType: "SOME_EVENT", source: "api" });
      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "SOME_EVENT",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered by createdAt asc, mapped", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
      const result = await repo.findByRunId("run-1");
      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["event-1", "event-2"]);
    });

    it("returns an empty array when there are none", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-1");
      expect(result).toEqual([]);
    });
  });
});
