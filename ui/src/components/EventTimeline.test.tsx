import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when the events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and formats the event type into title case", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("renders source and relative time for each event", () => {
    const recentTimestamp = new Date(Date.now() - 5000).toISOString();
    render(
      <EventTimeline
        events={[makeEvent({ source: "ai", createdAt: recentTimestamp })]}
      />,
    );
    expect(screen.getByText("ai")).toBeDefined();
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("renders from/to transition payload when both are present", () => {
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

  it("does not render a transition when only 'from' or only 'to' is present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Failed" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollback" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollback")).toBeDefined();
  });

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "Should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("handles a null payloadJson without crashing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("falls back to the Bot source icon for an unrecognized source", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "ai-agent" })]} />,
    );
    expect(screen.getByText("ai-agent")).toBeDefined();
    // Smoke-check an svg icon rendered (Bot fallback) without erroring.
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("falls back to the Zap icon for an unrecognized event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOMETHING_NEW" })]} />);
    expect(screen.getByText("Something New")).toBeDefined();
  });

  it("applies the done styling for an APPROVED-type event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).toBeTruthy();
  });

  it("applies the blocked styling for a BLOCKED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-blocked");
    expect(icon).toBeTruthy();
  });

  it("applies the default accent styling for a neutral event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_STARTED" })]} />,
    );
    const icon = container.querySelector("svg.text-accent");
    expect(icon).toBeTruthy();
  });
});
