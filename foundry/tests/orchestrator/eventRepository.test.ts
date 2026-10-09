import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: { detail: "x" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
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
  describe("create", () => {
    it("creates an event with the given payload and maps the result", async () => {
      const prisma = makePrismaMock();
      const row = makeRow();
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new EventRepository(prisma);

      const result = await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { detail: "x" },
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: { detail: "x" },
        },
      });
      expect(result).toEqual({ ...row, payloadJson: { detail: "x" } });
    });

    it("defaults payloadJson to an empty object when omitted", async () => {
      const prisma = makePrismaMock();
      const row = makeRow({ payloadJson: {} });
      (prisma.aiEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue(row);
      const repo = new EventRepository(prisma);

      await repo.create({
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
      });

      expect(prisma.aiEvent.create).toHaveBeenCalledWith({
        data: {
          runId: "run-1",
          eventType: "PLAN_CREATED",
          source: "system",
          payloadJson: {},
        },
      });
    });
  });

  describe("findByRunId", () => {
    it("returns events ordered oldest-first, each mapped to the domain shape", async () => {
      const prisma = makePrismaMock();
      const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-1");

      expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
        where: { runId: "run-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toEqual(rows.map((r) => ({ ...r, payloadJson: r.payloadJson })));
    });

    it("returns an empty array when the run has no events", async () => {
      const prisma = makePrismaMock();
      (prisma.aiEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const repo = new EventRepository(prisma);

      const result = await repo.findByRunId("run-404");

      expect(result).toEqual([]);
    });
  });
});
