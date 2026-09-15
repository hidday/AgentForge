import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "agent",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders the Workflow header and all happy-path state labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks the current state and does not render the side-state panel for a happy-path state", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    const label = screen.getByText("Implementing");
    expect(label.className).toContain("text-accent");
    // No side-state panel should exist
    expect(container.querySelectorAll(".animate-pulse-dot").length).toBe(0);
  });

  it("marks earlier states as completed with the done color and a check icon", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");
    // Check icons rendered for completed steps (lucide Check icon)
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("marks later states as upcoming with the muted color", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
  });

  it("marks all steps completed when currentState is Done, including earlier steps", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // The Done step is both completed and current; tailwind-merge keeps the
    // last conflicting text-color utility, so "text-accent" (current) wins
    // over "text-state-done" (completed) for this specific label.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");
  });

  it("shows a timestamp for a state that appears as a 'to' target in events", () => {
    const events = [
      makeEvent({
        eventType: "PLAN_APPROVED",
        payloadJson: { to: "Implementing" },
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("uses the earliest event's timestamp when multiple events target the same state", () => {
    const events = [
      makeEvent({
        id: "e1",
        payloadJson: { to: "Implementing" },
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }),
      makeEvent({
        id: "e2",
        payloadJson: { to: "Implementing" },
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // First-seen (10m ago) wins because stateTimestamps.has() guards against overwrite
    expect(screen.getByText("10m ago")).toBeDefined();
    expect(screen.queryByText("2m ago")).toBeNull();
  });

  it("ignores events without a payload 'to' field", () => {
    const events = [makeEvent({ payloadJson: null })];
    const { container } = render(
      <WorkflowStepper currentState="Todo" events={events} />,
    );
    expect(container.textContent).not.toContain("ago");
  });

  describe("side states", () => {
    it("renders 'Revising Plan' for PlanRevision and maps effective progress to PlanReview", () => {
      render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
      expect(screen.getByText("Revising Plan")).toBeDefined();
      // PlanReview itself should not be marked "current" (PlanRevision isn't literally PlanReview)
      const planReviewLabel = screen.getByText("Plan Review");
      expect(planReviewLabel.className).not.toContain("text-accent");
    });

    it("renders 'Addressing Review' for AddressingReview with active pulse styling", () => {
      const { container } = render(
        <WorkflowStepper currentState="AddressingReview" events={[]} />,
      );
      expect(screen.getByText("Addressing Review")).toBeDefined();
      expect(container.querySelector(".bg-state-active")).not.toBeNull();
    });

    it("renders 'Blocked' for AIBlocked with blocked dot styling", () => {
      const { container } = render(
        <WorkflowStepper currentState="AIBlocked" events={[]} />,
      );
      expect(screen.getByText("Blocked")).toBeDefined();
      expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
    });

    it("renders 'Needs Clarification' for HumanClarificationNeeded", () => {
      render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
      expect(screen.getByText("Needs Clarification")).toBeDefined();
    });
  });
});
