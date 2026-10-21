import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "PLAN_CREATED",
    source: "system",
    payloadJson: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("marks steps before the current state as completed and the current step as in-progress", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed steps render a checkmark via an accessible label-less icon; assert by
    // text color class applied to the label instead, which is the component's own
    // derived state (isCompleted / isCurrent / isUpcoming).
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
  });

  it("marks every step completed when currentState is Done, even steps after the nominal index", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // "Done" itself is both current and (per the `currentState === "Done"` branch) completed;
    // its label picks up isCurrent styling (checked first in the cn() call ordering doesn't
    // matter since both classes could apply - what matters is it's not "upcoming").
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).not.toContain("text-text-muted");

    // Earlier step
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("shows upcoming steps (after current) with the muted/upcoming style", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-text-muted");
  });

  it("renders a relative timestamp for a state the events array records a transition into", () => {
    const events = [
      makeEvent({
        payloadJson: { to: "Implementing" },
        createdAt: new Date().toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="AIReview" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("uses the first matching event for a given 'to' state and ignores later duplicates", () => {
    const events = [
      makeEvent({
        id: "ev-1",
        payloadJson: { to: "Implementing" },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
      makeEvent({
        id: "ev-2",
        payloadJson: { to: "Implementing" },
        createdAt: new Date().toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="AIReview" events={events} />);
    // First event (2h ago) wins because the Map.has() guard skips the later duplicate.
    expect(screen.getByText("2h ago")).toBeDefined();
    expect(screen.queryByText("just now")).toBeNull();
  });

  it("maps a PlanRevision side-state onto the PlanReview happy-path step and shows the 'Revising Plan' banner", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview step itself should be styled as "current" since effectiveIdx points at it,
    // but the actual currentState text "PlanRevision" doesn't match any happy-path label,
    // so no happy-path step gets the exact isCurrent match — instead it is >= completed.
    const planReviewLabel = screen.getByText("Plan Review");
    expect(planReviewLabel.className).not.toContain("text-text-muted");
  });

  it("shows the 'Addressing Review' banner for the AddressingReview side-state", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the 'Blocked' banner with the blocked (non-pulsing) dot for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("shows the 'Needs Clarification' banner for the HumanClarificationNeeded side-state", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
