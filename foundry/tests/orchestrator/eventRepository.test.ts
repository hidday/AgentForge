import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "api",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    aiEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("EventRepository", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repo: EventRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = new EventRepository(prisma);
  });

  it("create() defaults payloadJson to an empty object when omitted", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));
    await repo.create({ runId: "run-1", eventType: "RUN_REQUESTED", source: "api" });
    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payloadJson: {} }),
    });
  });

  it("create() persists a provided payload and maps the row back", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow());
    const event = await repo.create({
      runId: "run-1",
      eventType: "RUN_REQUESTED",
      source: "api",
      payloadJson: { foo: "bar" },
    });
    expect(event.payloadJson).toEqual({ foo: "bar" });
    expect(event.id).toBe("event-1");
  });

  it("findByRunId() orders events chronologically ascending", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([makeRow()]);
    const events = await repo.findByRunId("run-1");
    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(1);
  });

  it("findByRunId() returns an empty array when there are no events", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([]);
    expect(await repo.findByRunId("run-missing")).toEqual([]);
  });
});
