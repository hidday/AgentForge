import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
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
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse (most recent first) order", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "evt-1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "evt-2", eventType: "PLAN_CREATED" }),
      makeEvent({ id: "evt-3", eventType: "PLAN_APPROVED" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Requested|Created|Approved/);
    // Most recently appended event (PLAN_APPROVED) should render first.
    expect(headings[0].textContent).toBe("Plan Approved");
    expect(headings[headings.length - 1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case words", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("renders the source label for a human event", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back to the bot icon for an unrecognized source without crashing", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-agent" })]} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
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

  it("renders feedback text for a PLAN_REJECTED event", () => {
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

  it("does not render feedback text for non-PLAN_REJECTED events even if present", () => {
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

  it("renders a relative time with the full timestamp as a title attribute", () => {
    const createdAt = new Date().toISOString();
    render(
      <EventTimeline events={[makeEvent({ createdAt })]} />,
    );
    expect(screen.getByText("just now")).toBeDefined();
  });
});
