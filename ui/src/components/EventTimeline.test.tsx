import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders the Events header and a formatted event type when events are present", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED" })]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
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

  it("shows source label for each event", () => {
    render(
      <EventTimeline
        events={[makeEvent({ source: "ai-agent" })]}
      />,
    );
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not render feedback block for PLAN_REJECTED events without feedback", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]}
      />,
    );
    expect(container.querySelector(".italic")).toBeNull();
  });

  it("does not render feedback for other event types even when feedback is present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("falls back gracefully for an unknown event type (no crash, formatted label shown)", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });
});
