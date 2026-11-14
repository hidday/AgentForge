import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventTimeline } from "./EventTimeline.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: `e-${Math.random()}`,
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "orchestrator",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events yet")).toBeDefined();
  });

  it("renders events most-recent first", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED", createdAt: "2026-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED", createdAt: "2026-01-02T00:00:00Z" }),
    ];
    render(<EventTimeline events={events} />);
    const labels = screen.getAllByText(/Run Requested|Plan Created/);
    expect(labels[0].textContent).toBe("Plan Created");
    expect(labels[1].textContent).toBe("Run Requested");
  });

  it("formats the event type into title case with spaces", () => {
    render(<EventTimeline events={[makeEvent({ eventType: "PLAN_REVIEW_CHANGES_REQUESTED" })]} />);
    expect(screen.getByText("Plan Review Changes Requested")).toBeDefined();
  });

  it("shows a from -> to state transition when present in the payload", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED", payloadJson: { from: "Planning", to: "PlanReview" } })]}
      />,
    );
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("PlanReview")).toBeDefined();
  });

  it("shows rejection feedback only for PLAN_REJECTED events", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_REJECTED", payloadJson: { feedback: "needs oauth" } })]}
      />,
    );
    expect(screen.getByText("needs oauth")).toBeDefined();
  });

  it("does not show feedback text for a non-rejection event even if present in payload", () => {
    render(
      <EventTimeline
        events={[makeEvent({ eventType: "PLAN_CREATED", payloadJson: { feedback: "should not show" } })]}
      />,
    );
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("shows the human source icon label distinctly from the default bot source", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", source: "human" }),
          makeEvent({ id: "e2", source: "orchestrator" }),
        ]}
      />,
    );
    expect(screen.getByText("human")).toBeDefined();
    expect(screen.getByText("orchestrator")).toBeDefined();
  });

  it("colors blocked/rejected/changes-requested events distinctly", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "BLOCKED" })]} />,
    );
    expect(container.querySelector(".text-state-blocked")).not.toBeNull();
  });

  it("colors an APPROVED event as done", () => {
    const { container } = render(<EventTimeline events={[makeEvent({ eventType: "PLAN_APPROVED" })]} />);
    expect(container.querySelector(".text-state-done")).not.toBeNull();
  });

  it("colors EXECUTION_FINISHED and REMEDIATION_FINISHED as done", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "EXECUTION_FINISHED" }),
          makeEvent({ id: "e2", eventType: "REMEDIATION_FINISHED" }),
        ]}
      />,
    );
    expect(container.querySelectorAll(".text-state-done").length).toBe(2);
  });

  it("colors REJECTED and CHANGES_REQUESTED events as blocked", () => {
    const { container } = render(
      <EventTimeline
        events={[
          makeEvent({ id: "e1", eventType: "PLAN_REJECTED" }),
          makeEvent({ id: "e2", eventType: "REVIEW_CHANGES_REQUESTED" }),
        ]}
      />,
    );
    expect(container.querySelectorAll(".text-state-blocked").length).toBe(2);
  });

  it("falls back to the generic accent color and Zap icon for an unrecognized event type", () => {
    const { container } = render(
      <EventTimeline events={[makeEvent({ eventType: "SOME_UNKNOWN_EVENT" })]} />,
    );
    expect(screen.getByText("Some Unknown Event")).toBeDefined();
    expect(container.querySelector(".text-accent")).not.toBeNull();
  });
});
