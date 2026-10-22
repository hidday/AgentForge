import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "PLAN_SUBMITTED",
    source: "system",
    payloadJson: { foo: "bar" },
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
    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: {} }),
      );

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "system",
          payloadJson: {},
        },
      });
      expect(result.id).toBe("evt-1");
      expect(result.payloadJson).toEqual({});
    });

    it("forwards an explicit payloadJson unchanged", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "linear",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "linear",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });
  });

  describe("findByRunId", () => {
    it("queries events for the run ordered ascending by createdAt", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeRow()]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe("run-1");
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await repo.findByRunId("run-with-no-events");
      expect(result).toEqual([]);
    });
  });
});
