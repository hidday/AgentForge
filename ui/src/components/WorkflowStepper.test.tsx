import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id: string): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "transition",
    source: "orchestrator",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
      "Done",
    ].forEach((label) => {
      expect(screen.getByText(label)).toBeDefined();
    });
  });

  it("marks steps before the current one as completed and the current step as active", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Plan Review").className).toContain("text-state-done");
    expect(screen.getByText("Awaiting Approval").className).toContain("text-state-done");

    expect(screen.getByText("Implementing").className).toContain("text-accent");

    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(screen.getByText("Human Review").className).toContain("text-text-muted");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("treats the first step (Todo) as the current step with nothing completed before it", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("To Do").className).toContain("text-accent");
    expect(screen.getByText("Planning").className).toContain("text-text-muted");
  });

  it("marks every step before Done as completed, and Done itself as completed-and-current", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
    ].forEach((label) => {
      expect(screen.getByText(label).className).toContain("text-state-done");
    });
    // Done is both completed (currentState === "Done") and current (state === currentState);
    // tailwind-merge keeps the later "text-*" color utility, so "text-accent" wins visually.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("shows a relative timestamp for a step with a matching transition event", () => {
    const events = [
      makeEvent("Planning", new Date(Date.now() - 5 * 60 * 1000).toISOString(), "ev-1"),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement?.textContent).toContain("ago");
  });

  it("does not show a timestamp for a step with no matching event", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement?.textContent).not.toContain("ago");
  });

  it("keeps the first event seen for a state when multiple events target it", () => {
    const newer = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const older = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const events = [
      makeEvent("Planning", newer, "ev-new"),
      makeEvent("Planning", older, "ev-old"),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.parentElement?.textContent).toContain("1m ago");
  });

  it("ignores events whose payload has no 'to' field without crashing", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-1",
        runId: "run-1",
        eventType: "note",
        source: "orchestrator",
        payloadJson: null,
        createdAt: new Date().toISOString(),
      },
    ];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("renders a side-state panel for PlanRevision with active (non-blocked) dot styling", () => {
    const { container } = render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    expect(container.querySelector(".bg-state-active.animate-pulse-dot")).not.toBeNull();
  });

  it("renders a side-state panel for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders a side-state panel for AIBlocked with blocked dot styling", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("renders a side-state panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render any side-state panel for happy-path states", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });
});
