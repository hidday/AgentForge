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
    eventType: "state:changed",
    source: "system",
    payloadJson: { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("marks steps before the current happy-path state as completed and later steps as upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    // Completed steps show a check icon and the state-done text color.
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");

    // Current step is highlighted with the accent color.
    const implementing = screen.getByText("Implementing");
    expect(implementing.className).toContain("text-accent");

    // Upcoming steps use the muted color.
    const humanReview = screen.getByText("Human Review");
    expect(humanReview.className).toContain("text-text-muted");
  });

  it("marks every step completed when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-state-done");
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");
    const implementing = screen.getByText("Implementing");
    expect(implementing.className).toContain("text-state-done");
  });

  it("renders a relative timestamp for states that have a matching event", () => {
    const events = [
      makeEvent("ev-1", "Planning", new Date(Date.now() - 5 * 60_000).toISOString()),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("uses only the first matching event per state (earliest wins)", () => {
    const events = [
      makeEvent("ev-1", "Planning", new Date(Date.now() - 5 * 60_000).toISOString()),
      makeEvent("ev-2", "Planning", new Date(Date.now() - 1 * 60_000).toISOString()),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();
    expect(screen.queryByText("1m ago")).toBeNull();
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events: RunEventRecord[] = [
      {
        id: "ev-1",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: { foo: "bar" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "ev-2",
        runId: "run-1",
        eventType: "note",
        source: "system",
        payloadJson: null,
        createdAt: new Date().toISOString(),
      },
    ];
    // Should not throw despite payloads lacking a `to` field.
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.getByText("To Do")).toBeDefined();
  });

  it("shows the side-state panel with 'Revising Plan' and treats PlanReview as completed for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // PlanReview should be marked completed (effectiveIdx points at PlanReview).
    const planReview = screen.getByText("Plan Review");
    expect(planReview.className).toContain("text-state-done");
  });

  it("shows the side-state panel with 'Addressing Review' for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked-styled side-state panel for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows the side-state panel with 'Needs Clarification' for HumanClarificationNeeded", () => {
    render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not show the side-state panel for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });

  it("renders all happy-path steps as upcoming for an unrecognized current state", () => {
    render(<WorkflowStepper currentState="SomeUnknownState" events={[]} />);
    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-text-muted");
    const implementing = screen.getByText("Implementing");
    expect(implementing.className).toContain("text-text-muted");
    // No step is "current" so none should carry the accent color.
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
