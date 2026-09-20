import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  id: string,
  eventType: string,
  source: string,
  payloadJson: unknown,
  createdAt = "2024-01-01T00:00:00Z",
): RunEventRecord {
  return { id, runId: "run-1", eventType, source, payloadJson, createdAt };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    const events = [
      makeEvent("e1", "RUN_REQUESTED", "human", null, "2024-01-01T00:00:00Z"),
      makeEvent("e2", "PLAN_CREATED", "ai", null, "2024-01-01T00:01:00Z"),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats the event type by replacing underscores and title-casing", () => {
    render(<EventTimeline events={[makeEvent("e1", "PLAN_REVIEW_APPROVED", "ai", null)]} />);
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
  });

  it("shows from -> to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent("e1", "PLAN_APPROVED", "human", { from: "PlanReview", to: "Implementing" }),
        ]}
      />,
    );
    expect(screen.getByText("PlanReview")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("does not render a transition row when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent("e1", "BLOCKED", "ai", null)]} />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[makeEvent("e1", "PLAN_REJECTED", "human", { feedback: "Needs more detail" })]}
      />,
    );
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[makeEvent("e1", "PLAN_APPROVED", "human", { feedback: "should not show" })]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    render(<EventTimeline events={[makeEvent("e1", "RUN_REQUESTED", "human", null)]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a relative timestamp for each event", () => {
    render(<EventTimeline events={[makeEvent("e1", "RUN_REQUESTED", "human", null)]} />);
    expect(screen.getByText(/ago|just now/i)).toBeDefined();
  });

  it("falls back to a default icon for an unrecognized event type", () => {
    // Just verify it renders without crashing for an unmapped eventType.
    render(<EventTimeline events={[makeEvent("e1", "SOME_UNKNOWN_EVENT", "system", null)]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });
});
