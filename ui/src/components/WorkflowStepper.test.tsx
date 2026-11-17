import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("marks only the current step as in-progress on the happy path and leaves later steps upcoming", () => {
    const { container } = render(
      <WorkflowStepper currentState="Planning" events={[]} />,
    );

    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    // Current step shows the spinning loader icon.
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("marks every step completed when the run is Done", () => {
    const { container } = render(
      <WorkflowStepper currentState="Done" events={[]} />,
    );

    expect(container.querySelector(".animate-spin")).toBeNull();
    // No upcoming (muted) step labels should remain once the run is done.
    expect(container.querySelectorAll(".text-text-muted.text-sm").length).toBe(0);
  });

  it("renders the side-state panel for an active side state (PlanRevision) mapped onto PlanReview", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders the side-state panel for a blocked side state (AIBlocked) with no happy-path step current", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );

    expect(screen.getByText("Blocked")).toBeDefined();
    // AIBlocked isn't itself in the happy path, so nothing is "current".
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("renders the side-state panel for HumanClarificationNeeded", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );

    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("shows a relative timestamp for a happy-path state using the first matching event", () => {
    const events = [
      makeEvent({
        id: "e1",
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
      makeEvent({
        id: "e2",
        payloadJson: { to: "Planning" },
        createdAt: new Date().toISOString(),
      }),
    ];

    render(<WorkflowStepper currentState="PlanReview" events={events} />);

    // The first event for "Planning" wins (map only set once), so ~5m ago.
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("ignores events without a 'to' field in the payload without crashing", () => {
    const events = [
      makeEvent({ payloadJson: { feedback: "no to field" } }),
      makeEvent({ payloadJson: null }),
    ];

    render(<WorkflowStepper currentState="Todo" events={events} />);

    expect(screen.getByText("To Do")).toBeDefined();
  });
});
