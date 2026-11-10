import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  id: string,
  to: string | undefined,
  createdAt: string,
  payloadJson: unknown = { to },
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "STATE_TRANSITION",
    source: "system",
    payloadJson,
    createdAt,
  };
}

const ALL_STEP_LABELS = [
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
    for (const label of ALL_STEP_LABELS) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks the current step with a spinner and earlier steps as completed", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Implementing label's text color should reflect "current" styling
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    // Earlier steps (Planning) should be styled as completed
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    // Later steps (AI Review) should be styled as upcoming
    const aiReviewLabel = screen.getByText("AI Review");
    expect(aiReviewLabel.className).toContain("text-text-muted");

    // Spinner icon present (lucide Loader2 renders an svg with animate-spin)
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("marks every step as completed (including the final step) when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Every step before the final one is purely "completed" styling.
    for (const label of ALL_STEP_LABELS.slice(0, -1)) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // The final "Done" step is both completed AND current; tailwind-merge
    // resolves the conflicting text-color utility to the later ("current") one.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
    // No side-state banner for Done
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("does not render a side-state banner for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });

  it("renders the 'Revising Plan' side-state banner for PlanRevision, mapped to the PlanReview step", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Earlier step (Planning) is completed since PlanRevision maps to the PlanReview index
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    // Plan Review itself is neither completed nor "current" (PlanRevision !== PlanReview)
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("renders the 'Addressing Review' side-state banner for AddressingReview, mapped to the AIReview step", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
  });

  it("renders the 'Blocked' side-state banner with a non-pulsing dot for AIBlocked (blocked category)", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const banner = screen.getByText("Blocked").closest("div")!.parentElement!;
    const dot = banner.querySelector(".h-2.w-2");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-state-blocked");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("renders the 'Needs Clarification' side-state banner with a pulsing dot for HumanClarificationNeeded (non-blocked category)", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    const banner = screen.getByText("Needs Clarification").closest("div")!.parentElement!;
    const dot = banner.querySelector(".h-2.w-2");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-state-active");
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("shows a relative timestamp next to a step once a matching state-transition event is found", () => {
    const events: RunEventRecord[] = [
      makeEvent("e1", "Planning", new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("keeps the earliest timestamp when multiple events transition to the same state", () => {
    const older = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const newer = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5m ago
    const events: RunEventRecord[] = [
      makeEvent("e1", "Planning", older),
      makeEvent("e2", "Planning", newer),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("1h ago")).toBeDefined();
    expect(screen.queryByText("5m ago")).toBeNull();
  });

  it("does not crash and shows no timestamps when events have a null payload", () => {
    const events: RunEventRecord[] = [makeEvent("e1", undefined, new Date().toISOString(), null)];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      makeEvent("e1", undefined, new Date().toISOString(), { note: "irrelevant" }),
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});
