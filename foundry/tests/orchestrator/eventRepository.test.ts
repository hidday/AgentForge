import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function buildPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const baseRow = {
  id: "event-1",
  runId: "run-1",
  eventType: "PLAN_CREATED",
  source: "planner-agent",
  payloadJson: { note: "hello" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("EventRepository", () => {
  it("create() persists the event with the provided payloadJson", async () => {
    const prisma = buildPrisma();
    prisma.aiEvent.create.mockResolvedValue(baseRow);
    const repo = new EventRepository(prisma as unknown as PrismaClient);

    const result = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "planner-agent",
      payloadJson: { note: "hello" },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
        payloadJson: { note: "hello" },
      },
    });
    expect(result).toEqual(baseRow);
  });

  it("create() defaults payloadJson to an empty object when omitted", async () => {
    const prisma = buildPrisma();
    prisma.aiEvent.create.mockResolvedValue({ ...baseRow, payloadJson: {} });
    const repo = new EventRepository(prisma as unknown as PrismaClient);

    await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "planner-agent",
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
        payloadJson: {},
      },
    });
  });

  it("findByRunId() returns events ordered by createdAt asc", async () => {
    const prisma = buildPrisma();
    const rows = [baseRow, { ...baseRow, id: "event-2" }];
    prisma.aiEvent.findMany.mockResolvedValue(rows);
    const repo = new EventRepository(prisma as unknown as PrismaClient);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["event-1", "event-2"]);
  });

  it("findByRunId() returns an empty array when there are no events", async () => {
    const prisma = buildPrisma();
    prisma.aiEvent.findMany.mockResolvedValue([]);
    const repo = new EventRepository(prisma as unknown as PrismaClient);

    const result = await repo.findByRunId("run-none");

    expect(result).toEqual([]);
  });
});
