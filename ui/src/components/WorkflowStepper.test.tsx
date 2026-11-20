import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  to: string,
  createdAt: string,
  id = `ev-${to}`,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "SOME_EVENT",
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

  it("marks every step completed and shows no side-state banner when state is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // The final step is both "completed" and "current"; the merged class
    // keeps the current (accent) color, and an earlier step shows done.
    expect(screen.getByText("Done").className).toContain("text-accent");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("highlights the current step and marks earlier ones completed", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    // Later states are upcoming
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("shows a timestamp for a state that has a matching event", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // relativeTime for a long-past date renders as "Xd ago"
    expect(screen.getByText(/ago/)).toBeDefined();
  });

  it("maps a side-state (PlanRevision) onto its effective happy-path index and shows the banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanRevision maps to PlanReview's index: steps before it are completed,
    // but none of the happy-path labels literally equals "PlanRevision", so
    // none is rendered as the "current" (accent) step.
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("maps AddressingReview onto AIReview and shows its banner label", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("shows the blocked banner styling for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("shows the HumanClarificationNeeded banner label", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });
});
