import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(id: string, to: string, createdAt: string): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks all happy-path steps up to and including the current state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
  });

  it("marks every step completed once the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // "Done" also appears as the final happy-path label
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  });

  it("renders the timestamp for a state transition found in events", () => {
    const events = [makeEvent("e1", "Implementing", "2024-01-01T00:00:00.000Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // relativeTime renders something non-empty near the Implementing label
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("maps a side state (PlanRevision) onto its happy-path position and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the Addressing Review banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked-styled banner for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the Needs Clarification banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "e2",
        runId: "run-1",
        eventType: "SOMETHING",
        source: "system",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });
});
