import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const HAPPY_PATH_LABELS = [
  "To Do",
  "Planning",
  "Plan Review",
  "Awaiting Approval",
  "Implementing",
  "AI Review",
  "Human Review",
  "Done",
];

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    for (const label of HAPPY_PATH_LABELS) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks steps before the current state as completed and renders no side-state panel on the happy path", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Current step label styled with accent text
    const currentLabel = screen.getByText("Implementing");
    expect(currentLabel.className).toContain("text-accent");

    // Earlier step should be styled as completed (state-done)
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    // Later step should be styled as upcoming (muted)
    const reviewLabel = screen.getByText("Human Review");
    expect(reviewLabel.className).toContain("text-text-muted");

    // No side-state panel text rendered
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(container.querySelectorAll(".animate-spin").length).toBe(1);
  });

  it("treats the Done state as fully completed, showing a check icon for the final step", () => {
    const { container } = render(
      <WorkflowStepper currentState="Done" events={[]} />,
    );
    expect(screen.getByText("Done")).toBeDefined();
    // No spinner should remain since Done overrides completion for all steps,
    // and the final step's icon should be a check rather than a loader.
    expect(container.querySelectorAll(".animate-spin").length).toBe(0);
    expect(container.querySelectorAll("svg.text-state-done").length).toBeGreaterThan(0);
  });

  it("renders a relative timestamp for a step that has a matching event", () => {
    const events = [
      makeEvent({
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 5000).toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("ignores events without a 'to' field in payload", () => {
    const events = [makeEvent({ payloadJson: { foo: "bar" } })];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    // No timestamp elements should be rendered since no step timestamps matched
    expect(screen.queryByText("just now")).toBeNull();
    expect(screen.queryByText(/ago$/)).toBeNull();
  });

  it.each([
    ["PlanRevision", "Revising Plan"],
    ["AddressingReview", "Addressing Review"],
    ["AIBlocked", "Blocked"],
    ["HumanClarificationNeeded", "Needs Clarification"],
  ])("renders the side-state panel for %s with label %s", (state, label) => {
    render(<WorkflowStepper currentState={state} events={[]} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("uses the blocked dot color for AIBlocked and the active dot for a non-blocked side state", () => {
    const { container: blockedContainer } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(blockedContainer.querySelector(".bg-state-blocked")).not.toBeNull();

    const { container: activeContainer } = render(
      <WorkflowStepper currentState="PlanRevision" events={[]} />,
    );
    expect(activeContainer.querySelector(".bg-state-active")).not.toBeNull();
  });

  it("maps PlanRevision to the PlanReview step as the effective completed boundary", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    // Todo and Planning should be completed since effectiveIdx corresponds to PlanReview (idx 2)
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
  });
});
