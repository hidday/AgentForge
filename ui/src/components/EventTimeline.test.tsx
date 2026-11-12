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
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events in reverse (most recent first) order", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
      makeEvent({ id: "e3", eventType: "EXECUTION_STARTED", createdAt: "2024-01-03T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created|Execution Started/);
    const texts = headings.map((el) => el.textContent);
    expect(texts).toEqual(["Execution Started", "Plan Created", "Run Requested"]);
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]} />);
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("renders the human source icon label for a human-sourced event", () => {
    render(<EventTimeline events={[makeEvent({ source: "human" })]} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders an unrecognized source label using the default bot icon path", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-agent" })]} />);
    expect(screen.getByText("ai-agent")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition row when payload has no from/to", () => {
    render(<EventTimeline events={[makeEvent({ payloadJson: null })]} />);
    expect(screen.queryByText("AIBlocked")).toBeNull();
  });

  it("renders feedback text for a PLAN_REJECTED event", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout." },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout.")).toBeDefined();
  });

  it("does not render feedback for a PLAN_REJECTED event with no feedback", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]} />,
    );
    expect(container.querySelector("p.italic")).toBeNull();
  });

  it("renders a relative-time label with the full timestamp as a tooltip", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: new Date().toISOString() })]} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("applies the done color for an APPROVED-style event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "HUMAN_APPROVED" })]} />,
    );
    expect(container.querySelector(".text-state-done")).not.toBeNull();
  });

  it("applies the blocked color for a BLOCKED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    expect(container.querySelector(".text-state-blocked")).not.toBeNull();
  });

  it("applies the neutral accent color for an event type matching neither", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    expect(container.querySelector(".text-accent")).not.toBeNull();
  });

  it("falls back to the default Zap icon for unknown event types without throwing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });
});
