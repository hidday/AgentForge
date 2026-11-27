import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildRepo() {
  const prisma = {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const repo = new EventRepository(prisma as never);
  return { repo, prisma };
}

describe("EventRepository.create", () => {
  it("creates an event with the given payload", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiEvent.create.mockResolvedValue(
      makeRow({ payloadJson: { from: "Todo", to: "Planning" } }),
    );

    const event = await repo.create({
      runId: "run-1",
      eventType: "RUN_REQUESTED",
      source: "orchestrator",
      payloadJson: { from: "Todo", to: "Planning" },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
        payloadJson: { from: "Todo", to: "Planning" },
      },
    });
    expect(event.payloadJson).toEqual({ from: "Todo", to: "Planning" });
  });

  it("defaults payloadJson to an empty object when omitted", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiEvent.create.mockResolvedValue(makeRow());

    await repo.create({
      runId: "run-1",
      eventType: "RUN_REQUESTED",
      source: "orchestrator",
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "RUN_REQUESTED",
        source: "orchestrator",
        payloadJson: {},
      },
    });
  });
});

describe("EventRepository.findByRunId", () => {
  it("queries by runId ordered by createdAt asc and maps all rows", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiEvent.findMany.mockResolvedValue([
      makeRow({ id: "e1" }),
      makeRow({ id: "e2", eventType: "PLAN_CREATED" }),
    ]);

    const events = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("returns an empty array when there are no events", async () => {
    const { repo, prisma } = buildRepo();
    prisma.aiEvent.findMany.mockResolvedValue([]);

    expect(await repo.findByRunId("run-1")).toEqual([]);
  });
});
