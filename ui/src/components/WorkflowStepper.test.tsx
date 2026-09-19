import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(to: string, createdAt: string, id = to): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "run:state-changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks earlier happy-path steps completed and the current step as in-progress", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed step label
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    // Current step label
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    // Upcoming step label
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");
  });

  it("marks every step completed when currentState is Done, even ones after its own index", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-state-done");
  });

  it("renders a relative timestamp for a step that has a matching event", () => {
    const events = [makeEvent("Planning", new Date(Date.now() - 5 * 60_000).toISOString())];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/5m ago/)).toBeDefined();
  });

  it("only keeps the first timestamp seen for a given state", () => {
    const events = [
      makeEvent("Planning", new Date(Date.now() - 5 * 60_000).toISOString(), "e1"),
      makeEvent("Planning", new Date(Date.now() - 50 * 60_000).toISOString(), "e2"),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/5m ago/)).toBeDefined();
    expect(screen.queryByText(/50m ago/)).toBeNull();
  });

  it("ignores events with a null payload or missing 'to' field", () => {
    const events: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "x", source: "s", payloadJson: null, createdAt: new Date().toISOString() },
      { id: "e2", runId: "run-1", eventType: "x", source: "s", payloadJson: {}, createdAt: new Date().toISOString() },
    ];
    // Should not throw, and no timestamp is rendered for Planning.
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("Planning")).toBeDefined();
  });

  it("renders a side-state banner for PlanRevision mapped onto the PlanReview step", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview itself should render as the "current" step visually (spinner icon),
    // and the earlier Planning step should be completed.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("renders a side-state banner for AddressingReview mapped onto AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("renders a blocked-styled side-state banner for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders a waiting-styled side-state banner for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("treats an unrecognized state as fully upcoming (index -1, not completed, not current)", () => {
    render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-text-muted");
  });
});
