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
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" })]} />);
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("shows from/to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition row when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ payloadJson: {} })]} />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events", () => {
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

  it("does not show feedback paragraph for non PLAN_REJECTED events even if payload has feedback", () => {
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

  it("renders the event source text", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders relative time with a formatted timestamp title attribute", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />);
    const timeEl = screen.getByText(/ago|just now/);
    expect(timeEl.getAttribute("title")).toBeTruthy();
  });

  it("renders an unknown event type gracefully with the default icon path", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("renders an unknown source with the default Bot icon path", () => {
    render(<EventTimeline events={[makeEvent({ source: "agent" })]} />);
    expect(screen.getByText("agent")).toBeDefined();
  });
});
