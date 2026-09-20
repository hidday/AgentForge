import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_APPROVED",
    source: "api",
    payloadJson: { note: "looks good" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makePrisma() {
  const aiEvent = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  return { aiEvent } as unknown as PrismaClient & { aiEvent: typeof aiEvent };
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrisma();
    repo = new EventRepository(prisma);
  });

  describe("create", () => {
    it("persists the event with the given payload and maps the row", async () => {
      const row = makeRow();
      prisma.aiEvent.create.mockResolvedValue(row);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: { note: "looks good" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_APPROVED",
          source: "api",
          payloadJson: { note: "looks good" },
        },
      });
      expect(result).toEqual({
        id: "event-1",
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: { note: "looks good" },
        createdAt: row.createdAt,
      });
    });

    it("defaults payloadJson to {} when omitted", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({
        runId: "run-1",
        eventType: "RUN_STARTED",
        source: "orchestrator",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "RUN_STARTED",
          source: "orchestrator",
          payloadJson: {},
        },
      });
    });

    it("defaults payloadJson to {} when explicitly undefined", async () => {
      prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

      await repo.create({
        runId: "run-1",
        eventType: "RUN_STARTED",
        source: "orchestrator",
        payloadJson: undefined,
      });

      const call = prisma.aiEvent.create.mock.calls[0][0] as { data: { payloadJson: unknown } };
      expect(call.data.payloadJson).toEqual({});
    });
  });

  describe("findByRunId", () => {
    it("returns events for the run in ascending createdAt order", async () => {
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      prisma.aiEvent.findMany.mockResolvedValue(rows);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      prisma.aiEvent.findMany.mockResolvedValue([]);
      const result = await repo.findByRunId("run-none");
      expect(result).toEqual([]);
    });
  });
});
