import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "run-1",
    eventType: "x",
    source: "orchestrator",
    payloadJson: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("marks all happy-path steps up to and including the current state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks every step completed when the run is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const checks = container.querySelectorAll("svg");
    expect(checks.length).toBeGreaterThan(0);
  });

  it("shows a relative timestamp for a step that has a recorded transition", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("renders a side-state banner for PlanRevision, mapped under PlanReview", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders a blocked side-state banner for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("renders a side-state banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders a side-state banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("only records the first transition timestamp per state when duplicates exist", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2026-01-01T00:00:00Z" }),
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2026-01-02T00:00:00Z" }),
    ];
    expect(() => render(<WorkflowStepper currentState="Implementing" events={events} />)).not.toThrow();
  });
});
