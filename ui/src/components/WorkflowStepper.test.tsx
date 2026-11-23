import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
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
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("marks earlier states as completed and shows a timestamp when known", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "r1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    expect(screen.getByText("1m ago")).toBeDefined();
  });

  it("highlights the current state distinctly from completed/upcoming states", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");
    const upcoming = screen.getByText("AI Review");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("marks every step as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");
  });

  it("renders a side-state panel for PlanRevision mapped to the PlanReview step", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview step should read as completed/current since effectiveIdx maps there
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("renders a blocked side-state panel for AIBlocked with blocked styling", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders the HumanClarificationNeeded side-state label", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("renders the AddressingReview side-state label", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("does not render a side-state panel for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
