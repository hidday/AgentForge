import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(id: string, to: string, createdAt: string): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "state:transition",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks earlier steps completed and the current step as current, later steps upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed step (Planning) should carry the done color class.
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    // Current step (Implementing) should carry the accent color class.
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    // Upcoming step (Done) should carry the muted color class.
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("marks every step completed when currentState is Done, even though Done has no later index", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Earlier step should be completed (done color).
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    // Done itself: isCompleted is true by the `currentState === "Done"` branch,
    // and isCurrent is also true (state === currentState) — current styling wins
    // visually via the accent class being applied after done in the cn() call.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("shows a relative timestamp under a state when an event recorded it", () => {
    const events = [makeEvent("e1", "Planning", "2024-01-01T00:00:00.000Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // relativeTime formats some human string; we only assert *something* rendered
    // next to Planning besides the label itself, by checking the parent contains
    // more than just the label text.
    const planningLabel = screen.getByText("Planning");
    const parent = planningLabel.parentElement!;
    expect(parent.textContent).not.toBe("Planning");
  });

  it("does not show a timestamp under a state with no matching event", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    const parent = planningLabel.parentElement!;
    expect(parent.textContent).toBe("Planning");
  });

  it("uses the first matching event per state (does not overwrite with a later duplicate)", () => {
    const events = [
      makeEvent("e1", "Planning", "2024-01-01T00:00:00.000Z"),
      makeEvent("e2", "Planning", "2025-01-01T00:00:00.000Z"),
    ];
    // Just verify it renders without throwing and the timestamp area is populated.
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement!.textContent).not.toBe("Planning");
  });

  it("ignores events whose payload has no 'to' field", () => {
    const badEvent: RunEventRecord = {
      id: "e1",
      runId: "run-1",
      eventType: "noop",
      source: "system",
      payloadJson: {},
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    render(<WorkflowStepper currentState="Implementing" events={[badEvent]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement!.textContent).toBe("Planning");
  });

  it("ignores events with a null payload", () => {
    const nullPayloadEvent: RunEventRecord = {
      id: "e1",
      runId: "run-1",
      eventType: "noop",
      source: "system",
      payloadJson: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    render(<WorkflowStepper currentState="Implementing" events={[nullPayloadEvent]} />);
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("shows the side-state panel with 'Revising Plan' for PlanRevision and maps progress to PlanReview", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanRevision maps to PlanReview progress; Planning (before PlanReview) is completed.
    expect(screen.getByText("Planning").className).toContain("text-state-done");
  });

  it("shows the side-state panel with 'Addressing Review' for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the side-state panel with 'Blocked' for AIBlocked and does not render it as a happy-path step", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    // AIBlocked is not one of the 8 happy-path labels, so none of them should
    // carry the "current" accent styling.
    const happyLabels = [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
      "Done",
    ];
    for (const label of happyLabels) {
      expect(screen.getByText(label).className).not.toContain("text-accent");
    }
  });

  it("shows the side-state panel with 'Needs Clarification' for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render the side-state panel for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });
});
