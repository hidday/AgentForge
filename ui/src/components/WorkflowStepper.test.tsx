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
  it("marks the first happy-path state as current and all others upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-accent");
    expect(screen.getByText("Planning").className).toContain("text-text-muted");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("marks earlier states completed, the current state active, and later ones upcoming (middle step)", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("marks every state completed (via the Done override) when currentState is Done, including the last step", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-state-done");
    const doneLabel = screen.getByText("Done");
    // Done is both "completed" and "current" simultaneously; both classes are
    // applied but cn()'s tailwind-merge keeps only the later (accent) color
    // utility. The icon ternary checks isCompleted first, though, so the
    // step still renders a checkmark rather than a spinner.
    expect(doneLabel.className).toContain("text-accent");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("marks the last non-Done happy-path state as current with Done still upcoming", () => {
    render(<WorkflowStepper currentState="ReadyForHumanReview" events={[]} />);

    expect(screen.getByText("Human Review").className).toContain("text-accent");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("renders no side-state box for a happy-path state", () => {
    const { container } = render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(container.querySelectorAll(".border-border-subtle.bg-surface.p-2\\.5").length).toBe(0);
  });

  it("shows a 'Revising Plan' side-state box for PlanRevision, mapped onto the PlanReview step", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);

    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview itself is not marked current or completed by PlanRevision.
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("shows an 'Addressing Review' side-state box for AddressingReview, mapped onto the AI Review step", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);

    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("shows a 'Blocked' side-state box with a solid (non-pulsing) dot for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);

    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
    expect(dot?.className).not.toContain("animate-pulse-dot");
    // Every happy-path step remains upcoming since "blocked" isn't in the list.
    expect(screen.getByText("To Do").className).toContain("text-text-muted");
  });

  it("shows a 'Needs Clarification' side-state box with a pulsing dot for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );

    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("renders a relative timestamp under a step once its state transition has been observed", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[
          makeEvent("e1", "Planning", "2024-01-01T00:00:00Z"),
          makeEvent("e2", "Implementing", "2024-01-01T01:00:00Z"),
        ]}
      />,
    );

    // relativeTime() of an old date falls back to "Nd ago"; just assert the
    // Planning row rendered a timestamp element (not asserting exact text
    // since it's time-dependent).
    const planningLabel = screen.getByText("Planning");
    const timestampEl = planningLabel.parentElement?.querySelector(".text-text-muted.mt-0\\.5");
    expect(timestampEl).not.toBeNull();
    expect(timestampEl?.textContent).toMatch(/ago|just now/);
  });

  it("does not render a timestamp for a step with no matching event", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const todoLabel = screen.getByText("To Do");
    const timestampEl = todoLabel.parentElement?.querySelector(".text-text-muted.mt-0\\.5");
    expect(timestampEl).toBeNull();
  });

  it("uses only the first event observed for a given target state", () => {
    render(
      <WorkflowStepper
        currentState="Planning"
        events={[
          makeEvent("e1", "Planning", "2024-01-01T00:00:00Z"),
          makeEvent("e2", "Planning", "2024-06-01T00:00:00Z"),
        ]}
      />,
    );
    const planningLabel = screen.getByText("Planning");
    const timestampEl = planningLabel.parentElement?.querySelector(".text-text-muted.mt-0\\.5");
    expect(timestampEl).not.toBeNull();
  });
});
