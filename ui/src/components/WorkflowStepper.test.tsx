import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(
  id: string,
  to: string,
  createdAt: string,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

const ALL_LABELS = [
  "To Do",
  "Planning",
  "Plan Review",
  "Awaiting Approval",
  "Implementing",
  "AI Review",
  "Human Review",
  "Done",
];

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels in order", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const labels = screen.getAllByText(
      /^(To Do|Planning|Plan Review|Awaiting Approval|Implementing|AI Review|Human Review|Done)$/,
    );
    expect(labels.map((l) => l.textContent)).toEqual(ALL_LABELS);
  });

  it("marks the current state's step as current and all following as upcoming", () => {
    const { container } = render(
      <WorkflowStepper currentState="Todo" events={[]} />,
    );
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-accent");

    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-text-muted");

    // No checkmarks yet (nothing completed)
    expect(container.querySelectorAll("svg.lucide-check").length).toBe(0);
  });

  it("marks earlier steps completed, the matching step current, and later steps upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Plan Review").className).toContain("text-state-done");
    expect(screen.getByText("Awaiting Approval").className).toContain(
      "text-state-done",
    );
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(screen.getByText("Human Review").className).toContain("text-text-muted");
  });

  it("marks every prior step completed and the final Done step as current when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    for (const label of ALL_LABELS.slice(0, -1)) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // The Done step itself is both completed and current; current styling wins.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("maps a side state to its parent happy-path step and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    // Plan Review step should read as "current" position anchor (effectiveIdx),
    // and the side-state banner should explain we're revising the plan.
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // None of the happy-path labels themselves equal "PlanRevision"
    expect(screen.queryByText("PlanRevision")).toBeNull();
  });

  it("shows the blocked banner styling and label for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows 'Needs Clarification' banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("shows 'Addressing Review' banner for AddressingReview and maps to AI Review position", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
  });

  it("does not show a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("shows a relative timestamp for a step that has a matching event, using the first matching event", () => {
    const events: RunEventRecord[] = [
      makeEvent("e1", "Planning", new Date(Date.now() - 5 * 60_000).toISOString()),
      makeEvent("e2", "Planning", new Date(Date.now() - 1000).toISOString()),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    const stepContainer = planningLabel.closest("div.min-w-0");
    expect(stepContainer?.textContent).toMatch(/ago/);
  });

  it("shows no timestamp under a step that has no matching event", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const todoLabel = screen.getByText("To Do");
    const stepContainer = todoLabel.closest("div.min-w-0");
    expect(stepContainer?.textContent).toBe("To Do");
  });
});
