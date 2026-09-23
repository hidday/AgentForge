import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events in reverse (most recent first) order", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    const { container } = render(<EventTimeline events={events} />);
    const cards = container.querySelectorAll(".group");
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain("Plan Created");
    expect(cards[1].textContent).toContain("Run Requested");
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" })]} />);
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("renders the from/to transition row when payload has both fields", () => {
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

  it("does not render a transition row when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]} />,
    );
    // font-mono spans are only used for from/to values
    expect(container.querySelectorAll(".font-mono").length).toBe(0);
  });

  it("renders feedback text for PLAN_REJECTED events with feedback in the payload", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not render feedback text for PLAN_REJECTED events without feedback", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: {} })]}
      />,
    );
    expect(screen.queryByText(/needs more/i)).toBeNull();
  });

  it("shows the event source text", () => {
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("renders an icon with the done color for an *_APPROVED / EXECUTION_FINISHED / REMEDIATION_FINISHED event", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "a", eventType: "PLAN_APPROVED" }),
          makeEvent({ id: "b", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "c", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );
    const cards = container.querySelectorAll(".group");
    for (const card of cards) {
      const icon = card.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("text-state-done");
    }
  });

  it("renders an icon with the blocked color for REJECTED / CHANGES_REQUESTED / BLOCKED events", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "a", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "b", eventType: "REVIEW_CHANGES_REQUESTED" }),
          makeEvent({ id: "c", eventType: "BLOCKED" }),
        ]}
      />,
    );
    const cards = container.querySelectorAll(".group");
    for (const card of cards) {
      const icon = card.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("text-state-blocked");
    }
  });

  it("renders an icon with the accent (default) color for other event types", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED" })]} />,
    );
    const icon = container.querySelector(".group svg");
    expect(icon?.getAttribute("class")).toContain("text-accent");
  });

  it("falls back to the default Zap icon for an unmapped event type without crashing", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT_TYPE" })]} />);
    expect(screen.getByText("Some Unknown Event Type")).toBeDefined();
  });

  it("falls back to the Bot source icon for an unmapped source without crashing", () => {
    render(<EventTimeline events={[makeEvent({ source: "system" })]} />);
    expect(screen.getByText("system")).toBeDefined();
  });

  it("shows a relative-time label with the full timestamp in a title attribute", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ createdAt: "2024-01-01T00:00:00Z" })]} />,
    );
    const timeEl = container.querySelector("[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("title")).toBeTruthy();
  });
});
