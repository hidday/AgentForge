import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: { a: 1 },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates an event with the provided payloadJson", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { a: 1 },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { a: 1 },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { a: 1 },
        createdAt: makeRow().createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: {} }),
      );

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
    it("queries by runId ordered by createdAt asc and maps all rows", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2", eventType: "RUN_DONE" })];
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[1].eventType).toBe("RUN_DONE");
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
