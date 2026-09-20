import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "state_transition",
    source: "system",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("at the start of the workflow, marks only the first step as current and the rest upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-accent");
    for (const label of HAPPY_PATH_LABELS.slice(1)) {
      expect(screen.getByText(label).className).toContain("text-text-muted");
    }
  });

  it("in the middle of the workflow, marks earlier steps completed, current step active, and later steps upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    for (const label of ["To Do", "Planning", "Plan Review", "Awaiting Approval"]) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    for (const label of ["AI Review", "Human Review", "Done"]) {
      expect(screen.getByText(label).className).toContain("text-text-muted");
    }
  });

  it("marks every step completed once the run reaches Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    // All steps before the final one are completed (not current).
    for (const label of HAPPY_PATH_LABELS.slice(0, -1)) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // The Done step itself is simultaneously completed and current; the
    // "current" (accent) styling wins after class merging, and no step is
    // left in the upcoming/muted state.
    expect(screen.getByText("Done").className).toContain("text-accent");
    for (const label of HAPPY_PATH_LABELS) {
      expect(screen.getByText(label).className).not.toContain("text-text-muted");
    }
  });

  it("shows a relative timestamp for a state with a recorded transition event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);

    expect(screen.getByText("just now")).toBeDefined();
  });

  it("does not show a timestamp for states without a recorded transition event", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("just now")).toBeNull();
  });

  it("renders a blocked side-state banner and leaves every happy-path step upcoming", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);

    expect(screen.getByText("Blocked")).toBeDefined();
    for (const label of HAPPY_PATH_LABELS) {
      expect(screen.getByText(label).className).toContain("text-text-muted");
    }
  });

  it("renders a clarification-needed side-state banner", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders a plan-revision side-state banner with prior steps marked completed", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
  });

  it("renders an addressing-review side-state banner", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);

    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });
});
