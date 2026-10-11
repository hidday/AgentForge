import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `ev-${to}`,
    runId: "run-1",
    eventType: "state:changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks early happy-path states as completed and the current one as in-progress", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed steps before "Implementing"
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");

    // Current step
    expect(screen.getByText("Implementing").className).toContain("text-accent");

    // Upcoming steps after current
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(screen.getByText("Human Review").className).toContain("text-text-muted");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("marks every step completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    for (const label of [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
    ]) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // "Done" itself is both completed and current (state === currentState);
    // tailwind-merge resolves the conflicting text-color utilities in favor
    // of the later "isCurrent" class, so it renders as text-accent.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("maps a side state (PlanRevision) onto its happy-path position and shows the side banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    // PlanRevision maps to PlanReview's index; PlanReview itself should
    // render as upcoming (not completed, not current) since effectiveIdx
    // equals its own index (not >).
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");

    // The side-state banner should be visible with the right message.
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows 'Addressing Review' banner and maps onto AIReview for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("shows blocked styling and message for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    // The banner dot should use the blocked color, not the active pulse.
    const blockedDot = container.querySelector(".bg-state-blocked");
    expect(blockedDot).not.toBeNull();
  });

  it("shows 'Needs Clarification' message for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render the side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("renders a relative timestamp for a state derived from matching events", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", new Date().toISOString())]}
      />,
    );
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("uses the first event's timestamp when multiple events target the same state", () => {
    const older = new Date(Date.now() - 1000 * 60 * 5).toISOString(); // 5m ago
    const newer = new Date().toISOString();
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", older), makeEvent("Planning", newer)]}
      />,
    );
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("ignores events with no 'to' field in the payload", () => {
    const badEvent: RunEventRecord = {
      id: "ev-bad",
      runId: "run-1",
      eventType: "state:changed",
      source: "system",
      payloadJson: null,
      createdAt: new Date().toISOString(),
    };
    render(<WorkflowStepper currentState="Planning" events={[badEvent]} />);
    // Should render without throwing and show the Planning step.
    expect(screen.getByText("Planning")).toBeDefined();
  });
});
