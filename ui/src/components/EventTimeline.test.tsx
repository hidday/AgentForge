import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "r1",
    eventType: "RUN_REQUESTED",
    source: "orchestrator",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse chronological order", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />);
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
  });

  it("renders the from/to transition when the payload has both", () => {
    const events = [
      makeEvent({
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Implementing", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text for a PLAN_REJECTED event", () => {
    const events = [
      makeEvent({ eventType: "PLAN_REJECTED", payloadJson: { feedback: "needs more tests" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("needs more tests")).toBeDefined();
  });

  it("does not render feedback text for a non-PLAN_REJECTED event even if present", () => {
    const events = [
      makeEvent({ eventType: "PLAN_APPROVED", payloadJson: { feedback: "ignored" } }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("shows the event source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("handles an event with an unrecognized event type without throwing", () => {
    expect(() =>
      render(<EventTimeline events={[makeEvent({ eventType: "SOMETHING_UNKNOWN" })]} />),
    ).not.toThrow();
    expect(screen.getByText("Something Unknown")).toBeDefined();
  });

  it("handles a null payloadJson without throwing", () => {
    expect(() =>
      render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />),
    ).not.toThrow();
  });
});
