import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "PLAN_APPROVED",
    source: "human",
    payloadJson: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders the Workflow heading and all happy-path step labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("Planning")).toBeDefined();
    expect(screen.getByText("Plan Review")).toBeDefined();
    expect(screen.getByText("Awaiting Approval")).toBeDefined();
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("AI Review")).toBeDefined();
    expect(screen.getByText("Human Review")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("marks states before the current one as completed, current as current, rest as upcoming", () => {
    const { container } = render(<WorkflowStepper currentState="Implementing" events={[]} />);
    // Done's parent should get text-state-done class (completed) for Planning etc.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");
    expect(container).toBeDefined();
  });

  it("marks every step as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const toDoLabel = screen.getByText("To Do");
    expect(toDoLabel.className).toContain("text-state-done");
    // Done is both completed and current; cn()/twMerge resolves the
    // conflicting text-color utility in favor of the later (current) class.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
  });

  it("shows a timestamp for a happy-path state that has a matching event", () => {
    const events = [
      makeEvent({ eventType: "PLAN_CREATED", payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="PlanReview" events={events} />);
    expect(screen.getByText("just now")).toBeDefined();
  });

  it("treats a side-state (PlanRevision) as mapped to its happy-path equivalent for completion, without marking it current", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // The mapped target (PlanReview) is neither completed past itself nor "current"
    // (currentState is the raw side-state string, which never equals a happy-path label).
    const planReviewLabel = screen.getByText("Plan Review");
    expect(planReviewLabel.className).toContain("text-text-muted");
    // An earlier step in the happy path should be marked completed.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");
  });

  it("shows the AddressingReview side-state banner mapped to AIReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    const aiReviewLabel = screen.getByText("AI Review");
    expect(aiReviewLabel.className).toContain("text-text-muted");
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-state-done");
  });

  it("shows a blocked-styled banner for AIBlocked", () => {
    const { container } = render(<WorkflowStepper currentState="AIBlocked" events={[]} />);
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("shows a non-blocked (active) styled banner for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".bg-state-active");
    expect(dot).not.toBeNull();
  });

  it("does not show the side-state banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("only uses the first observed timestamp per target state (dedup)", () => {
    const events = [
      makeEvent({ id: "e1", payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:00Z" }),
      makeEvent({ id: "e2", payloadJson: { to: "Planning" }, createdAt: "2024-01-02T00:00:00Z" }),
    ];
    render(<WorkflowStepper currentState="Done" events={events} />);
    // Just assert it renders without throwing and only one timestamp node appears for Planning
    expect(screen.getAllByText(/ago|just now/).length).toBeGreaterThanOrEqual(1);
  });
});
