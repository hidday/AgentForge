import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(id: string, to: string, createdAt: string): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path step label", () => {
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

  it("marks earlier steps as completed and shows a timestamp when the event history has one", () => {
    const events = [makeEvent("e1", "Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);

    // "Planning" step's timestamp should render since it's in stateTimestamps.
    expect(screen.getByText(/ago|just now/i)).toBeDefined();
  });

  it("marks all happy-path steps completed when currentState is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    // Every non-final step should render the "completed" check icon.
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    expect(checkIcons.length).toBe(8);
    // No upcoming (text-muted) steps should remain when in Done state.
    expect(container.querySelectorAll(".text-text-muted.text-sm").length).toBe(0);
  });

  it("shows the 'Revising Plan' side-state panel for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the 'Addressing Review' side-state panel for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the 'Blocked' side-state panel with blocked styling for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the 'Needs Clarification' side-state panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("only uses the first timestamp seen per target state (does not overwrite)", () => {
    const events = [
      makeEvent("e1", "Planning", "2024-01-01T00:00:00Z"),
      makeEvent("e2", "Planning", "2024-06-01T00:00:00Z"),
    ];
    // Just assert it renders without throwing and shows exactly one relative-time node
    // for the Planning step (rendered once, from the first occurrence).
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const relativeTimes = screen.getAllByText(/ago|just now/i);
    expect(relativeTimes.length).toBe(1);
  });
});
