import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path state labels", () => {
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

  it("marks earlier states as completed and current state distinctly", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Completed steps show a Check icon; there should be some for the steps
    // before "Implementing" (Todo, Planning, PlanReview, AwaitingPlanApproval).
    const checkCircles = container.querySelectorAll(".bg-state-done\\/20");
    expect(checkCircles.length).toBe(4);
  });

  it("marks all steps completed when currentState is Done", () => {
    const { container } = render(
      <WorkflowStepper currentState="Done" events={[]} />,
    );
    const checkCircles = container.querySelectorAll(".bg-state-done\\/20");
    expect(checkCircles.length).toBe(8);
  });

  it("shows upcoming steps with muted styling", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const label = screen.getByText("Done");
    expect(label.className).toContain("text-text-muted");
  });

  it("renders a timestamp for a state that has a matching transition event", () => {
    const events = [
      makeEvent({
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 60000).toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("1m ago")).toBeDefined();
  });

  it("ignores events without a payload 'to' field", () => {
    const events = [makeEvent({ payloadJson: null })];
    const { container } = render(
      <WorkflowStepper currentState="Todo" events={events} />,
    );
    // No timestamp elements should render since no valid transitions exist.
    expect(container.querySelector(".text-\\[10px\\].text-text-muted.mt-0\\.5")).toBeNull();
  });

  it("keeps the first-seen timestamp when multiple events target the same state", () => {
    const events = [
      makeEvent({
        id: "e1",
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 5000).toISOString(),
      }),
      makeEvent({
        id: "e2",
        payloadJson: { to: "Planning" },
        createdAt: new Date(Date.now() - 500000).toISOString(),
      }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  describe("side states", () => {
    it("renders PlanRevision as a side state anchored at PlanReview", () => {
      render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
      expect(screen.getByText("Revising Plan")).toBeDefined();
    });

    it("renders AddressingReview as a side state anchored at AIReview", () => {
      render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
      expect(screen.getByText("Addressing Review")).toBeDefined();
    });

    it("renders AIBlocked as a blocked side state", () => {
      const { container } = render(
        <WorkflowStepper currentState="AIBlocked" events={[]} />,
      );
      expect(screen.getByText("Blocked")).toBeDefined();
      expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
    });

    it("renders HumanClarificationNeeded as a blocked side state", () => {
      render(
        <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
      );
      expect(screen.getByText("Needs Clarification")).toBeDefined();
    });

    it("does not render the side-state panel for a happy-path state", () => {
      const { container } = render(
        <WorkflowStepper currentState="Planning" events={[]} />,
      );
      expect(container.textContent).not.toContain("Revising Plan");
    });
  });
});
