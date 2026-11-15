import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: { a: 1 },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("EventRepository", () => {
  it("create() defaults payloadJson to {} when omitted", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
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

  it("create() forwards an explicit payloadJson and maps the returned row", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const repo = new EventRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { a: 1 },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { a: 1 },
      },
    });
    expect(result.id).toBe("event-1");
    expect(result.payloadJson).toEqual({ a: 1 });
  });

  it("findByRunId() orders by createdAt asc and maps every row", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result.map((e) => e.id)).toEqual(["event-1", "event-2"]);
  });

  it("findByRunId() returns an empty array when there are no events", async () => {
    const prisma = makePrisma();
    prisma.aiEvent.findMany.mockResolvedValue([]);
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-missing");

    expect(result).toEqual([]);
  });
});
