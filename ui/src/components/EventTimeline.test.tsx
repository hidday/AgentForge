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
    source: overrides.source ?? "ai",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
    expect(screen.queryByText("Events")).toBeNull();
  });

  it("renders the Events heading and formats event types as title case with spaces", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "RUN_REQUESTED" })]}
      />,
    );
    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Run Requested")).toBeDefined();
  });

  it("renders events in reverse chronological order (most recent first)", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("shows the from/to transition when payload contains both fields", () => {
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

  it("does not show a from/to row when payload lacks those fields", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "RUN_REQUESTED", payloadJson: null })]}
      />,
    );
    expect(screen.queryByText("Failed")).toBeNull();
  });

  it("shows rejection feedback text only for PLAN_REJECTED events with feedback", () => {
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

  it("does not show feedback text for a non-PLAN_REJECTED event even if payload has feedback", () => {
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

  it("renders the event source label", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "HUMAN_APPROVED", source: "human" })]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
  });

  it("renders a relative time with a full timestamp title attribute", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({
            eventType: "RUN_REQUESTED",
            createdAt: new Date().toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("renders multiple distinct event types with their own icon styling classes", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "a", eventType: "PLAN_APPROVED" }),
          makeEvent({ id: "b", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "c", eventType: "EXECUTION_STARTED" }),
        ]}
      />,
    );
    expect(container.querySelector("svg.text-state-done")).not.toBeNull();
    expect(container.querySelector("svg.text-state-blocked")).not.toBeNull();
    expect(container.querySelectorAll("svg.text-accent").length).toBeGreaterThan(0);
  });
});
