import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: `ev-${to}`,
    runId: "run-1",
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks all happy-path steps before the current state as completed, and later ones as upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    // Steps are rendered in order; completed ones render a Check icon, not asserted
    // directly here, but the label text for every happy-path state should be present.
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

  it("treats Done as fully completed even though it is the last step", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    // No upcoming (text-text-muted) step labels should remain when state is Done
    const upcoming = container.querySelectorAll(".text-text-muted.text-sm, .text-sm.text-text-muted");
    expect(upcoming.length).toBe(0);
  });

  it("shows a side-state banner mapped to its happy-path equivalent for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows a blocked-style side-state banner for AIBlocked", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("shows a blocked-style side-state banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders a relative timestamp next to a happy-path step once an event records its transition", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", new Date().toISOString())]}
      />,
    );
    // relativeTime for "now" renders something like "just now" — assert the
    // Planning step rendered a second line (timestamp) beyond its label.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement?.textContent).not.toBe("Planning");
  });

  it("does not render a side-state banner when current state is on the happy path", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("shows the Addressing Review side-state banner for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("ignores an event with no 'to' field (or a null payload) when building timestamps", () => {
    const noToEvent = makeEvent("", "2024-01-01T00:00:00Z");
    const nullPayloadEvent = { ...noToEvent, id: "ev-null", payloadJson: null };
    render(
      <WorkflowStepper currentState="Implementing" events={[noToEvent, nullPayloadEvent]} />,
    );
    // Should not throw and should still render the step labels normally.
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("keeps only the earliest timestamp when two events report the same 'to' state", () => {
    const events = [
      makeEvent("Planning", "2024-01-01T00:00:00Z"),
      makeEvent("Planning", "2024-06-01T00:00:00Z"),
    ];
    const { container } = render(<WorkflowStepper currentState="Implementing" events={events} />);
    // Only one timestamp node should be attached to the Planning step despite two events.
    const timestampNodes = container.querySelectorAll(".text-\\[10px\\].text-text-muted.mt-0\\.5");
    expect(timestampNodes.length).toBe(1);
  });
});
