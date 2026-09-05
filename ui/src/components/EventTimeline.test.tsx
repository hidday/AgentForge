import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
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
  it("renders empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders the Events heading when events are present", () => {
    render(<EventTimeline events={[makeEvent()]} />);
    expect(screen.getByText("Events")).toBeDefined();
  });

  it("formats event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse (most recent first) order", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("shows from/to transition payload when present", () => {
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

  it("does not show a from/to row when only one of from/to is present", () => {
    const events = [
      makeEvent({
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Failed" },
      }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    expect(container.querySelector(".font-mono.text-\\[10px\\]")).toBeNull();
  });

  it("shows feedback text for PLAN_REJECTED events with feedback payload", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail on rollback" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail on rollback")).toBeDefined();
  });

  it("does not show feedback text for PLAN_REJECTED events without feedback payload", () => {
    const events = [makeEvent({ eventType: "PLAN_REJECTED", payloadJson: null })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Plan Rejected")).toBeDefined();
  });

  it("does not show feedback text for non-PLAN_REJECTED events even with feedback payload", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_CREATED",
        payloadJson: { feedback: "should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source text", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders relative time with a title attribute containing the formatted timestamp", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />,
    );
    const timeEl = container.querySelector("[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("title")).toContain("Jan");
  });

  it("falls back to Bot icon for unknown source and Zap icon for unknown event type without crashing", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT", source: "system" })]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(screen.getByText("system")).toBeDefined();
  });

  it("applies done styling for APPROVED-type events", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-done");
    expect(icon).not.toBeNull();
  });

  it("applies blocked styling for REJECTED/CHANGES_REQUESTED/BLOCKED events", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    const icon = container.querySelector("svg.text-state-blocked");
    expect(icon).not.toBeNull();
  });

  it("applies accent styling for other event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    const icon = container.querySelector("svg.text-accent");
    expect(icon).not.toBeNull();
  });
});
