import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { EventTimeline } from "./EventTimeline.tsx";

function makeEvent(
  overrides: Partial<RunEventRecord> & { id: string; eventType: string },
): RunEventRecord {
  return {
    runId: "run-1",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders 'No events yet' when events array is empty", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
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

  it("formats the event type into title case with spaces", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "NEEDS_HUMAN_CLARIFICATION" })]}
      />,
    );
    expect(screen.getByText("Needs Human Clarification")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "Failed", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail on rollout" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail on rollout")).toBeDefined();
  });

  it("does not render feedback paragraph for non-PLAN_REJECTED events even if payload has feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source label", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("falls back gracefully for an unknown event type (no crash, renders formatted label)", () => {
    render(
      <EventTimeline events={[makeEvent({ id: "e1", eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
  });
});
