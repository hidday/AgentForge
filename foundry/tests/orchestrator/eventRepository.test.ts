import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "planner",
    payloadJson: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
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

describe("EventRepository.create", () => {
  it("defaults payloadJson to an empty object when omitted", async () => {
    const create = vi.fn().mockResolvedValue(makeRow());
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    await repo.create({ runId: "run-1", eventType: "PLAN_CREATED", source: "planner" });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "planner",
        payloadJson: {},
      },
    });
  });

  it("passes through a provided payloadJson", async () => {
    const create = vi.fn().mockResolvedValue(makeRow({ payloadJson: { foo: "bar" } }));
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    const event = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "planner",
      payloadJson: { foo: "bar" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payloadJson: { foo: "bar" } }),
    });
    expect(event.payloadJson).toEqual({ foo: "bar" });
  });
});

describe("EventRepository.findByRunId", () => {
  it("returns events ordered by createdAt asc", async () => {
    const findMany = vi.fn().mockResolvedValue([makeRow(), makeRow({ id: "event-2" })]);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    const events = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.id)).toEqual(["event-1", "event-2"]);
  });

  it("returns an empty array when the run has no events", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    expect(await repo.findByRunId("run-empty")).toEqual([]);
  });
});
