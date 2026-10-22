import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(partial: Partial<RunEventRecord> & { id: string }): RunEventRecord {
  return {
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events most-recent-first", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00.000Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00.000Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats an unknown snake_case event type into title case", () => {
    const events = [makeEvent({ id: "e1", eventType: "SOME_NEW_EVENT_TYPE" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some New Event Type")).toBeDefined();
  });

  it("renders a from/to transition when present in the payload", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Implementing", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_APPROVED",
        payloadJson: { feedback: "Should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    const events = [makeEvent({ id: "e1", source: "user-command" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });
});
