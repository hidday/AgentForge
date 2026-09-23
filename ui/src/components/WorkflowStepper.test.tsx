import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "SOME_TRANSITION",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
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

  it("marks earlier states as completed and the current state as in-progress", () => {
    const { container } = render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // Todo, Planning, PlanReview, AwaitingPlanApproval come before Implementing => completed (checkmarks)
    // Completed steps render with the state-done label color
    const doneLabels = container.querySelectorAll(".text-state-done");
    expect(doneLabels.length).toBeGreaterThanOrEqual(4);
    // Current step rendered with accent color
    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");
    // Upcoming steps rendered muted
    const upcoming = screen.getByText("AI Review");
    expect(upcoming.className).toContain("text-text-muted");
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
    // The final "Done" step is both completed AND the current step; the
    // accent (current) color wins the Tailwind-merge over the done color.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("shows a relative timestamp for a state that has a recorded transition event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent({ payloadJson: { to: "Planning" } })]}
      />,
    );
    // relativeTime for a fixed past date renders some "<n> ago"/"just now" text;
    // just assert the Planning row rendered without throwing and contains a time hint.
    const planningLabel = screen.getByText("Planning");
    const row = planningLabel.closest("div.min-w-0");
    expect(row?.textContent).toMatch(/ago|just now/);
  });

  it("keeps only the first event's timestamp per target state", () => {
    render(
      <WorkflowStepper
        currentState="Done"
        events={[
          makeEvent({ id: "e1", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
          makeEvent({ id: "e2", payloadJson: { to: "Planning" }, createdAt: "2024-06-01T00:00:00Z" }),
        ]}
      />,
    );
    const planningLabel = screen.getByText("Planning");
    const row = planningLabel.closest("div.min-w-0");
    // Only one timestamp element should be present under this row
    expect(row?.querySelectorAll(".text-\\[10px\\].text-text-muted").length).toBe(1);
  });

  it("ignores events without a payload 'to' field", () => {
    render(
      <WorkflowStepper
        currentState="Todo"
        events={[makeEvent({ payloadJson: null }), makeEvent({ id: "e2", payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("renders the PlanRevision side-state banner mapped onto PlanReview, labeled 'Revising Plan'", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Steps strictly before the mapped PlanReview index are completed...
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    // ...while PlanReview itself is neither completed nor "current" (the raw
    // currentState is "PlanRevision", not "PlanReview"), so it stays upcoming.
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("renders the AddressingReview side-state banner mapped onto AIReview, labeled 'Addressing Review'", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the AIBlocked side-state banner with blocked styling, labeled 'Blocked'", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the HumanClarificationNeeded side-state banner with active styling, labeled 'Needs Clarification'", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
  });
});
