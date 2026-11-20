import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("formats the event type into a human-readable title", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("renders events most-recent-first (reversed from input order)", () => {
    const events = [
      makeEvent({ id: "a", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "b", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const titles = screen.getAllByText(/Run Requested|Plan Created/);
    expect(titles[0].textContent).toBe("Plan Created");
    expect(titles[1].textContent).toBe("Run Requested");
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

  it("renders feedback text only for PLAN_REJECTED events with feedback", () => {
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

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
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

  it("shows the event source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-planner" })]} />);
    expect(screen.getByText("ai-planner")).toBeDefined();
  });

  it("handles a null payload without crashing", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("falls back to the default icon for an unrecognized event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("colors the icon as done for an APPROVED-style event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-state-done");
  });
});
