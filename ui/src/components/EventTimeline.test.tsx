import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events most-recent-first (reversed order)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats snake_case event types into title case", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" })]} />);
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("renders the from/to transition when present in the payload", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Failed", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition row when from/to are absent", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]} />,
    );
    expect(container.querySelector(".font-mono.text-xs.text-text-muted")).toBeNull();
  });

  it("shows rejection feedback text only for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs a rollback plan" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs a rollback plan")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RUN_REQUESTED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("uses the 'done' icon styling for APPROVED/EXECUTION_FINISHED/REMEDIATION_FINISHED events", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("renders the event source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the Bot icon for an unmapped event source", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-agent" })]} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("falls back to the Zap icon mapping for an unknown event type without crashing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNMAPPED_EVENT" })]} />);
    expect(screen.getByText("Some Unmapped Event")).toBeDefined();
  });
});
