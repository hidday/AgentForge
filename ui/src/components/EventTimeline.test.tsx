import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "r1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events newest first", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
          makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
        ]}
      />,
    );
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0]!.textContent).toBe("Plan Created");
    expect(labels[1]!.textContent).toBe("Run Requested");
  });

  it("shows a from/to state transition when present in the payload", () => {
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

  it("shows rejection feedback for a PLAN_REJECTED event", () => {
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

  it("does not show feedback text for non-rejection events even if present", () => {
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

  it("renders a human source icon for human-originated events", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders the source name for unrecognized sources using the default bot icon", () => {
    render(<EventTimeline events={[makeEvent({ source: "orchestrator" })]} />);
    expect(screen.getByText("orchestrator")).toBeDefined();
  });

  it("shows the formatted timestamp as a title attribute on the relative time", () => {
    render(<EventTimeline events={[makeEvent()]} />);
    const timeEl = screen.getByText(/ago|just now/);
    expect(timeEl.getAttribute("title")).toMatch(/Jan/);
  });

  it("renders an unrecognized event type with the default icon and formatting", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_NEW_EVENT" })]} />);
    expect(screen.getByText("Some New Event")).toBeDefined();
  });
});
