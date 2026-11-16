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
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders the Events heading when events are present", () => {
    render(<EventTimeline events={[makeEvent({})]} />);
    expect(screen.getByText("Events")).toBeDefined();
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "PLAN_CREATED" })]}
      />,
    );
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created|Plan Approved/);
    expect(headings.map((h) => h.textContent)).toEqual([
      "Plan Approved",
      "Plan Created",
      "Run Requested",
    ]);
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not render feedback paragraph for non-PLAN_REJECTED events even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", source: "user-command" })]}
      />,
    );
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders a timestamp element carrying the absolute time as a title attribute", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", createdAt: "2024-01-01T00:00:00Z" })]}
      />,
    );
    const elWithTitle = document.querySelector("[title]");
    expect(elWithTitle).not.toBeNull();
    expect(elWithTitle?.getAttribute("title")).toMatch(/Jan/);
    // relativeTime renders text ending in "ago" for a date well in the past
    expect(elWithTitle?.textContent).toMatch(/ago$/);
  });

  it("falls back to the Bot source icon for an unrecognized event source", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", source: "agent" })]}
      />,
    );
    expect(screen.getByText("agent")).toBeDefined();
  });

  it("falls back to a default icon color scheme for an unrecognized event type", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "SOME_UNKNOWN_EVENT" })]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });
});
