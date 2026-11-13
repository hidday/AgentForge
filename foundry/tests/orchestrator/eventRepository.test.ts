import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_SUBMITTED",
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
  } as unknown as PrismaClient & {
    aiEvent: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("passes the given payloadJson through and returns the mapped RunEventRecord", async () => {
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_SUBMITTED",
          source: "orchestrator",
          payloadJson: { foo: "bar" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_SUBMITTED",
        source: "orchestrator",
        payloadJson: { foo: "bar" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to {} when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to {} when explicitly undefined", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({
        runId: "run-1",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: undefined,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_CREATED",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc and maps every row", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([
        makeRow({ id: "a", eventType: "RUN_CREATED" }),
        makeRow({ id: "b", eventType: "PLAN_SUBMITTED" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["a", "b"]);
      expect(result.map((e) => e.eventType)).toEqual(["RUN_CREATED", "PLAN_SUBMITTED"]);
    });

    it("returns an empty array when the run has no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
