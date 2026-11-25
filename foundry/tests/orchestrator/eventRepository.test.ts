import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "orchestrator",
    payloadJson: {},
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
  };
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma as never);
  });

  describe("create", () => {
    it("defaults payloadJson to an empty object when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_REQUESTED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
      expect(result.id).toBe("event-1");
    });

    it("passes through an explicit payloadJson", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: { from: "A", to: "B" } }));

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "human",
        payloadJson: { from: "A", to: "B" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_APPROVED",
          source: "human",
          payloadJson: { from: "A", to: "B" },
        },
      });
      expect(result.payloadJson).toEqual({ from: "A", to: "B" });
    });
  });

  describe("findByRunId", () => {
    it("queries events ordered ascending by createdAt", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-1");

      expect(result).toEqual([]);
    });
  });
});
