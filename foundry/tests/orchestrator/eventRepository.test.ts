import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "orchestrator",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
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
    it("creates an event with the given payload", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow());
      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });
      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "orchestrator",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result.id).toBe("evt-1");
      expect(result.payloadJson).toEqual({ foo: "bar" });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "orchestrator",
      });
      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payloadJson: {} }),
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered ascending by createdAt", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "evt-2" })]);
      const result = await repo.findByRunId("run-1");
      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
    });

    it("returns an empty array when there are no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });
});
