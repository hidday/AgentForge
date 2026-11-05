import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & { eventType: string },
): RunEventRecord {
  return {
    id: overrides.id ?? `evt-${overrides.eventType}`,
    runId: "run-1",
    source: "ai-agent",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders a formatted (title-cased, space-separated) event type", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders events in reverse-chronological order (most recent array entry last, shown first)", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:01:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const headings = screen.getAllByText(/Run Requested|Plan Created/);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("renders the source label and a relative time", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "EXECUTION_STARTED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a from/to transition when the payload has both fields", () => {
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

  it("does not render a from/to row when the payload lacks those fields", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED", payloadJson: { note: "hi" } })]}
      />,
    );
    expect(screen.queryByText("hi")).toBeNull();
  });

  it("renders PLAN_REJECTED feedback text when present", () => {
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

  it("does not render feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_CREATED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders without crashing for an event type with no explicit icon mapping", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />);
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("renders without crashing for a source with no explicit icon mapping", () => {
    render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED", source: "system" })]} />,
    );
    expect(screen.getByText("system")).toBeDefined();
  });

  it("handles a null payloadJson without throwing", () => {
    render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED", payloadJson: null })]} />,
    );
    expect(screen.getByText("Plan Created")).toBeDefined();
  });

  it("renders the Events heading when there is at least one event", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_CREATED" })]} />);
    expect(screen.getByText("Events")).toBeDefined();
  });

  function iconClass(container: HTMLElement) {
    return container.querySelector("svg")?.getAttribute("class") ?? "";
  }

  it("colors the icon as 'done' for an *_APPROVED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]} />,
    );
    expect(iconClass(container)).toContain("text-state-done");
  });

  it("colors the icon as 'done' for EXECUTION_FINISHED", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    expect(iconClass(container)).toContain("text-state-done");
  });

  it("colors the icon as 'done' for REMEDIATION_FINISHED", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "REMEDIATION_FINISHED" })]} />,
    );
    expect(iconClass(container)).toContain("text-state-done");
  });

  it("colors the icon as 'blocked' for a *_REJECTED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />,
    );
    expect(iconClass(container)).toContain("text-state-blocked");
  });

  it("colors the icon as 'blocked' for a *_CHANGES_REQUESTED event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "REVIEW_CHANGES_REQUESTED" })]} />,
    );
    expect(iconClass(container)).toContain("text-state-blocked");
  });

  it("colors the icon as 'blocked' for BLOCKED", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />);
    expect(iconClass(container)).toContain("text-state-blocked");
  });

  it("falls back to the accent color for an event type matching none of the done/blocked patterns", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_STARTED" })]} />,
    );
    expect(iconClass(container)).toContain("text-accent");
  });
});
