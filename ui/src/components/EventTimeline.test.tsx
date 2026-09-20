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
    createdAt: "2026-06-08T16:26:58.000Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);

    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders each event's formatted type", () => {
    const events = [
      makeEvent({ id: "evt-1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "evt-2", eventType: "PLAN_CREATED" }),
    ];

    render(<EventTimeline events={events} />);

    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse-chronological (newest first) order", () => {
    const events = [
      makeEvent({ id: "evt-1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "evt-2", eventType: "PLAN_CREATED" }),
      makeEvent({ id: "evt-3", eventType: "PLAN_APPROVED" }),
    ];

    render(<EventTimeline events={events} />);

    const labels = screen
      .getAllByText(/Run Requested|Plan Created|Plan Approved/)
      .map((el) => el.textContent);

    expect(labels).toEqual(["Plan Approved", "Plan Created", "Run Requested"]);
  });

  it("renders a from/to transition when present in the payload", () => {
    const events = [
      makeEvent({
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Failed", to: "Todo" },
      }),
    ];

    render(<EventTimeline events={events} />);

    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Please tighten the rollout plan." },
      }),
    ];

    render(<EventTimeline events={events} />);

    expect(screen.getByText("Please tighten the rollout plan.")).toBeDefined();
  });

  it("does not render feedback text for non-PLAN_REJECTED events even if present", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_CREATED",
        payloadJson: { feedback: "should not show" },
      }),
    ];

    render(<EventTimeline events={events} />);

    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source", () => {
    const events = [makeEvent({ source: "user-command" })];

    render(<EventTimeline events={events} />);

    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to a title-cased label for an unrecognized event type", () => {
    const events = [makeEvent({ eventType: "SOME_CUSTOM_EVENT" })];

    render(<EventTimeline events={events} />);

    expect(screen.getByText("Some Custom Event")).toBeDefined();
  });
});
