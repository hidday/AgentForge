import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders the Events heading and formatted event type when events exist", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events most-recent-first (reversed order)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("shows from/to transition payload when present", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_APPROVED",
        payloadJson: { from: "AwaitingPlanApproval", to: "Implementing" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("AwaitingPlanApproval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("does not show a from/to row when payload lacks from/to", () => {
    const events = [makeEvent({ eventType: "PLAN_APPROVED", payloadJson: {} })];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows rejection feedback text for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Please redo step 2" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Please redo step 2")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if payload has feedback", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_APPROVED",
        payloadJson: { feedback: "should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the human source icon/label for a 'human' source event", () => {
    const events = [makeEvent({ source: "human" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders the user-command source", () => {
    const events = [makeEvent({ source: "user-command" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the Bot icon for an unrecognized source", () => {
    const events = [makeEvent({ source: "ai-agent" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("falls back to the Zap icon for an unrecognized event type", () => {
    const events = [makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("applies blocked styling for a BLOCKED/REJECTED/CHANGES_REQUESTED event", () => {
    const events = [makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })];
    const { container } = render(<EventTimeline events={events} />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-blocked");
  });

  it("applies done styling for an APPROVED/FINISHED event", () => {
    const events = [makeEvent({ eventType: "EXECUTION_FINISHED" })];
    const { container } = render(<EventTimeline events={events} />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-done");
  });
});
