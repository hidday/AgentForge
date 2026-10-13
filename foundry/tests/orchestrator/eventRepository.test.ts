import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildPrisma() {
  const aiEvent = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const prisma = { aiEvent } as unknown as PrismaClient;
  return { prisma, aiEvent };
}

describe("EventRepository", () => {
  let prisma: PrismaClient;
  let aiEvent: ReturnType<typeof buildPrisma>["aiEvent"];
  let repo: EventRepository;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    aiEvent = built.aiEvent;
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates with the given payloadJson", async () => {
      aiEvent.create.mockResolvedValue(makeRow());

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      });

      expect(aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { foo: "bar" },
        },
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      aiEvent.create.mockResolvedValue(makeRow());

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
      });

      expect(aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to an empty object when explicitly undefined", async () => {
      aiEvent.create.mockResolvedValue(makeRow());

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: undefined,
      });

      expect(aiEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payloadJson: {} }),
      });
    });

    it("maps the created row to a domain RunEventRecord", async () => {
      aiEvent.create.mockResolvedValue(makeRow({ id: "event-new", eventType: "RUN_STARTED" }));

      const result = await repo.create({
        runId: "run-1",
        eventType: "RUN_STARTED",
        source: "system",
      });

      expect(result.id).toBe("event-new");
      expect(result.eventType).toBe("RUN_STARTED");
    });
  });

  describe("findByRunId", () => {
    it("queries by runId ordered by createdAt asc", async () => {
      aiEvent.findMany.mockResolvedValue([]);

      await repo.findByRunId("run-1");

      expect(aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
    });

    it("maps all returned rows to domain RunEventRecords", async () => {
      aiEvent.findMany.mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2", eventType: "PLAN_REVIEW_APPROVED" }),
      ]);

      const result = await repo.findByRunId("run-1");

      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
      expect(result[1]?.eventType).toBe("PLAN_REVIEW_APPROVED");
    });

    it("returns an empty array when the run has no events", async () => {
      aiEvent.findMany.mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
