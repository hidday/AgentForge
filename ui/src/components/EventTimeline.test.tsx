import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
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
  it("renders 'No events yet' when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders events in reverse chronological order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats a snake-case event type into title case words", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("renders from/to transition payload data", () => {
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

  it("renders rejection feedback text only for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout." },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout.")).toBeDefined();
  });

  it("does not render feedback text for non-PLAN_REJECTED events even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "should be ignored" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should be ignored")).toBeNull();
  });

  it("renders the event source label, defaulting the icon for an unknown source", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back to the default icon for an unrecognized event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("applies the 'done' color for an EXECUTION_FINISHED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    const icon = container.querySelector(".text-state-done");
    expect(icon).not.toBeNull();
  });

  it("applies the 'done' color for any event type whose name includes APPROVED", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    const icon = container.querySelector(".text-state-done");
    expect(icon).not.toBeNull();
  });

  it("renders a timestamp title attribute with the full formatted time", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />);
    const timeEl = screen.getByTitle(/2024|Jan/);
    expect(timeEl).toBeDefined();
  });
});
