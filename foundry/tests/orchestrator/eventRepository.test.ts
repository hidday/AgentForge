import { describe, it, expect, vi } from "vitest";
import { EventRepository } from "../../src/orchestrator/eventRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: { foo: "bar" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
  it("persists the event with the given payload and maps the result", async () => {
    const row = makeRow();
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    const result = await repo.create({
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { foo: "bar" },
      },
    });
    expect(result).toEqual({
      id: "event-1",
      runId: "run-1",
      eventType: "PLAN_CREATED",
      source: "system",
      payloadJson: { foo: "bar" },
      createdAt: row.createdAt,
    });
  });

  it("defaults payloadJson to an empty object when omitted", async () => {
    const row = makeRow({ payloadJson: {} });
    const create = vi.fn().mockResolvedValue(row);
    const prisma = makePrisma({ create });
    const repo = new EventRepository(prisma);

    await repo.create({ runId: "run-1", eventType: "STATE_CHANGED", source: "system" });

    expect(create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        eventType: "STATE_CHANGED",
        source: "system",
        payloadJson: {},
      },
    });
  });
});

describe("EventRepository.findByRunId", () => {
  it("returns events for a run ordered oldest first, mapped to domain shape", async () => {
    const rows = [makeRow({ id: "e1" }), makeRow({ id: "e2" })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("returns an empty array when the run has no events", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ findMany });
    const repo = new EventRepository(prisma);

    const result = await repo.findByRunId("run-none");

    expect(result).toEqual([]);
  });
});
