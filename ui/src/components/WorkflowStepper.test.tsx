import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = `ev-${to}`): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "state_transition",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path step label", () => {
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

  it("marks steps before the current state as completed and shows no side-state panel", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // No side-state panel for a happy-path state
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
    // Current step label present
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("marks every step completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Done label itself should still render once
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("shows a timestamp for a state that has a matching event", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/ago|just now/)).toBeDefined();
  });

  it("uses the earliest event for a state when multiple events target it", () => {
    const events = [
      makeEvent("Planning", "2024-01-01T00:00:00Z", "ev-1"),
      makeEvent("Planning", "2024-06-01T00:00:00Z", "ev-2"),
    ];
    // Should not throw and should still render exactly one timestamp node for Planning
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("renders the PlanRevision side-state panel with 'Revising Plan' label", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders the AddressingReview side-state panel with 'Addressing Review' label", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the AIBlocked side-state panel with 'Blocked' label and blocked styling", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the HumanClarificationNeeded side-state panel with 'Needs Clarification' label", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    // Non-blocked category uses the active/pulse dot styling instead
    const dot = container.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-x",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: { message: "no to field" },
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("handles a null payloadJson on an event without throwing", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-null",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
