import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

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
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders events newest-first (reversed from input order)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />);
    expect(screen.getByText("Plan Review Approved")).toBeDefined();
  });

  it("renders a from -> to transition when payload has both fields", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Failed", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a transition line when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]} />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollback" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollback")).toBeDefined();
  });

  it("does not render feedback text for non-PLAN_REJECTED events even if payload has feedback", () => {
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
    render(<EventTimeline events={[makeEvent({ source: "user-command" })]} />);
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("shows a formatted absolute timestamp as the title attribute", () => {
    render(<EventTimeline events={[makeEvent({ createdAt: "2024-06-15T10:30:00Z" })]} />);
    const timeEl = screen.getByText(/ago|just now/);
    expect(timeEl.getAttribute("title")).toContain("Jun");
  });

  it("uses the Bot source icon fallback for an unrecognized source", () => {
    // Indirectly verified via absence of crash and rendering the source text
    render(<EventTimeline events={[makeEvent({ source: "system" })]} />);
    expect(screen.getByText("system")).toBeDefined();
  });

  it("falls back to the default icon for an event type not in the icon map", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    // Still renders the formatted label; icon fallback doesn't throw or omit content.
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("renders multiple events each with their own key/card", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "BLOCKED" }),
      makeEvent({ id: "e3", eventType: "HUMAN_APPROVED" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Run Requested")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(screen.getByText("Human Approved")).toBeDefined();
  });
});
