import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events newest-first (reversed from input order)", () => {
    const events = [
      makeEvent({ id: "first", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "second", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats the event type from SCREAMING_SNAKE_CASE to Title Case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />);
    expect(screen.getByText("Execution Finished")).toBeDefined();
  });

  it("renders a from->to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_APPROVED",
            payloadJson: { from: "AwaitingPlanApproval", to: "Implementing" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AwaitingPlanApproval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("does not render a transition row when payload is missing from/to", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: {} })]} />);
    expect(screen.queryByText("AwaitingPlanApproval")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Please simplify the rollback step" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Please simplify the rollback step")).toBeDefined();
  });

  it("does not render feedback text for a non-rejection event even if payload has a feedback field", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source label for each event", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders a relative timestamp for the event", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: new Date().toISOString() })]} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("handles an event type with no explicit icon mapping without crashing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNMAPPED_EVENT" })]} />);
    expect(screen.getByText("Some Unmapped Event")).toBeDefined();
  });

  it("handles a source with no explicit icon mapping without crashing", () => {
    render(<EventTimeline events={[makeEvent({ source: "robot" })]} />);
    expect(screen.getByText("robot")).toBeDefined();
  });

  it("handles a null payloadJson without crashing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });
});
