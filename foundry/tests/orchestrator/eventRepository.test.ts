import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function buildPrisma() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository.create", () => {
  it("creates an event with the provided payloadJson and returns the mapped domain row", async () => {
    const prisma = buildPrisma();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    prisma.aiEvent.create.mockResolvedValue({
      id: "evt-1",
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
      createdAt,
    });

    const repo = new EventRepository(prisma as never);
    const result = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      },
    });
    expect(result).toEqual({
      id: "evt-1",
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
      createdAt,
    });
  });

  it("defaults payloadJson to an empty object when omitted", async () => {
    const prisma = buildPrisma();
    const createdAt = new Date("2026-01-02T00:00:00Z");
    prisma.aiEvent.create.mockResolvedValue({
      id: "evt-2",
      runId: "run-2",
      eventType: "RUN_CREATED",
      source: "api",
      payloadJson: {},
      createdAt,
    });

    const repo = new EventRepository(prisma as never);
    const result = await repo.create({
      runId: "run-2",
      eventType: "RUN_CREATED",
      source: "api",
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-2",
        eventType: "RUN_CREATED",
        source: "api",
        payloadJson: {},
      },
    });
    expect(result.payloadJson).toEqual({});
  });
});

describe("EventRepository.findByRunId", () => {
  it("queries by runId ordered ascending by createdAt and maps every row", async () => {
    const prisma = buildPrisma();
    const rows = [
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { a: 1 },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "PLAN_APPROVED",
        source: "api",
        payloadJson: null,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ];
    prisma.aiEvent.findMany.mockResolvedValue(rows);

    const repo = new EventRepository(prisma as never);
    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(rows[0]);
    expect(result[1].payloadJson).toBeNull();
  });

  it("returns an empty array when there are no matching events", async () => {
    const prisma = buildPrisma();
    prisma.aiEvent.findMany.mockResolvedValue([]);

    const repo = new EventRepository(prisma as never);
    const result = await repo.findByRunId("run-empty");

    expect(result).toEqual([]);
  });
});
