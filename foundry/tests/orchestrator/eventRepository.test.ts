import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "STATE_TRANSITION",
    source: "system",
    payloadJson: { from: "Todo", to: "Planning" },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("EventRepository", () => {
  let prisma: {
    aiEvent: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  };
  let repo: EventRepository;

  beforeEach(() => {
    prisma = { aiEvent: { create: vi.fn(), findMany: vi.fn() } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new EventRepository(prisma as any);
  });

  it("creates an event, defaulting payloadJson to {} when omitted", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow({ payloadJson: {} }));

    const result = await repo.create({ runId: "run-1", eventType: "FOO", source: "system" });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: { runId: "run-1", eventType: "FOO", source: "system", payloadJson: {} },
    });
    expect(result.id).toBe("evt-1");
  });

  it("creates an event passing through a provided payloadJson", async () => {
    prisma.aiEvent.create.mockResolvedValue(makeRow());

    await repo.create({
      runId: "run-1",
      eventType: "STATE_TRANSITION",
      source: "system",
      payloadJson: { from: "Todo", to: "Planning" },
    });

    expect(prisma.aiEvent.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "STATE_TRANSITION",
        source: "system",
        payloadJson: { from: "Todo", to: "Planning" },
      },
    });
  });

  it("findByRunId orders results ascending by createdAt", async () => {
    prisma.aiEvent.findMany.mockResolvedValue([makeRow(), makeRow({ id: "evt-2" })]);

    const result = await repo.findByRunId("run-1");

    expect(prisma.aiEvent.findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toHaveLength(2);
  });
});
