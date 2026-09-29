import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

describe("WorkflowStepper", () => {
  it("marks the first step as current and all others as upcoming when state is Todo", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    const toDo = screen.getByText("To Do");
    expect(toDo.className).toContain("text-accent");

    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-text-muted");
  });

  it("marks every step before Done as completed when the run has finished", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);

    // Done is both the current and the completed step; being current wins
    // the text-color class (accent), while every earlier step is completed.
    const done = screen.getByText("Done");
    expect(done.className).toContain("text-accent");

    const toDo = screen.getByText("To Do");
    expect(toDo.className).toContain("text-state-done");
    const humanReview = screen.getByText("Human Review");
    expect(humanReview.className).toContain("text-state-done");
  });

  it("marks steps before the current one as completed and after as upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const planning = screen.getByText("Planning");
    expect(planning.className).toContain("text-state-done");

    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");

    const upcoming = screen.getByText("Human Review");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("maps side states (e.g. AIBlocked) onto their corresponding happy-path step and shows a status badge", () => {
    render(<WorkflowStepper currentState="AIBlocked" events={[]} />);

    expect(screen.getByText("Blocked")).toBeDefined();
  });

  it("shows 'Revising Plan' for the PlanRevision side state", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
  });

  it("renders a relative timestamp for a state derived from event payloads", () => {
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "PLAN_CREATED",
        source: "system",
        payloadJson: { from: "Todo", to: "Planning" },
        createdAt: new Date(Date.now() - 5000).toISOString(),
      },
    ];
    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText(/ago|just now/)).toBeDefined();
  });
});
