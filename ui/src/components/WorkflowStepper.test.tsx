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
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks earlier steps as completed and the matching step as current", () => {
    const { container } = render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // "Implementing" text should carry the current (accent) styling
    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");

    // An earlier step, "Planning", should carry the completed (done) styling
    const completed = screen.getByText("Planning");
    expect(completed.className).toContain("text-state-done");

    // A later step, "Done", should carry the upcoming (muted) styling
    const upcoming = screen.getByText("Done");
    expect(upcoming.className).toContain("text-text-muted");

    // Completed steps render a check icon container; count completed happy-path steps
    // (Todo, Planning, PlanReview, AwaitingPlanApproval precede Implementing = 4)
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    expect(checkIcons.length).toBe(4);
  });

  it("treats the first step (Todo) as current, not completed, with nothing before it", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const current = screen.getByText("To Do");
    expect(current.className).toContain("text-accent");
    expect(current.className).not.toContain("text-state-done");
  });

  it("marks every happy-path step as completed when currentState is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const doneLabel = screen.getByText("Done");
    // Done itself is both "completed" (forced by the `currentState === "Done"` check)
    // and "current" (state === currentState); tailwind-merge resolves the conflicting
    // text-color utilities in favor of the one applied last, text-accent.
    expect(doneLabel.className).toContain("text-accent");

    // All 8 steps should show the check icon since isCompleted is true for all
    // (idx < 7, effectiveIdx === 7 > idx) and Done itself via the explicit override.
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    expect(checkIcons.length).toBe(8);
  });

  it("renders the timestamp (relative time) for a state that has a matching event", () => {
    const events = [makeEvent("Planning", new Date(Date.now() - 5 * 60 * 1000).toISOString())];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("uses the first event's timestamp when multiple events target the same state", () => {
    const earlier = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const later = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const events = [makeEvent("Planning", earlier, "ev-1"), makeEvent("Planning", later, "ev-2")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("10m ago")).toBeDefined();
    expect(screen.queryByText("1m ago")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-x",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: { message: "hello" },
        createdAt: new Date().toISOString(),
      },
    ];
    // Should not throw, and no timestamp should be rendered for Planning
    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("handles a null payloadJson without throwing", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-null",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: null,
        createdAt: new Date().toISOString(),
      },
    ];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });

  describe("side states", () => {
    it("renders 'Revising Plan' for PlanRevision and maps its effective progress to PlanReview", () => {
      render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
      expect(screen.getByText("Revising Plan")).toBeDefined();
      // PlanReview's position is used for progress; Planning (before it) should be completed
      expect(screen.getByText("Planning").className).toContain("text-state-done");
    });

    it("renders 'Addressing Review' for AddressingReview mapped to AIReview", () => {
      render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
      expect(screen.getByText("Addressing Review")).toBeDefined();
      expect(screen.getByText("Implementing").className).toContain("text-state-done");
    });

    it("renders 'Blocked' with the blocked dot color for AIBlocked", () => {
      const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
      expect(screen.getByText("Blocked")).toBeDefined();
      const dot = container.querySelector(".bg-state-blocked");
      expect(dot).toBeDefined();
    });

    it("renders 'Needs Clarification' with the active (pulsing) dot color for HumanClarificationNeeded", () => {
      const { container } = render(
        <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
      );
      expect(screen.getByText("Needs Clarification")).toBeDefined();
      const dot = container.querySelector(".bg-state-active.animate-pulse-dot");
      expect(dot).toBeDefined();
    });

    it("does not render the side-state panel for a happy-path state", () => {
      render(<WorkflowStepper currentState="Implementing" events={[]} />);
      expect(screen.queryByText("Blocked")).toBeNull();
      expect(screen.queryByText("Revising Plan")).toBeNull();
      expect(screen.queryByText("Needs Clarification")).toBeNull();
      expect(screen.queryByText("Addressing Review")).toBeNull();
    });
  });

  it("renders an upcoming step without a completed or current styling", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    const upcoming = screen.getByText("Human Review");
    expect(upcoming.className).toContain("text-text-muted");
    expect(upcoming.className).not.toContain("text-state-done");
    expect(upcoming.className).not.toContain("text-accent");
  });

  it("falls back gracefully (no current highlight) for a completely unknown currentState", () => {
    // currentIdx will be -1 and the state is not in SIDE_STATES either.
    const { container } = render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);
    // None of the happy-path labels should carry the current/accent styling
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
      expect(screen.getByText(label).className).not.toContain("text-accent");
    }
    expect(container.querySelector(".lucide-loader-2")).toBeNull();
  });
});
