import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = `ev-${to}`): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "TRANSITION",
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
  it("renders all happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks the first step current (spinner) with no steps completed at Todo", () => {
    const { container } = render(<WorkflowStepper currentState="Todo" events={[]} />);
    // Loader2 spinner rendered for current step
    expect(container.querySelector("svg.lucide-loader-circle, svg.animate-spin")).not.toBeNull();
    // No completed check icons yet
    expect(container.querySelector("svg.lucide-check")).toBeNull();
  });

  it("marks earlier steps completed and the current step with a spinner mid-flow", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Todo, Planning, PlanReview, AwaitingPlanApproval (4 states before Implementing) => 4 checks
    const checks = container.querySelectorAll("svg.lucide-check");
    expect(checks.length).toBe(4);

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
  });

  it("marks all steps completed (checks) when currentState is Done, including the last step", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const checks = container.querySelectorAll("svg.lucide-check");
    expect(checks.length).toBe(ALL_LABELS.length);
    // no spinner should render since everything is "completed"
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("does not render the side-state box for a normal happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });

  it("renders 'Revising Plan' side box and treats prior steps as completed for PlanRevision", () => {
    const { container } = render(
      <WorkflowStepper currentState="PlanRevision" events={[]} />,
    );
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanRevision maps to PlanReview (index 2); Todo & Planning (idx 0,1) should be completed
    const checks = container.querySelectorAll("svg.lucide-check");
    expect(checks.length).toBe(2);
  });

  it("renders 'Addressing Review' side box for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders 'Blocked' side box with the blocked-colored dot for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders 'Needs Clarification' side box with the active/pulsing dot for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".bg-state-active.animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("renders a relative timestamp for a step whose state was reached, derived from events", () => {
    const events: RunEventRecord[] = [
      makeEvent("Planning", "2024-01-01T00:00:00Z"),
    ];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    const planningLabel = screen.getByText("Planning");
    const stepContainer = planningLabel.closest("div.min-w-0");
    expect(stepContainer?.textContent).toMatch(/ago|just now/);
  });

  it("uses the first event's timestamp when multiple events transition to the same state", () => {
    const events: RunEventRecord[] = [
      makeEvent("Planning", "2024-01-01T00:00:00Z", "first"),
      makeEvent("Planning", "2024-06-01T00:00:00Z", "second"),
    ];
    const { container } = render(
      <WorkflowStepper currentState="PlanReview" events={events} />,
    );
    // Only one timestamp node should render for the Planning step (deduped)
    const planningLabel = screen.getByText("Planning");
    const stepRow = planningLabel.closest(".relative.flex");
    const timestampNodes = stepRow?.querySelectorAll(".text-\\[10px\\].text-text-muted.mt-0\\.5");
    expect(timestampNodes?.length).toBe(1);
    expect(container).toBeDefined();
  });

  it("does not render a timestamp for a step that has no matching event", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const todoLabel = screen.getByText("To Do");
    const stepContainer = todoLabel.closest("div.min-w-0");
    expect(stepContainer?.textContent).toBe("To Do");
  });
});
