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
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the humanized event type and source for a known event", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ eventType: "PLAN_CREATED", source: "human" }),
        ]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Plan Created")).toBeDefined();
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders events most-recent-first", () => {
    const events = [
      makeEvent({
        id: "old",
        eventType: "RUN_REQUESTED",
        createdAt: "2024-01-01T00:00:00Z",
      }),
      makeEvent({
        id: "new",
        eventType: "PLAN_CREATED",
        createdAt: "2024-01-02T00:00:00Z",
      }),
    ];
    render(<EventTimeline events={events} />);

    const rendered = screen.getAllByText(/Run Requested|Plan Created/);
    expect(rendered[0].textContent).toBe("Plan Created");
    expect(rendered[1].textContent).toBe("Run Requested");
  });

  it("uses the done color for an APPROVED event", () => {
    const { container } = render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REVIEW_APPROVED" })]}
      />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("uses the done color for EXECUTION_FINISHED", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "EXECUTION_FINISHED" })]} />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
  });

  it("uses the blocked color for a REJECTED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "PLAN_REJECTED" })]} />,
    );
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("uses the blocked color for a BLOCKED event", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
  });

  it("uses the accent color as the default for an unmapped event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_OTHER_EVENT" })]} />,
    );
    expect(container.querySelector("svg.text-accent")).not.toBeNull();
  });

  it("renders the from/to state transition when present in the payload", () => {
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

  it("renders feedback text for a PLAN_REJECTED event", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_REJECTED",
            payloadJson: { feedback: "Needs more detail" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Needs more detail")).toBeDefined();
  });

  it("does not render feedback for other event types even if present", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "PLAN_APPROVED",
            payloadJson: { feedback: "Should not render" },
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Should not render")).toBeNull();
  });

  it("uses a User source icon for human/user-command sources", () => {
    render(
      <EventTimeline
        events={[makeEvent({ source: "user-command" })]}
      />,
    );
    expect(screen.getByText("user-command")).toBeDefined();
  });

  it("falls back to the Bot source icon for an unmapped source", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ source: "ai-agent" })]} />,
    );
    expect(screen.getByText("ai-agent")).toBeDefined();
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
  });

  it("shows the formatted timestamp as a title attribute", () => {
    render(
      <EventTimeline
        events={[makeEvent({ createdAt: "2024-03-15T10:30:00Z" })]}
      />,
    );
    const timeEl = screen.getByTitle(/Mar 15/);
    expect(timeEl).toBeDefined();
  });
});
