import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string): RunEventRecord {
  return {
    id: to,
    runId: "r1",
    eventType: "x",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks states before the current one as completed, and does not render a side-state panel", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Implementing").className).toContain("text-accent");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("marks every step completed once the run reaches Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
  });

  it("maps a side state (PlanRevision) onto its happy-path anchor and shows the side-state panel", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("shows the 'Addressing Review' label for the AddressingReview side state", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the 'Needs Clarification' label for the HumanClarificationNeeded side state", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("shows the blocked-styled panel and label for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows a relative timestamp next to a step that has a matching event", () => {
    render(
      <WorkflowStepper
        currentState="Implementing"
        events={[makeEvent("Planning", new Date().toISOString())]}
      />,
    );
    expect(screen.getByText(/ago|just now/)).toBeDefined();
  });

  it("uses the first event's timestamp when multiple events target the same state", () => {
    const events = [
      makeEvent("Planning", "2024-01-01T00:00:00Z"),
      makeEvent("Planning", "2024-02-01T00:00:00Z"),
    ];
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={events} />,
    );
    expect(container.textContent).toContain("Planning");
  });
});
