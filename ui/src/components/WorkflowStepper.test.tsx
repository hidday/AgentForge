import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `ev-${to}`,
    runId: "run-1",
    eventType: "X",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
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

  it("shows a timestamp for a state with a recorded transition", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", "2024-01-01T00:00:00Z")]}
      />,
    );
    // relativeTime renders something like "Xd ago" / "just now" next to Planning
    const planningLabel = screen.getByText("Planning");
    const container = planningLabel.closest("div")?.parentElement;
    expect(container?.textContent).toMatch(/ago|just now/);
  });

  it("marks all states before the current one as completed when current is mid-path", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Planning + PlanReview + AwaitingPlanApproval should show the done check icon
    const doneIcons = container.querySelectorAll(".bg-state-done\\/20");
    expect(doneIcons.length).toBeGreaterThanOrEqual(3);
  });

  it("marks every step as completed when the run is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const doneIcons = container.querySelectorAll(".bg-state-done\\/20");
    expect(doneIcons.length).toBe(8);
  });

  it("shows the side-state panel with 'Revising Plan' for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the side-state panel with 'Addressing Review' for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the side-state panel with 'Blocked' for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("shows the side-state panel with 'Needs Clarification' for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("only records the first transition timestamp per state when duplicates exist", () => {
    render(
      <WorkflowStepper
        currentState="Done"
        events={[
          makeEvent("Planning", "2024-01-01T00:00:00Z"),
          makeEvent("Planning", "2024-06-01T00:00:00Z"),
        ]}
      />,
    );
    // Should not throw and should still render Planning once
    expect(screen.getAllByText("Planning").length).toBe(1);
  });
});
