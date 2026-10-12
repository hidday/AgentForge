import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `evt-${to}`,
    runId: "run-1",
    eventType: "TRANSITION",
    source: "ai",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    for (const label of [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
      "Done",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks steps before the current state as completed and the current state as active", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");

    // Completed steps show a check icon, current step shows a spinner
    expect(container.querySelectorAll(".animate-spin").length).toBe(1);
  });

  it("marks all prior steps as completed and the final Done step as current when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    // The Done row is both "completed" and "current"; tailwind-merge resolves
    // the conflicting text-color utilities in favor of the current (accent) class.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("shows a relative timestamp for a state that has a matching transition event", () => {
    render(
      <WorkflowStepper
        currentState="Planning"
        events={[makeEvent("Planning", new Date().toISOString())]}
      />,
    );
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("renders a side-state banner for PlanRevision mapped onto Plan Review", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders a side-state banner for AddressingReview mapped onto AI Review", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders a blocked side-state banner with blocked styling for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders a waiting side-state banner for HumanClarificationNeeded without the blocked dot color", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    // getStateCategory("HumanClarificationNeeded") is "waiting", not "blocked",
    // so the banner dot should use the active/pulse styling, not bg-state-blocked.
    expect(container.querySelector(".bg-state-blocked")).toBeNull();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
