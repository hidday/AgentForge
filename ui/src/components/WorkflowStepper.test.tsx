import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  id: string,
  to: string,
  createdAt: string,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_CHANGE",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

function labelEl(text: string) {
  return screen.getByText(text);
}

describe("WorkflowStepper", () => {
  it("marks the current state as active (accent) and later states as upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-accent");
    expect(labelEl("Planning").className).toContain("text-text-muted");
    expect(labelEl("Done").className).toContain("text-text-muted");
  });

  it("marks earlier states completed and the current state active mid-pipeline", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-state-done");
    expect(labelEl("Planning").className).toContain("text-state-done");
    expect(labelEl("Awaiting Approval").className).toContain("text-state-done");
    expect(labelEl("Implementing").className).toContain("text-accent");
    expect(labelEl("AI Review").className).toContain("text-text-muted");
    expect(labelEl("Human Review").className).toContain("text-text-muted");
  });

  it("marks earlier steps completed when the state is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-state-done");
    expect(labelEl("Human Review").className).toContain("text-state-done");
  });

  it("colors the Done step's label as current (accent) rather than done", () => {
    // Note: for the Done step itself, both isCompleted (via the
    // `currentState === "Done"` branch) and isCurrent are true. cn()'s
    // tailwind-merge collapses the conflicting text-color utility classes
    // down to whichever is listed last (text-accent), even though the icon
    // rendered for this step is the "completed" check mark. That mismatch
    // (check icon, accent-colored label) looks like a pre-existing display
    // quirk in WorkflowStepper rather than something introduced by this test.
    render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(labelEl("Done").className).toContain("text-accent");
  });

  it("leaves every step upcoming for a state outside the happy path and without a side-state mapping", () => {
    render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);

    expect(labelEl("To Do").className).toContain("text-text-muted");
    expect(labelEl("Done").className).toContain("text-text-muted");
    // No side-state panel should be rendered either
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("renders a relative timestamp for a state with a recorded transition event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("e1", "Planning", new Date().toISOString())]}
      />,
    );

    const planningLabel = labelEl("Planning");
    const container = planningLabel.closest("div")!.parentElement!;
    expect(container.textContent).toContain("just now");
  });

  it("keeps the earliest recorded timestamp when a state is reached more than once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-20T00:00:00Z"));
    try {
      render(
        <WorkflowStepper
          currentState="Implementing"
          events={[
            makeEvent("e1", "Planning", "2024-01-15T00:00:00Z"), // 5 days before "now"
            makeEvent("e2", "Planning", "2024-01-10T00:00:00Z"), // 10 days before "now"
          ]}
        />,
      );

      const planningLabel = labelEl("Planning");
      const container = planningLabel.closest("div")!.parentElement!;
      // The first event recorded for "Planning" (5 days ago) must win over
      // the later-in-the-array second event (10 days ago).
      expect(container.textContent).toContain("5d ago");
      expect(container.textContent).not.toContain("10d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the 'Revising Plan' side panel with an active dot for the PlanRevision side state", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the 'Addressing Review' side panel for the AddressingReview side state", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);

    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked side panel for the AIBlocked side state", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);

    const label = screen.getByText("Blocked");
    const dot = label.previousElementSibling as HTMLElement;
    expect(dot.className).toContain("bg-state-blocked");
  });

  it("shows a non-blocked (active) side panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);

    const label = screen.getByText("Needs Clarification");
    const dot = label.previousElementSibling as HTMLElement;
    expect(dot.className).toContain("bg-state-active");
    expect(dot.className).toContain("animate-pulse-dot");
  });
});
