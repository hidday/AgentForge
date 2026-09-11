import { describe, it, expect } from "vitest";
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
    eventType: "STATE_CHANGED",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks the first happy-path step as current and the rest as upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    const label = screen.getByText("To Do");
    expect(label.className).toContain("text-accent");

    const upcoming = screen.getByText("Planning");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("marks earlier steps completed and the current step as in-progress for a middle state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");

    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");

    const upcoming = screen.getByText("AI Review");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("marks every step completed (including the last, whose current+completed classes merge to accent) when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    // All happy-path labels before the last are styled as completed.
    for (const label of [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
    ]) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // The final "Done" row is both completed AND current; cn/twMerge
    // resolves the conflicting text-color utilities in favor of the
    // later "isCurrent" class (text-accent).
    const doneLabel = screen.getByText("Done").className;
    expect(doneLabel).toContain("text-accent");
    expect(doneLabel).not.toContain("text-state-done");
  });

  it("renders a side-state panel for PlanRevision, marking steps before the mapped state as reached", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Steps strictly before the mapped state (PlanReview) are completed.
    expect(screen.getByText("Planning").className).toContain(
      "text-state-done",
    );
    // The mapped state itself is neither completed nor current for a side
    // state, so it reads as upcoming.
    expect(screen.getByText("Plan Review").className).toContain(
      "text-text-muted",
    );
    expect(screen.getByText("Implementing").className).toContain(
      "text-text-muted",
    );
  });

  it("renders a side-state panel for AddressingReview mapped to AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    // Steps before the mapped AIReview state are completed...
    expect(screen.getByText("Implementing").className).toContain(
      "text-state-done",
    );
    // ...while AIReview itself is not marked completed or current.
    expect(screen.getByText("AI Review").className).toContain(
      "text-text-muted",
    );
  });

  it("renders the blocked side-state panel for AIBlocked with no steps marked completed", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );

    expect(screen.getByText("Blocked")).toBeDefined();
    // AIBlocked isn't in the happy path, so nothing is completed.
    expect(screen.getByText("To Do").className).toContain("text-text-muted");

    // The blocked indicator dot uses the blocked color, not the pulsing
    // active color.
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the clarification side-state panel for HumanClarificationNeeded with a pulsing dot", () => {
    const { container } = render(
      <WorkflowStepper
        currentState="HumanClarificationNeeded"
        events={[]}
      />,
    );

    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("falls back to no current/completed step and no side panel for an unrecognized state", () => {
    render(<WorkflowStepper currentState="TotallyUnknownState" events={[]} />);

    // No side-state panel text should appear.
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();

    // Nothing is marked as completed or current.
    expect(screen.getByText("Done").className).toContain("text-text-muted");
    expect(screen.getByText("To Do").className).toContain("text-text-muted");
  });

  it("shows a relative timestamp for a happy-path state derived from events", () => {
    const recentEvent = makeEvent("e1", "Planning", new Date().toISOString());
    render(
      <WorkflowStepper currentState="Implementing" events={[recentEvent]} />,
    );

    const planningRow = screen.getByText("Planning").closest("div")
      ?.parentElement;
    expect(planningRow?.textContent).toContain("just now");
  });

  it("uses only the first observed timestamp per target state", () => {
    const events: RunEventRecord[] = [
      makeEvent("e1", "Planning", new Date(Date.now() - 3600_000).toISOString()),
      makeEvent("e2", "Planning", new Date().toISOString()),
    ];
    render(
      <WorkflowStepper currentState="Implementing" events={events} />,
    );

    const planningRow = screen.getByText("Planning").closest("div")
      ?.parentElement;
    // The first event (1h ago) should win, not the later "just now" one.
    expect(planningRow?.textContent).toContain("h ago");
  });
});
