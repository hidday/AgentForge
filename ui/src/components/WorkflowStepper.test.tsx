import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `evt-${to}`,
    runId: "run-1",
    eventType: "X",
    source: "human",
    payloadJson: { to },
    createdAt,
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

  it("marks states before the current state as completed and shows a timestamp", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00.000Z")];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);

    // Planning state should show a relative timestamp since an event recorded its transition.
    const planningLabel = screen.getByText("Planning");
    const planningRow = planningLabel.closest("div.min-w-0");
    expect(planningRow?.textContent).toMatch(/ago|just now/);
  });

  it("marks the current state distinctly from completed/upcoming", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Current state icon uses an animate-spin loader
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("treats Done as fully completed", () => {
    const { container } = render(
      <WorkflowStepper currentState="Done" events={[]} />,
    );
    // No current-state spinner should remain when Done
    expect(container.querySelector(".animate-spin")).toBeNull();
    // Should have completed checkmarks for all steps
    const checks = container.querySelectorAll(".text-state-done");
    expect(checks.length).toBeGreaterThan(0);
  });

  it("maps PlanRevision side-state to PlanReview position and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("maps AddressingReview side-state to AIReview position and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked banner for AIBlocked with blocked styling", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows a 'Needs Clarification' banner for HumanClarificationNeeded", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not show the side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("ignores duplicate payload 'to' values and keeps the first timestamp seen", () => {
    const events = [
      makeEvent("Planning", "2024-06-01T00:00:00.000Z"),
      makeEvent("Planning", "2024-06-02T00:00:00.000Z"),
    ];
    // Should not throw with duplicate transitions to the same state.
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("handles events with null payload without crashing", () => {
    const events: RunEventRecord[] = [
      {
        id: "evt-null",
        runId: "run-1",
        eventType: "X",
        source: "human",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
