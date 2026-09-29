import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
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
  });

  it("renders the Events header when events are present", () => {
    render(<EventTimeline events={[makeEvent()]} />);
    expect(screen.getByText("Events")).toBeDefined();
  });

  it("formats event type into title case with spaces", () => {
    render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
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
            payloadJson: { from: "Implementing", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not show a transition when only 'from' is present", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Implementing" },
          }),
        ]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollback." },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollback.")).toBeDefined();
  });

  it("does not show feedback text for non PLAN_REJECTED events even if present", () => {
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

  it("renders the event source", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders an unknown event type using the fallback icon without crashing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_TYPE" })]} />);
    expect(screen.getByText("Some Unknown Type")).toBeDefined();
  });

  it("renders an unknown source using the fallback Bot icon without crashing", () => {
    render(<EventTimeline events={[makeEvent({ source: "agent" })]} />);
    expect(screen.getByText("agent")).toBeDefined();
  });

  it("handles a null payload without crashing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("applies done-colored icon styling for approved/finished event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-done");
  });

  it("applies blocked-colored icon styling for rejected/blocked event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-blocked");
  });

  it("applies accent icon styling for other event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_STARTED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-accent");
  });

  it("shows a timestamp title attribute with the formatted timestamp", () => {
    const createdAt = "2024-01-01T12:00:00.000Z";
    const { container } = render(
      <EventTimeline events={[makeEvent({ createdAt })]} />,
    );
    const timeEl = container.querySelector("[title]");
    expect(timeEl).not.toBeNull();
    // formatTimestamp uses toLocaleString with month/day/hour/minute/second (no year)
    expect(timeEl?.getAttribute("title")).toMatch(/^Jan 1, /);
  });
});
