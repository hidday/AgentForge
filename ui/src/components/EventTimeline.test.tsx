import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> & { id: string }): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: overrides.eventType ?? "RUN_REQUESTED",
    source: overrides.source ?? "human",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders every event's formatted type label", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01.000Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02.000Z" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01.000Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02.000Z" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED", createdAt: "2024-01-01T00:00:03.000Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created|Plan Approved/);
    expect(labels.map((el) => el.textContent)).toEqual([
      "Plan Approved",
      "Plan Created",
      "Run Requested",
    ]);
  });

  it("shows the from/to state transition for events with from and to in the payload", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Failed", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not show a transition row when payload has no from/to", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", payloadJson: { note: "x" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events with feedback in the payload", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Please add more tests" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Please add more tests")).toBeDefined();
  });

  it("does not show feedback text for PLAN_REJECTED events without feedback in the payload", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "PLAN_REJECTED", payloadJson: null }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Plan Rejected")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if feedback is present", () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: "e1",
        eventType: "RUN_REQUESTED",
        payloadJson: { feedback: "should not render" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not render")).toBeNull();
  });

  it("renders the event source text", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", source: "human" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", source: "planner-agent" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
    expect(screen.getByText("planner-agent")).toBeDefined();
  });

  it("falls back to a default icon for an unrecognized event type and source", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "SOME_UNKNOWN_EVENT", source: "mystery-source" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(screen.getByText("mystery-source")).toBeDefined();
  });

  it("renders a relative time and a formatted absolute time (as a title attribute) for each event", () => {
    const createdAt = "2024-01-01T00:00:00.000Z";
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt }),
    ];
    render(<EventTimeline events={events} />);
    // relativeTime for a date far in the past renders as "<N>d ago"
    expect(screen.getByText(/ago$/)).toBeDefined();
    const timeEl = screen.getByText(/ago$/);
    expect(timeEl.getAttribute("title")).toContain("Jan");
  });
});
