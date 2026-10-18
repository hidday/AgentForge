import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  overrides: Partial<RunEventRecord> & { eventType: string },
): RunEventRecord {
  return {
    id: overrides.id ?? "evt-1",
    runId: "run-1",
    source: overrides.source ?? "ai-agent",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and formatted event type when events exist", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "RUN_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("renders events in reverse (most recent first)", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
          makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
        ]}
      />,
    );
    const items = screen.getAllByText(/Requested|Created/);
    // PLAN_CREATED was passed second but should render first (reversed order)
    expect(items[0].textContent).toBe("Plan Created");
    expect(items[1].textContent).toBe("Run Requested");
  });

  it("renders from/to transition payload when present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "RESET_TO_TODO",
            payloadJson: { from: "AIBlocked", to: "Todo" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("AIBlocked")).toBeDefined();
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("does not render a from/to row when payload lacks from/to", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "BLOCKED", payloadJson: { note: "x" } })]}
      />,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("renders rejection feedback text only for PLAN_REJECTED events with feedback", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
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
            id: "e1",
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "should not show" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the event source text", () => {
    render(
      <EventTimeline
        events={[makeEvent({ id: "e1", eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a relative time with a full-timestamp title attribute", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            id: "e1",
            eventType: "EXECUTION_STARTED",
            createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          }),
        ]}
      />,
    );
    const relative = screen.getByText(/\d+m ago/);
    expect(relative).toBeDefined();
    expect(relative.getAttribute("title")).toBeTruthy();
  });

  it("renders multiple events together, one block per event", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
          makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
          makeEvent({ id: "e3", eventType: "PLAN_APPROVED" }),
        ]}
      />,
    );
    expect(container.querySelectorAll(".group").length).toBe(3);
  });
});
