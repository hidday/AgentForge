import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_APPROVED",
    source: "api",
    payloadJson: { note: "ok" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("creates an event with the provided payload and returns the mapped record", async () => {
      const row = makeRow();
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: { note: "ok" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_APPROVED",
          source: "api",
          payloadJson: { note: "ok" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: { note: "ok" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const row = makeRow({ payloadJson: {} });
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_APPROVED",
          source: "api",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered oldest-first, mapped to domain records", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
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
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
