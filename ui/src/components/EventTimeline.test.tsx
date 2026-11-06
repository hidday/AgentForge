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
  it("renders an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("formats SCREAMING_SNAKE_CASE event types into Title Case", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders a from/to transition when present in the payload", () => {
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

  it("renders rejection feedback text only for PLAN_REJECTED events", () => {
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

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REVIEW_CHANGES_REQUESTED",
            payloadJson: { feedback: "Should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    render(<EventTimeline events={[makeEvent({ source: "ai-planner" })]} />);
    expect(screen.getByText("ai-planner")).toBeDefined();
  });

  it("falls back to the default Zap icon styling for an unrecognized event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    // Default (non-approved, non-rejected) coloring is applied to the icon
    const icon = container.querySelector("svg.text-accent");
    expect(icon).not.toBeNull();
  });

  it("applies done styling to an APPROVED event's icon", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("applies blocked styling to a BLOCKED event's icon", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />);
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("shows a formatted absolute timestamp as the title attribute", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ createdAt: "2024-03-15T10:30:00Z" })]} />,
    );
    const timeEl = container.querySelector("span[title]");
    expect(timeEl).not.toBeNull();
    expect(timeEl?.getAttribute("title")).toContain("Mar");
  });
});
