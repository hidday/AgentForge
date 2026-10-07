import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  id: string,
  to: string,
  createdAt: string,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGE",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

function labelEl(text: string) {
  return screen.getByText(text);
}

describe("WorkflowStepper", () => {
  it("marks the current state as active (accent) and later states as upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-accent");
    expect(labelEl("Planning").className).toContain("text-text-muted");
    expect(labelEl("Done").className).toContain("text-text-muted");
  });

  it("marks earlier states completed and the current state active mid-pipeline", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-state-done");
    expect(labelEl("Planning").className).toContain("text-state-done");
    expect(labelEl("Awaiting Approval").className).toContain("text-state-done");
    expect(labelEl("Implementing").className).toContain("text-accent");
    expect(labelEl("AI Review").className).toContain("text-text-muted");
    expect(labelEl("Human Review").className).toContain("text-text-muted");
  });

  it("marks every step completed when the state is Done, including the Done step itself", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-state-done");
    expect(labelEl("Human Review").className).toContain("text-state-done");
    expect(labelEl("Done").className).toContain("text-state-done");
  });

  it("leaves every step upcoming for a state outside the happy path and without a side-state mapping", () => {
    render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-text-muted");
    expect(labelEl("Done").className).toContain("text-text-muted");
    // No side-state panel should be rendered either
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("renders a relative timestamp for a state with a recorded transition event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("e1", "Planning", new Date().toISOString())]}
      />,
    );

    const planningLabel = labelEl("Planning");
    const container = planningLabel.closest("div")!.parentElement!;
    expect(container.textContent).toContain("just now");
  });

  it("shows the 'Revising Plan' side panel with an active dot for the PlanRevision side state", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the 'Addressing Review' side panel for the AddressingReview side state", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);

    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked side panel for the AIBlocked side state", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);

    const label = screen.getByText("Blocked");
    const dot = label.previousElementSibling as HTMLElement;
    expect(dot.className).toContain("bg-state-blocked");
  });

  it("shows a non-blocked (active) side panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);

    const label = screen.getByText("Needs Clarification");
    const dot = label.previousElementSibling as HTMLElement;
    expect(dot.className).toContain("bg-state-active");
    expect(dot.className).toContain("animate-pulse-dot");
  });
});
