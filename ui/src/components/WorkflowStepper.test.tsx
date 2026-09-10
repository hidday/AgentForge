import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "e1",
    runId: "r1",
    eventType: "run:state-changed",
    source: "system",
    payloadJson: { to: "Planning" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
  });

  it("marks earlier states as completed and shows their timestamp", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent({ payloadJson: { to: "Planning" } })]}
      />,
    );
    // "Planning" precedes "Implementing" on the happy path, so its timestamp renders.
    expect(screen.getByText("Planning").parentElement?.textContent).toContain("ago");
  });

  it("renders a checkmark icon for the Done step when the run is complete", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(container.querySelector(".bg-state-done\\/20")).not.toBeNull();
  });

  it("renders a side-state banner for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders a side-state banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders a blocked side-state banner for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders a side-state banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    render(
      <WorkflowStepper
        currentState="Planning"
        events={[makeEvent({ payloadJson: null }), makeEvent({ payloadJson: {} })]}
      />,
    );
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("keeps only the earliest timestamp per state", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[
          makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2026-01-01T00:00:00.000Z" }),
          makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2026-01-02T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getByText("Planning").parentElement?.textContent).toContain("ago");
  });
});
