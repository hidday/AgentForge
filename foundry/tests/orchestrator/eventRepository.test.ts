import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: { skillIds: ["a"] },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeMockPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository", () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    mockPrisma = makeMockPrisma();
    repo = new EventRepository(mockPrisma as never);
  });

  describe("create", () => {
    it("passes the provided payloadJson through and maps the returned row", async () => {
      const row = makeRow();
      mockPrisma.aiEvent.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["a"] },
      });

      expect(mockPrisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["a"] },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["a"] },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      mockPrisma.aiEvent.create.mockResolvedValue(row);

      await repo.create({
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "orchestrator",
      });

      expect(mockPrisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to an empty object when explicitly undefined", async () => {
      const row = makeRow({ payloadJson: {} });
      mockPrisma.aiEvent.create.mockResolvedValue(row);

      await repo.create({
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "orchestrator",
        payloadJson: undefined,
      });

      expect(mockPrisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps all rows", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      mockPrisma.aiEvent.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(mockPrisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      mockPrisma.aiEvent.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-with-none");

      expect(result).toEqual([]);
    });
  });
});
