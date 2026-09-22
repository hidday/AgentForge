import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows 'No events yet' for an empty list", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders each event's formatted (title-cased, space-separated) type", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "PLAN_CREATED" }),
      makeEvent({ id: "e2", eventType: "EXECUTION_STARTED" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
    expect(screen.getByText("Execution Started")).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recently added first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
      makeEvent({ id: "e3", eventType: "PLAN_APPROVED" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/^(Run Requested|Plan Created|Plan Approved)$/);
    expect(labels.map((l) => l.textContent)).toEqual([
      "Plan Approved",
      "Plan Created",
      "Run Requested",
    ]);
  });

  it("shows the from/to transition when the payload has both fields", () => {
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

  it("does not render a transition row when the payload lacks from/to", () => {
    const events = [makeEvent({ eventType: "PLAN_CREATED", payloadJson: null })];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("shows rejection feedback text only for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Please simplify the rollout plan" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Please simplify the rollout plan")).toBeDefined();
  });

  it("does not show feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_CREATED",
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

  it("falls back to the default icon set for an unrecognized event type and source", () => {
    const events = [
      makeEvent({ eventType: "SOME_FUTURE_EVENT", source: "webhook" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Future Event")).toBeDefined();
    expect(screen.getByText("webhook")).toBeDefined();
  });

  it("renders a relative timestamp with the full timestamp as a title attribute", () => {
    const events = [makeEvent({ createdAt: "2024-01-01T00:00:00Z" })];
    const { container } = render(<EventTimeline events={events} />);
    const timeEl = container.querySelector("span[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.textContent).toMatch(/ago|just now/);
    expect(timeEl?.getAttribute("title")).toMatch(/Jan/);
  });
});
