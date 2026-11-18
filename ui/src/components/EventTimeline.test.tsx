import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: overrides.id ?? "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when the events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats an unknown event type with title case and spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_CUSTOM_EVENT" })]} />);
    expect(screen.getByText("Some Custom Event")).toBeDefined();
  });

  it("shows from->to transition when payload has from/to", () => {
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

  it("does not show a transition row when payload has no to/from", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: {} })]} />);
    expect(screen.queryByText("Implementing")).toBeNull();
  });

  it("shows rejection feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "Should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the event source text", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a relative timestamp with a full-timestamp title attribute", () => {
    render(<EventTimeline events={[makeEvent()]} />);
    const timeEl = screen.getByText(/ago|just now/i);
    expect(timeEl.getAttribute("title")).toBeTruthy();
  });
});
