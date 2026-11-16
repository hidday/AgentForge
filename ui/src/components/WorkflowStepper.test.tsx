import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> & { payloadJson?: unknown }): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "run:state-changed",
    source: "system",
    payloadJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as RunEventRecord;
}

describe("WorkflowStepper", () => {
  it("renders the heading and a label for every happy-path state", () => {
    const { container } = render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("Workflow")).toBeDefined();
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
    // No side-state info box for a happy-path state.
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("marks only the first step as current when state is Todo", () => {
    const { container } = render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(container.querySelectorAll("svg.animate-spin")).toHaveLength(1);
    expect(container.querySelectorAll("svg.text-state-done")).toHaveLength(0);
    expect(container.querySelectorAll("svg.text-text-muted")).toHaveLength(7);
  });

  it("marks every step as completed when the run is Done", () => {
    const { container } = render(<WorkflowStepper currentState="Done" events={[]} />);
    expect(container.querySelectorAll("svg.text-state-done")).toHaveLength(8);
    expect(container.querySelectorAll("svg.animate-spin")).toHaveLength(0);
    expect(container.querySelectorAll("svg.text-text-muted")).toHaveLength(0);
  });

  it("marks steps before Implementing as completed and the rest upcoming", () => {
    const { container } = render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // Todo, Planning, PlanReview, AwaitingPlanApproval precede Implementing.
    expect(container.querySelectorAll("svg.text-state-done")).toHaveLength(4);
    expect(container.querySelectorAll("svg.animate-spin")).toHaveLength(1);
    expect(container.querySelectorAll("svg.text-text-muted")).toHaveLength(3);
  });

  it("shows a relative timestamp for a state that has a recorded transition", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Implementing" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("keeps only the earliest timestamp when a state is reached more than once", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: new Date(Date.now() - 60_000).toISOString() }),
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("1m ago")).toBeDefined();
    expect(screen.queryByText("just now")).toBeNull();
  });

  it("ignores events without a 'to' field in their payload", () => {
    const events = [makeEvent({ payloadJson: { foo: "bar" } }), makeEvent({ payloadJson: null })];
    expect(() => render(<WorkflowStepper currentState="Todo" events={events} />)).not.toThrow();
  });

  it("renders the side-state panel with an active pulsing dot for PlanRevision", () => {
    const { container } = render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-state-active");
    // No step is highlighted as "current" for a side state.
    expect(container.querySelectorAll("svg.animate-spin")).toHaveLength(0);
  });

  it("renders the side-state panel with an active pulsing dot for AddressingReview", () => {
    const { container } = render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(container.querySelector(".animate-pulse-dot")).not.toBeNull();
  });

  it("renders the side-state panel with a solid blocked dot for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector("div.mt-2 .h-2.w-2");
    expect(dot?.className).toContain("bg-state-blocked");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    // AIBlocked isn't in HAPPY_PATH_STATES, so it maps to an unknown index and
    // every step falls back to "upcoming".
    expect(container.querySelectorAll("svg.text-text-muted")).toHaveLength(8);
  });

  it("renders the side-state panel with a pulsing dot for HumanClarificationNeeded despite its category being 'waiting'", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector("div.mt-2 .h-2.w-2");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });
});
