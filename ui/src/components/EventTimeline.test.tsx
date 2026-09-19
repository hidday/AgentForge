import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" })]} />);
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("uses a fallback icon color for an unrecognized event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_OTHER_EVENT" })]} />);
    expect(screen.getByText("Some Other Event")).toBeDefined();
  });

  it("shows the from/to state transition when present in the payload", () => {
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

  it("does not show a transition row when only one of from/to is present", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: { from: "Todo" } })]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows the rejection feedback for a PLAN_REJECTED event", () => {
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

  it("does not show feedback text for PLAN_REJECTED when payload has no feedback", () => {
    render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]} />,
    );
    expect(screen.queryByText(/Needs more detail/)).toBeNull();
  });

  it("shows a human source icon/label for a human-sourced event", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("shows the raw source label for a user-command event", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("applies the done-colored icon for an approved/finished event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    expect(container.querySelector(".text-state-done")).not.toBeNull();
  });

  it("applies the blocked-colored icon for a rejected/changes-requested/blocked event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    expect(container.querySelector(".text-state-blocked")).not.toBeNull();
  });

  it("handles a null payloadJson without throwing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });
});
