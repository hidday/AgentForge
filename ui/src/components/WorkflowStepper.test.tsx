import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  id: string,
  to: string,
  createdAt: string,
  from?: string,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGE",
    source: "system",
    payloadJson: { from, to },
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

  it("marks earlier states as completed and current state distinctly when mid-flow", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const implementing = screen.getByText("Implementing");
    expect(implementing.className).toContain("text-accent");

    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");

    const aiReview = screen.getByText("AI Review");
    expect(aiReview.className).toContain("text-text-muted");
  });

  it("marks every earlier state as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // The Done row is both completed and current; twMerge keeps the
    // later-applied "current" text color class (text-accent) over "completed".
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");
  });

  it("renders a relative timestamp for a state that has a matching event", () => {
    const events = [makeEvent("e1", "Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    // relativeTime for a far-past date renders as "Xd ago"
    expect(screen.getByText(/ago/)).toBeDefined();
  });

  it("does not render a timestamp for states with no matching event", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("maps a side state (PlanRevision) onto its PlanReview position and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("maps AddressingReview onto AIReview and shows its banner label", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the Blocked banner with blocked styling for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows the Needs Clarification banner with active/pulsing styling for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".bg-state-active.animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not show the side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("only records the earliest event timestamp when multiple events map to the same state", () => {
    const events = [
      makeEvent("e1", "Planning", "2024-01-02T00:00:00Z"),
      makeEvent("e2", "Planning", "2024-01-03T00:00:00Z"),
    ];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    // Only one timestamp element should be rendered for the Planning row
    const agoTexts = screen.getAllByText(/ago/);
    expect(agoTexts.length).toBe(1);
  });

  it("treats an unrecognized currentState as having no happy-path index (nothing marked current/completed by name match)", () => {
    render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);
    // No step's isCurrent should be true; all should be upcoming (muted) since
    // currentIdx is -1 and isSideState is false.
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-text-muted");
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
