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
  it("renders every happy-path step label", () => {
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

  it("marks steps before the current one as completed and the current one as in-progress", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("state-done");

    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("text-text-muted");
  });

  it("marks every earlier happy-path step as completed when the run is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("state-done");
    const humanReviewLabel = screen.getByText("Human Review");
    expect(humanReviewLabel.className).toContain("state-done");
    // The Done row itself is both "completed" and "current" — the current
    // (accent) styling wins once the classes are merged.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-accent");
  });

  it("renders a timestamp for a step that has a matching state-changed event", () => {
    const events = [makeEvent("Planning", "2024-01-01T00:00:00Z")];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // relativeTime() of a long-past date renders as "Xd ago"
    expect(screen.getByText(/ago$/)).toBeDefined();
  });

  it("shows the side-state panel with 'Revising Plan' for PlanRevision", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // The mapped step (PlanReview) is treated as upcoming, not current, since
    // the side state's literal name never matches a happy-path step name.
    const planReviewLabel = screen.getByText("Plan Review");
    expect(planReviewLabel.className).toContain("text-text-muted");
    // The step before it is still marked completed via effectiveIdx.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("state-done");
  });

  it("shows the side-state panel with 'Addressing Review' for AddressingReview", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
  });

  it("shows a blocked-styled side panel with 'Blocked' for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
  });

  it("shows 'Needs Clarification' with an active (non-blocked) dot for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    expect(container.querySelector(".animate-pulse-dot")).not.toBeNull();
  });

  it("does not render a side-state panel for a plain happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
  });
});
