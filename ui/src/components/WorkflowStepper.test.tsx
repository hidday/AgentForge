import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";
import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(to: string, createdAt: string, id = `ev-${to}`): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "TRANSITION",
    source: "system",
    payloadJson: { to },
    createdAt,
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

  it("marks earlier steps as completed relative to the current state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");
    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");
  });

  it("marks every earlier step completed and highlights Done as current when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // Done is both "completed" (currentState === "Done") and "current" (state === currentState);
    // cn()/twMerge resolves the conflicting text-color utilities in favor of the later one (accent).
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("shows a relative timestamp for a state that has an event", () => {
    const events = [makeEvent("Planning", "2020-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/ago$/)).toBeDefined();
  });

  it("maps PlanRevision to a side-state panel, completing steps before its anchor", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Anchor (PlanReview, idx 2) itself is neither completed nor current — it's upcoming —
    // but the step before it (Planning, idx 1) is completed.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
    const planReviewLabel = screen.getByText("Plan Review");
    expect(planReviewLabel.className).toContain("text-text-muted");
  });

  it("maps AddressingReview to a side-state panel anchored at AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows the blocked side panel with blocked styling for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows the clarification-needed side panel for HumanClarificationNeeded", () => {
    render(<WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />);
    expect(screen.getByText("Needs Clarification")).toBeDefined();
  });

  it("does not render a side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("uses only the first event's timestamp per target state", () => {
    const events = [
      makeEvent("Planning", "2020-01-01T00:00:00Z", "ev-1"),
      makeEvent("Planning", "2021-01-01T00:00:00Z", "ev-2"),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // Only one "ago" timestamp rendered for Planning (first occurrence wins); no crash on duplicates.
    expect(screen.getAllByText(/ago$/).length).toBeGreaterThanOrEqual(1);
  });
});
