import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RESET_TO_TODO",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels", () => {
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

  it("marks the current step distinctly from completed and upcoming steps", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");

    const completed = screen.getByText("Planning");
    expect(completed.className).toContain("text-state-done");

    const upcoming = screen.getByText("AI Review");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("marks every step as completed when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const step = screen.getByText("Planning");
    expect(step.className).toContain("text-state-done");
  });

  it("renders a relative timestamp for a state that has a matching event", () => {
    const events: RunEventRecord[] = [
      makeEvent({ eventType: "PLAN_CREATED", payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/just now/)).toBeDefined();
  });

  it("shows a side-state panel with 'Revising Plan' for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows a side-state panel with 'Addressing Review' for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked-styled side panel for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows 'Needs Clarification' for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
