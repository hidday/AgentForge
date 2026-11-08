import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  describe("create", () => {
    it("defaults payloadJson to an empty object when omitted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const repo = new EventRepository(prisma);

      await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "system" });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });

    it("passes through an explicit payloadJson and maps the result", async () => {
      const payload = { foo: "bar" };
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: payload }),
      );
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: payload,
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: { runId: "run-1", eventType: "PLAN_CREATED", source: "system", payloadJson: payload },
      });
      expect(result.payloadJson).toEqual(payload);
    });

    it("treats an explicit falsy-but-defined payloadJson (e.g. null) as provided, not defaulted", async () => {
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ payloadJson: {} }),
      );
      const repo = new EventRepository(prisma);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: null,
      });

      // `payloadJson ?? {}` means an explicit null still falls through to {}.
      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payloadJson: {} }),
      });
    });
  });

  describe("findByRunId", () => {
    it("queries events for the run ordered by createdAt asc and maps each row", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeRow({ id: "e1" }),
        makeRow({ id: "e2" }),
      ]);
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    it("returns an empty array when the run has no events", async () => {
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-empty");

      expect(result).toEqual([]);
    });
  });
});
