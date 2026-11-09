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
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the formatted event type for each event", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "PLAN_CREATED" })]}
      />,
    );
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

  it("shows the from/to transition when payload has from and to", () => {
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

  it("does not show a transition when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "BLOCKED", payloadJson: null })]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
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

  it("does not show feedback text for other event types even if present", () => {
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

  it("renders the source label for each event", () => {
    render(
      <EventTimeline
        events={[makeEvent({ source: "user-command" })]}
      />,
    );
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the default icon for an unknown event type", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    // Should still render without throwing and include an icon svg.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the Bot icon for an unknown source", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "agent" })]} />,
    );
    expect(screen.getByText("agent")).toBeDefined();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});
