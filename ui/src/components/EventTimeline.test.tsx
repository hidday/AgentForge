import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: overrides.id ?? "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders 'No events yet' when the events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and formats event type labels from SCREAMING_SNAKE_CASE", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("renders events in reverse chronological order (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("shows the source label and relative/absolute timestamps", () => {
    render(
      <EventTimeline
        events={[makeEvent({ source: "human", createdAt: "2024-01-01T00:00:00Z" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
    // 5 minutes elapsed per fake system time
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("renders from/to transition payload with an arrow when both fields are present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "in_progress", to: "todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("in_progress")).toBeDefined();
    expect(screen.getByText("todo")).toBeDefined();
  });

  it("does not render a transition row when payload lacks from/to", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: { foo: "bar" } })]} />);
    expect(screen.queryByText("foo")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Not detailed enough" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Not detailed enough")).toBeDefined();
  });

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVISED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("handles a null payload without throwing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("falls back to a default icon color for event types with an unmapped status", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    // Falls back to the accent color class rather than done/blocked
    expect(container.querySelector(".text-accent")).not.toBeNull();
  });

  it("uses the done color for approved/finished event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "HUMAN_APPROVED" })]} />,
    );
    expect(container.querySelector(".text-state-done")).not.toBeNull();
  });

  it("uses the blocked color for rejected/blocked event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    expect(container.querySelector(".text-state-blocked")).not.toBeNull();
  });

  it("renders every mapped event type with its distinct label", () => {
    const types = [
      "RUN_REQUESTED",
      "PLAN_CREATED",
      "PLAN_REVIEW_APPROVED",
      "EXECUTION_STARTED",
      "EXECUTION_FINISHED",
      "REVIEW_APPROVED",
      "REVIEW_CHANGES_REQUESTED",
      "REMEDIATION_FINISHED",
      "NEEDS_HUMAN_CLARIFICATION",
    ];
    const events = types.map((t, i) => makeEvent({ id: `e${i}`, eventType: t }));
    render(<EventTimeline events={events} />);
    for (const t of types) {
      const label = t
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("shows the source-specific icon for a user-command source without crashing", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the Bot source icon for an unrecognized source", () => {
    render(<EventTimeline events={[makeEvent({ source: "agent-orchestrator" })]} />);
    expect(screen.getByText("agent-orchestrator")).toBeDefined();
  });
});
