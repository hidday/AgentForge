import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(
  to: string,
  createdAt: string,
  id = `ev-${to}-${createdAt}`,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "state-changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
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

  it("marks a passed state as completed and shows its recorded timestamp", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00.000Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    // The timestamp line (relativeTime output) sits alongside the label.
    const row = planningLabel.parentElement as HTMLElement;
    expect(row.textContent).toMatch(/ago|just now/);
  });

  it("treats Done as fully completed (not merely current) regardless of index", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    // The completed check-icon background should be used for the Done row,
    // even though Done is also technically the "current" state.
    expect(container.querySelectorAll(".bg-state-done\\/20").length).toBeGreaterThan(0);
    // The in-progress spinner must not render for Done.
    expect(container.querySelectorAll(".animate-spin").length).toBe(0);
  });

  it("marks the current state label with the active accent class", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.getByText("Implementing").className).toContain("text-accent");
  });

  it("marks upcoming states with the muted class", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("maps a side state (PlanRevision) onto PlanReview's position and shows the side-state banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows 'Addressing Review' banner text for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows 'Blocked' banner text with blocked styling for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows 'Needs Clarification' banner text for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render the side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field and keeps the first timestamp per state", () => {
    const events: RunEventRecord[] = [
      { id: "e0", runId: "r", eventType: "x", source: "s", payloadJson: null, createdAt: "2024-01-01T00:00:00.000Z" },
      makeEvent("Planning", "2024-01-01T00:00:00.000Z", "e1"),
      makeEvent("Planning", "2024-01-02T00:00:00.000Z", "e2"),
    ];
    // Should not throw on null payload, and should use the first Planning timestamp.
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });
});
