import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = to): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "TRANSITION",
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

  it("marks all steps completed when currentState is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    // Every step should show the check icon (lucide renders an <svg>); count
    // check-circle backgrounds via class name used only for completed steps.
    const completedDots = container.querySelectorAll(".bg-state-done\\/20");
    expect(completedDots.length).toBe(8);
  });

  it("shows a timestamp for a state present in the events list", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    // relativeTime will render something like "Xd ago"; just assert some
    // time text rendered alongside the Planning label.
    const planningLabel = screen.getByText("Planning");
    const container = planningLabel.parentElement;
    expect(container?.textContent).toMatch(/ago|just now/);
  });

  it("renders the side-state banner with 'Revising Plan' text for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders the side-state banner with 'Addressing Review' text for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the side-state banner with 'Blocked' text for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("renders the side-state banner with 'Needs Clarification' text for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });
});
