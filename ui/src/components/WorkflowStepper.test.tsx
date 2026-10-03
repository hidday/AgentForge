import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "ai",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("marks happy-path steps before the current state as completed", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // "To Do" and "Planning" and "Plan Review" and "Awaiting Approval" come
    // before "Implementing" in HAPPY_PATH_STATES, so should be completed.
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");
    expect(container).toBeDefined();
  });

  it("marks all prior steps completed when state is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Earlier steps are both "completed" (effectiveIdx > idx) and resolve to
    // the done styling since isCurrent is false for them.
    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-state-done");
    // The terminal "Done" row is both isCompleted (currentState === "Done")
    // and isCurrent (state === currentState); twMerge keeps the later
    // "text-accent" class over the earlier "text-state-done" one for the
    // conflicting text-color utility.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
    expect(doneLabel.className).not.toContain("text-state-done");
  });

  it("renders a relative timestamp for a state with a recorded transition event", () => {
    const createdAt = new Date().toISOString();
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[
          makeEvent({
            payloadJson: { to: "Planning" },
            createdAt,
          }),
        ]}
      />,
    );
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("renders a side-state banner for PlanRevision mapped to PlanReview progress", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Plan Review itself should be rendered as current-ish via the mapped index.
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("renders a blocked-style side-state banner for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the HumanClarificationNeeded side-state banner", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders the AddressingReview side-state banner", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("does not render a side-state banner for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });
});
