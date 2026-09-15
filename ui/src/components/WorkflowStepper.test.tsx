import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";

vi.mock("lucide-react", () => {
  function makeIcon(name: string) {
    return function MockIcon({ className }: { className?: string }) {
      return <div data-testid={`icon-${name}`} className={className} />;
    };
  }
  return {
    Check: makeIcon("check"),
    Circle: makeIcon("circle"),
    Loader2: makeIcon("loader2"),
  };
});

import { WorkflowStepper } from "./WorkflowStepper.tsx";

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

function makeEvent(overrides: Partial<RunEventRecord> & { id: string }): RunEventRecord {
  return {
    id: overrides.id,
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "agent",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all 8 happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    for (const label of HAPPY_PATH_LABELS) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks steps before the current state as completed, the current step as current, and later steps as upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed: To Do, Planning, Plan Review, Awaiting Approval
    for (const label of ["To Do", "Planning", "Plan Review", "Awaiting Approval"]) {
      const row = screen.getByText(label).closest("div.min-w-0")?.parentElement;
      expect(row?.querySelector('[data-testid="icon-check"]')).not.toBeNull();
      expect(screen.getByText(label).className).toContain("text-state-done");
    }

    // Current: Implementing
    const currentRow = screen.getByText("Implementing").closest("div.min-w-0")?.parentElement;
    expect(currentRow?.querySelector('[data-testid="icon-loader2"]')).not.toBeNull();
    expect(screen.getByText("Implementing").className).toContain("text-accent");

    // Upcoming: AI Review, Human Review, Done
    for (const label of ["AI Review", "Human Review", "Done"]) {
      const row = screen.getByText(label).closest("div.min-w-0")?.parentElement;
      expect(row?.querySelector('[data-testid="icon-circle"]')).not.toBeNull();
      expect(screen.getByText(label).className).toContain("text-text-muted");
    }
  });

  it("marks every step as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    for (const label of HAPPY_PATH_LABELS) {
      const row = screen.getByText(label).closest("div.min-w-0")?.parentElement;
      expect(row?.querySelector('[data-testid="icon-check"]')).not.toBeNull();
    }
    expect(screen.queryByTestId("icon-circle")).toBeNull();
  });

  it.each([
    ["PlanRevision", "Revising Plan"],
    ["AddressingReview", "Addressing Review"],
    ["AIBlocked", "Blocked"],
    ["HumanClarificationNeeded", "Needs Clarification"],
  ])("renders the side-state banner with the correct label for %s", (state, expectedLabel) => {
    render(<WorkflowStepper currentState={state} events={[]} />);
    expect(screen.getByText(expectedLabel)).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
  });

  it("shows the blocked-red dot for a blocked side-state and the active-pulse dot for a non-blocked side-state", () => {
    const { container: blockedContainer } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    const blockedDot = blockedContainer.querySelector(".bg-state-blocked");
    expect(blockedDot).not.toBeNull();

    const { container: activeContainer } = render(
      <WorkflowStepper currentState="PlanRevision" events={[]} />,
    );
    const activeDot = activeContainer.querySelector(".bg-state-active.animate-pulse-dot");
    expect(activeDot).not.toBeNull();
  });

  it("marks the happy-path steps preceding a side-state's mapped step as completed", () => {
    // PlanRevision maps to "PlanReview" (index 2): Todo and Planning (indices 0,1) should be completed.
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    for (const label of ["To Do", "Planning"]) {
      const row = screen.getByText(label).closest("div.min-w-0")?.parentElement;
      expect(row?.querySelector('[data-testid="icon-check"]')).not.toBeNull();
    }
  });

  it("renders a per-step relative timestamp when events include a matching payloadJson.to", () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: "e1", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00.000Z" }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);

    const planningLabel = screen.getByText("Planning");
    const planningRow = planningLabel.closest("div.min-w-0");
    expect(planningRow?.textContent).toMatch(/ago$/);
  });

  it("does not render a timestamp for a step with no matching event", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const todoRow = screen.getByText("To Do").closest("div.min-w-0");
    expect(todoRow?.textContent).toBe("To Do");
  });
});
