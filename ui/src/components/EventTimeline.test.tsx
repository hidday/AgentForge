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
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty-state message when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the events heading and formatted event type when events exist", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events most-recent-first (reversed order)", () => {
    const events = [
      makeEvent({ id: "first", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "second", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders a from->to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_APPROVED",
            payloadJson: { from: "PlanReview", to: "Implementing" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("PlanReview")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("does not render a transition row when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders feedback text for a PLAN_REJECTED event", () => {
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

  it("does not render feedback text for a non PLAN_REJECTED event even if feedback is present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "Should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back to a default icon for an unrecognized event type and source", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT", source: "robot" })]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(screen.getByText("robot")).toBeDefined();
    // An svg icon should still render even for unknown type/source
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
