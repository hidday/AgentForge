import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

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
  it("renders empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events in reverse order (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:01Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-01T00:00:02Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("formats an unknown event type by titlecasing underscores", () => {
    const events = [makeEvent({ id: "e1", eventType: "SOME_CUSTOM_EVENT" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Some Custom Event")).toBeDefined();
  });

  it("renders from/to transition payload when present", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "RESET_TO_TODO",
        payloadJson: { from: "Failed", to: "Todo" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("renders feedback text for PLAN_REJECTED events", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_REJECTED",
        payloadJson: { feedback: "Needs more detail on rollback" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Needs more detail on rollback")).toBeDefined();
  });

  it("does not render feedback block for non PLAN_REJECTED events even if feedback is present", () => {
    const events = [
      makeEvent({
        id: "e1",
        eventType: "PLAN_APPROVED",
        payloadJson: { feedback: "should not show" },
      }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source", () => {
    const events = [makeEvent({ id: "e1", eventType: "HUMAN_APPROVED", source: "human" })];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders multiple events without payload transitions gracefully", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "EXECUTION_STARTED" }),
      makeEvent({ id: "e2", eventType: "EXECUTION_FINISHED" }),
      makeEvent({ id: "e3", eventType: "BLOCKED" }),
    ];
    render(<EventTimeline events={events} />);
    expect(screen.getByText("Execution Started")).toBeDefined();
    expect(screen.getByText("Execution Finished")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
  });
});
