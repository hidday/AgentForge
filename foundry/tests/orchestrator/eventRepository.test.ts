import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "planner-agent",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("EventRepository.create", () => {
  it("defaults payloadJson to {} when omitted", async () => {
    const prisma = buildPrismaMock();
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const repo = new EventRepository(prisma as never);

    await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "planner-agent" });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner-agent",
        payloadJson: {},
      },
    });
  });

  it("passes through a provided payloadJson", async () => {
    const prisma = buildPrismaMock();
    const payload = { from: "Todo", to: "Planning" };
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: payload }));
    const repo = new EventRepository(prisma as never);

    const event = await repo.create({
      runId: "run-1",
      eventType: "RUN_REQUESTED",
      source: "orchestrator",
      payloadJson: payload,
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
        payloadJson: payload,
      },
    });
    expect(event.payloadJson).toEqual(payload);
  });
});

describe("EventRepository.findByRunId", () => {
  it("queries events for the run ordered by createdAt asc", async () => {
    const prisma = buildPrismaMock();
    prisma.aiEvent.findMany.mockResolvedValue([
      makeRow({ id: "e1" }),
      makeRow({ id: "e2" }),
    ]);
    const repo = new EventRepository(prisma as never);

    const events = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns an empty array when the run has no events", async () => {
    const prisma = buildPrismaMock();
    prisma.aiEvent.findMany.mockResolvedValue([]);
    const repo = new EventRepository(prisma as never);

    expect(await repo.findByRunId("run-1")).toEqual([]);
  });
});
