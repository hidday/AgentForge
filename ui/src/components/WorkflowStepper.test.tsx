import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "system",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
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

  it("marks states before the current one as completed (check icon, done styling)", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("marks the current state distinctly from completed/upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");
  });

  it("marks states after the current one as upcoming (muted styling)", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
  });

  it("treats Done currentState as fully completed, including the Done step itself", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const doneLabel = screen.getByText("Done");
    // Done is both "current" and treated as completed per isCompleted = effectiveIdx > idx || currentState === "Done"
    expect(doneLabel.className).toContain("text-accent");
  });

  it("renders a relative timestamp for a state that has a matching event payload.to", () => {
    const events: RunEventRecord[] = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/ago|just now/i)).toBeDefined();
  });

  it("keeps the first timestamp seen for a state when multiple events target it", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", payloadJson: { to: "Planning" }, createdAt: "2024-02-01T00:00:00Z" }),
    ];
    // Should not throw and should render exactly one timestamp node for Planning's row.
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getAllByText(/ago|just now/i).length).toBe(1);
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [makeEvent({ payloadJson: { from: "Todo" } })];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.queryByText(/ago|just now/i)).toBeNull();
  });

  it("ignores events with null payloadJson", () => {
    const events: RunEventRecord[] = [makeEvent({ payloadJson: null })];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.queryByText(/ago|just now/i)).toBeNull();
  });

  it("renders a side-state panel for PlanRevision mapped onto PlanReview", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders a side-state panel for AddressingReview mapped onto AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders a side-state panel for AIBlocked with blocked dot styling", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = document.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders a side-state panel for HumanClarificationNeeded with non-blocked dot styling", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = document.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("handles an unrecognized currentState gracefully (no side panel, no completed states)", () => {
    render(<WorkflowStepper currentState="TotallyUnknownState" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    // effectiveIdx is -1, so nothing before idx 0 counts as completed, but with -1 > idx is false for all idx>=0
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-text-muted");
  });
});
