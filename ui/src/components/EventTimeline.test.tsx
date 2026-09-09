import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse chronological order with a formatted title", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const titles = screen.getAllByText(/^(Run Requested|Plan Created)$/);
    expect(titles.map((t) => t.textContent)).toEqual(["Plan Created", "Run Requested"]);
  });

  it("shows a from/to transition when present in the payload", () => {
    const events = [
      makeEvent({
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "AIBlocked", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("shows rejection feedback text only for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not show feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_APPROVED",
        payloadJson: { feedback: "should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    const events = [makeEvent({ source: "user-command" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders a relative time with the full timestamp in the title attribute", () => {
    const events = [makeEvent({ createdAt: "2020-01-01T00:00:00Z" })];
    render(<EventTimeline events={events} />);
    const timeEl = screen.getByText(/ago$/);
    expect(timeEl.getAttribute("title")).toMatch(/\w{3} \d{1,2}/);
  });

  it("handles an unrecognized event type by falling back to default icon and title casing", () => {
    const events = [makeEvent({ eventType: "SOME_NEW_EVENT_TYPE", source: "some-bot" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some New Event Type")).toBeDefined();
  });

  it("handles a null payload without crashing", () => {
    const events = [makeEvent({ payloadJson: null })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
  });
});
