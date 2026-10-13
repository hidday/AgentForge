import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = `ev-${to}`): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "state-changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks earlier steps as completed and the current step distinctly when mid-flow", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Completed steps show a check icon; current step shows a spinner icon.
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    const spinnerIcons = container.querySelectorAll("svg.animate-spin");
    expect(checkIcons.length).toBeGreaterThan(0);
    expect(spinnerIcons.length).toBe(1);
  });

  it("marks every step as completed when currentState is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    const spinnerIcons = container.querySelectorAll("svg.animate-spin");
    expect(spinnerIcons.length).toBe(0);
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    // All 8 happy-path states should show a check when Done.
    expect(checkIcons.length).toBe(8);
  });

  it("shows no completed steps for the very first state", () => {
    const { container } = render(<WorkflowStepper currentState="Todo" events={[]} />);
    const checkIcons = container.querySelectorAll("svg.lucide-check");
    expect(checkIcons.length).toBe(0);
  });

  it("renders a relative timestamp under a state that has a recorded transition event", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", recent)]}
      />,
    );
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("maps the PlanRevision side state onto the PlanReview step and shows its own label", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // The happy-path "Plan Review" label is still rendered as a step.
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("maps the AddressingReview side state onto the AIReview step", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the blocked indicator and label for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows the needs-clarification label for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render the side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });

  it("only uses the earliest event for a given target state", () => {
    const earlier = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const later = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", earlier, "e1"), makeEvent("Planning", later, "e2")]}
      />,
    );
    expect(screen.getByText("20m ago")).toBeDefined();
    expect(screen.queryByText("1m ago")).toBeNull();
  });
});
