import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  eventType: string,
  source: string,
  id: string,
  createdAt: string,
  payloadJson: unknown = null,
): RunEventRecord {
  return { id, runId: "run-1", eventType, source, payloadJson, createdAt };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' empty state when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/i)).toBeDefined();
  });

  it("renders events in reverse order (latest first)", () => {
    const events: RunEventRecord[] = [
      makeEvent("RUN_REQUESTED", "human", "e1", "2024-01-01T00:00:01Z"),
      makeEvent("PLAN_CREATED", "agent", "e2", "2024-01-01T00:00:02Z"),
    ];
    render(<EventTimeline events={events} />);

    const headings = screen.getAllByText(/Run Requested|Plan Created/i);
    expect(headings[0].textContent).toBe("Plan Created");
    expect(headings[1].textContent).toBe("Run Requested");
  });

  it("formats event type by replacing underscores and title-casing", () => {
    render(
      <EventTimeline
        events={[makeEvent("EXECUTION_FINISHED", "agent", "e1", "2024-01-01T00:00:01Z")]}
      />,
    );
    expect(screen.getByText("Execution Finished")).toBeDefined();
  });

  it("renders from/to transition when payload has from and to", () => {
    render(
      <EventTimeline
        events={[
          makeEvent("RESET_TO_TODO", "human", "e1", "2024-01-01T00:00:01Z", {
            from: "in_progress",
            to: "todo",
          }),
        ]}
      />,
    );
    expect(screen.getByText("in_progress")).toBeDefined();
    expect(screen.getByText("todo")).toBeDefined();
  });

  it("does not render a from/to row when payload lacks from/to", () => {
    render(
      <EventTimeline
        events={[makeEvent("RUN_REQUESTED", "human", "e1", "2024-01-01T00:00:01Z", {})]}
      />,
    );
    expect(screen.queryByText("todo")).toBeNull();
  });

  it("renders rejection feedback text for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[
          makeEvent("PLAN_REJECTED", "human", "e1", "2024-01-01T00:00:01Z", {
            feedback: "Needs more detail on rollback plan",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollback plan")).toBeDefined();
  });

  it("does not render feedback paragraph for non-PLAN_REJECTED events even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent("PLAN_APPROVED", "human", "e1", "2024-01-01T00:00:01Z", {
            feedback: "should not show",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source text", () => {
    render(
      <EventTimeline
        events={[makeEvent("HUMAN_APPROVED", "human", "e1", "2024-01-01T00:00:01Z")]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("handles an unknown event type gracefully (falls back to default icon)", () => {
    render(
      <EventTimeline
        events={[makeEvent("SOME_UNKNOWN_EVENT", "system", "e1", "2024-01-01T00:00:01Z")]}
      />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });

  it("handles null payloadJson without throwing", () => {
    render(
      <EventTimeline
        events={[makeEvent("BLOCKED", "system", "e1", "2024-01-01T00:00:01Z", null)]}
      />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
  });
});
