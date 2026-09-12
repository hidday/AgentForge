import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("marks earlier happy-path steps completed and the matching step current", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const completedLabel = screen.getByText("Planning");
    expect(completedLabel.className).toContain("text-state-done");

    const currentLabel = screen.getByText("Implementing");
    expect(currentLabel.className).toContain("text-accent");

    const upcomingLabel = screen.getByText("AI Review");
    expect(upcomingLabel.className).toContain("text-text-muted");
  });

  it("shows a check icon for completed steps and a spinner for the current step", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    expect(container.querySelector("svg.lucide-check")).not.toBeNull();
    expect(container.querySelector("svg.lucide-loader-circle")).not.toBeNull();
    expect(container.querySelector("svg.lucide-circle")).not.toBeNull();
  });

  it("marks every step completed once the run reaches Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
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
    // The Done step is both completed and "current" (currentState === "Done"),
    // so it wins the accent styling reserved for the current step.
    expect(screen.getByText("Done").className).toContain("text-accent");
    // Every step shows the check icon (all completed) plus none show the
    // circular "upcoming" marker.
    expect(container.querySelectorAll("svg.lucide-check").length).toBe(8);
    expect(container.querySelector("svg.lucide-circle")).toBeNull();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("shows a Revising Plan side panel with the active pulsing dot for PlanRevision", () => {
    const { container } = render(
      <WorkflowStepper currentState="PlanRevision" events={[]} />,
    );
    expect(screen.getByText("Revising Plan")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-state-active");
  });

  it("shows an Addressing Review side panel for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a Blocked side panel with a solid (non-pulsing) blocked dot for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("leaves all happy-path steps upcoming when blocked (no matching index)", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("To Do").className).toContain("text-text-muted");
    expect(screen.getByText("Done").className).toContain("text-text-muted");
  });

  it("shows a Needs Clarification side panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("shows a relative timestamp next to a step whose transition event is recorded", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[
          makeEvent({
            eventType: "EXECUTION_STARTED",
            payloadJson: { to: "Implementing" },
            createdAt: new Date(Date.now() - 5000).toISOString(),
          }),
        ]}
      />,
    );
    const currentLabel = screen.getByText("Implementing");
    const row = currentLabel.closest("div")?.parentElement;
    expect(row?.textContent).toContain("just now");
  });

  it("does not show a timestamp for a step with no recorded transition event", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const label = screen.getByText("To Do");
    const row = label.closest("div")?.parentElement;
    expect(row?.textContent).toBe("To Do");
  });
});
