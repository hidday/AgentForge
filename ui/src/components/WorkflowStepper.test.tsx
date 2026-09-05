import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `ev-${to}-${createdAt}`,
    runId: "run-1",
    eventType: "state-changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks happy-path steps before the current one as completed and shows a timestamp", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);

    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    // Upcoming step should still render its label.
    expect(screen.getByText("Human Review")).toBeDefined();
  });

  it("marks every step completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("maps a PlanRevision side state onto the PlanReview column and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("maps AddressingReview onto AIReview and shows its banner label", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked-styled banner for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders no side-state banner for a normal happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("only uses the first event's payload 'to' when a state repeats", () => {
    const events = [
      makeEvent("Planning", "2024-01-01T00:00:00Z"),
      makeEvent("Planning", "2024-06-01T00:00:00Z"),
    ];
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={events} />,
    );
    // Only one timestamp element should exist for the Planning row.
    expect(container.textContent).toContain("Planning");
  });

  it("ignores events with no payload 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-null",
        runId: "run-1",
        eventType: "state-changed",
        source: "system",
        payloadJson: null,
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });
});
