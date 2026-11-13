import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = `e-${to}`): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "TRANSITION",
    source: "ai",
    payloadJson: { to },
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

  it("marks steps before the current state as completed", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("marks the current state label with the accent class", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const label = screen.getByText("Implementing");
    expect(label.className).toContain("text-accent");
  });

  it("marks upcoming states with the muted text class", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    const label = screen.getByText("Human Review");
    expect(label.className).toContain("text-text-muted");
  });

  it("marks every earlier step completed and the final step current when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");
    // The last step is both "completed" and "current" (state === currentState);
    // the isCurrent class is applied last and wins via twMerge.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
  });

  it("does not mark the mapped parent step as current for a side state, but shows the side banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    // PlanRevision maps to PlanReview for completion purposes, but isCurrent
    // only matches a literal HAPPY_PATH_STATES equality, so PlanReview is
    // rendered as upcoming (muted) rather than current while side-stated.
    const planReviewLabel = screen.getByText("Plan Review");
    expect(planReviewLabel.className).toContain("text-text-muted");
    // and shows the side-state banner
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the Addressing Review side-state banner with the active dot color", () => {
    const { container } = render(
      <WorkflowStepper currentState="AddressingReview" events={[]} />,
    );
    expect(screen.getByText("Addressing Review")).toBeDefined();
    const dot = container.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("shows the Blocked side-state banner with the blocked dot color for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows the Needs Clarification banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("renders the relative timestamp for a state that has a matching event", () => {
    render(
      <WorkflowStepper
        currentState="Planning"
        events={[makeEvent("Planning", "2024-01-01T00:00:00Z")]}
      />,
    );
    // relativeTime for an old date should render as "Xd ago"
    expect(screen.getByText(/ago/)).toBeDefined();
  });

  it("uses the earliest event's timestamp when multiple events target the same state", () => {
    render(
      <WorkflowStepper
        currentState="Done"
        events={[
          makeEvent("Planning", "2024-01-01T00:00:00Z", "e1"),
          makeEvent("Planning", "2024-06-01T00:00:00Z", "e2"),
        ]}
      />,
    );
    // Only one timestamp row should render for Planning (first-seen wins)
    const agoNodes = screen.getAllByText(/ago/);
    expect(agoNodes.length).toBe(1);
  });
});
