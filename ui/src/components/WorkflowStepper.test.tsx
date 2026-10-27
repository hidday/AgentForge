import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt = "2024-01-01T00:00:00Z"): RunEventRecord {
  return {
    id: `ev-${to}`,
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
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

  it("marks every earlier step completed when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Earlier steps should carry the completed (state-done) styling.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("marks the current state label with the accent styling", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const label = screen.getByText("Implementing");
    expect(label.className).toContain("text-accent");
  });

  it("marks upcoming states (after current) with muted styling", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    const upcoming = screen.getByText("Implementing");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("renders a relative timestamp for a state with a matching event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", "2024-01-01T00:00:00Z")]}
      />,
    );
    // relativeTime() of a far-past date renders as "Xd ago"
    expect(screen.getByText(/ago$/)).toBeDefined();
  });

  it("shows the 'Revising Plan' side-state banner for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the 'Addressing Review' side-state banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the 'Blocked' side-state banner for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("shows the 'Needs Clarification' side-state banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });
});
