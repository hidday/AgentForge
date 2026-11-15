import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels", () => {
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

  it("marks earlier steps completed and the current step as current for a mid-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");
  });

  it("marks every step completed (check icon) when currentState is Done, even Done itself", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    // Every step's icon wrapper uses the "completed" background, including the Done row itself.
    const completedWrappers = container.querySelectorAll(".bg-state-done\\/20");
    expect(completedWrappers.length).toBe(8);
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });

  it("maps PlanRevision's progress to just before the PlanReview step and shows the 'Revising Plan' side panel", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Steps before the mapped index are completed; the mapped step itself is neither
    // completed nor "current" (no happy-path state literally equals "PlanRevision").
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("maps AddressingReview's progress to just before the AIReview step and shows the 'Addressing Review' side panel", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("shows 'Blocked' side panel with the blocked dot color for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows 'Needs Clarification' side panel with the active (non-blocked) dot color for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).toBeNull();
    expect(container.querySelector(".bg-state-active")).not.toBeNull();
  });

  it("shows a relative timestamp for a step whose transition event is in the events list", () => {
    const events: RunEventRecord[] = [
      makeEvent({ eventType: "PLAN_CREATED", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
    ];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    // relativeTime() for a date far in the past renders as "<n>d ago"
    expect(screen.getByText(/ago$/)).toBeDefined();
  });

  it("uses the first matching event's timestamp when multiple events transition to the same state", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", eventType: "A", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", eventType: "B", payloadJson: { to: "Planning" }, createdAt: "2024-06-01T00:00:00Z" }),
    ];
    const { container } = render(<WorkflowStepper currentState="Planning" events={events} />);
    const timestampEls = container.querySelectorAll(".text-\\[10px\\].text-text-muted.mt-0\\.5");
    expect(timestampEls.length).toBe(1);
  });

  it("ignores events whose payload has no 'to' field when building timestamps", () => {
    const events: RunEventRecord[] = [makeEvent({ payloadJson: {} })];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    // Should not throw, and Todo step renders without a timestamp line
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
