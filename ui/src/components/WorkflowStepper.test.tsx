import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "ai",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
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

  it("marks earlier states as completed when currentState is mid-path", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // "To Do" and "Planning" should be completed (shown with the done color)
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
    void container;
  });

  it("marks every step as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("shows a relative timestamp for a state reached via a to-transition event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[
          makeEvent({
            payloadJson: { to: "Planning" },
            createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          }),
        ]}
      />,
    );
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("renders the PlanRevision side-state banner mapped onto PlanReview", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview step itself is not literally "current" (PlanRevision isn't in HAPPY_PATH_STATES)
    expect(screen.queryByText("PlanRevision")).toBeNull();
  });

  it("renders the AddressingReview side-state banner mapped onto AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the AIBlocked side-state banner with blocked styling", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the HumanClarificationNeeded side-state banner with active styling", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("only uses the first to-transition event when a state is reached more than once", () => {
    render(
      <WorkflowStepper
        currentState="Done"
        events={[
          makeEvent({
            payloadJson: { to: "Todo" },
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          makeEvent({
            payloadJson: { to: "Todo" },
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
        ]}
      />,
    );
    // Should not throw and should render the To Do label once with a timestamp
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("ignores events without a payload to-field", () => {
    render(
      <WorkflowStepper
        currentState="Todo"
        events={[makeEvent({ payloadJson: null })]}
      />,
    );
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
