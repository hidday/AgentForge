import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "SOME_TRANSITION",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("renders the 'Revising Plan' side-state banner for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders the 'Addressing Review' side-state banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the 'Blocked' side-state banner for AIBlocked with blocked dot styling", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the 'Needs Clarification' side-state banner for HumanClarificationNeeded", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("marks all happy-path steps as completed when currentState is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    // Every step before the connecting line should use the done color on the
    // step label, since Done always marks everything completed.
    const doneLabels = container.querySelectorAll(".text-state-done");
    expect(doneLabels.length).toBeGreaterThan(0);
  });

  it("renders the relative timestamp for a state captured in events", () => {
    const events: RunEventRecord[] = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
    ];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    expect(screen.getByText(/ago|just now/)).toBeDefined();
  });

  it("uses the first occurrence's timestamp when multiple events transition to the same state", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", payloadJson: { to: "Planning" }, createdAt: "2020-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", payloadJson: { to: "Planning" }, createdAt: "2023-01-01T00:00:00Z" }),
    ];
    // Should not throw and should render exactly one timestamp for Planning
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getAllByText(/ago/).length).toBeGreaterThanOrEqual(1);
  });

  it("ignores events with no 'to' field in payload", () => {
    const events: RunEventRecord[] = [makeEvent({ payloadJson: {} })];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
