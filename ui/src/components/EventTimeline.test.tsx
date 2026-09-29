import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & Pick<RunEventRecord, "id" | "eventType" | "createdAt">,
): RunEventRecord {
  return {
    runId: "run-1",
    source: "system",
    payloadJson: null,
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when the events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders each event's formatted type label", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
      makeEvent({
        id: "e3",
        eventType: "REVIEW_CHANGES_REQUESTED",
        createdAt: "2024-01-01T00:00:03Z",
      }),
    ];
    render(<EventTimeline events={events} />);

    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
    expect(screen.getByText("Review Changes Requested")).toBeDefined();
  });

  it("renders events newest-first (reverse chronological order)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0]?.textContent).toBe("Plan Created");
    expect(headings[1]?.textContent).toBe("Run Requested");
  });

  it("renders the from/to transition when present in the payload", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "RESET_TO_TODO",
        createdAt: "2024-01-01T00:00:01Z",
        payloadJson: { from: "AIBlocked", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text for PLAN_REJECTED events", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        createdAt: "2024-01-01T00:00:01Z",
        payloadJson: { feedback: "Needs more detail on rollout" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("renders the event source", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "HUMAN_APPROVED",
        createdAt: "2024-01-01T00:00:01Z",
        source: "human",
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
  });
});
