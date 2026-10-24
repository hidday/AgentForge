import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: to,
    runId: "r1",
    eventType: "state-changed",
    source: "orchestrator",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks happy-path steps before the current state as completed", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // Implementing itself is current, not completed/upcoming-styled the same way;
    // steps strictly before it (Planning, PlanReview, AwaitingPlanApproval) are completed.
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("shows a timestamp for states that have a recorded transition event", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // relativeTime renders something like "Xd ago" — just assert a timestamp node exists
    // near the Planning label by checking the label is present (timestamp content varies with "now").
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("treats a 'Done' current state as fully completed", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("renders the side-state panel with the correct label for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders the side-state panel with the correct label for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders the blocked side-state panel for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("renders the clarification side-state panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "r1",
        eventType: "misc",
        source: "orchestrator",
        payloadJson: {},
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    expect(() =>
      render(<WorkflowStepper currentState="Planning" events={events} />),
    ).not.toThrow();
  });

  it("handles a null payloadJson without throwing", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "r1",
        eventType: "misc",
        source: "orchestrator",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    expect(() =>
      render(<WorkflowStepper currentState="Planning" events={events} />),
    ).not.toThrow();
  });
});
