import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "api",
    payloadJson: { x: 1 },
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
    it("forwards the given payloadJson and returns the mapped event", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow());

      const result = await repo.create({
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "api",
        payloadJson: { x: 1 },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_REQUESTED",
          source: "api",
          payloadJson: { x: 1 },
        },
      });
      expect(result.id).toBe("event-1");
      expect(result.payloadJson).toEqual({ x: 1 });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({ runId: "run-1", eventType: "BLOCKED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "BLOCKED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("propagates errors from prisma", async () => {
      prisma.aiEvent.create.mockRejectedValue(new Error("fk violation"));
      await expect(
        repo.create({ runId: "missing", eventType: "BLOCKED", source: "system" }),
      ).rejects.toThrow("fk violation");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps all rows", async () => {
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

    it("returns an empty array when there are no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });
});
