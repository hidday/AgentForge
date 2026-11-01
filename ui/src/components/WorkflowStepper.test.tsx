import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunEventRecord } from "@/api/client.ts";

vi.mock("@/lib/utils.ts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils.ts")>("@/lib/utils.ts");
  return {
    ...actual,
    relativeTime: vi.fn(() => "3m ago"),
  };
});

import { WorkflowStepper } from "./WorkflowStepper.tsx";

function makeEvent(
  overrides: Partial<RunEventRecord> & { payloadJson?: unknown },
): RunEventRecord {
  return {
    id: overrides.id ?? "ev-1",
    runId: "run-1",
    eventType: overrides.eventType ?? "RESET_TO_TODO",
    source: overrides.source ?? "system",
    payloadJson: overrides.payloadJson ?? null,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
  };
}

describe("WorkflowStepper", () => {
  it("marks earlier happy-path steps as completed and the current step as current", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Implementing is index 4; Todo..AwaitingPlanApproval (indices 0-3) should be completed
    const labels = ["To Do", "Planning", "Plan Review", "Awaiting Approval"];
    for (const label of labels) {
      const labelEl = screen.getByText(label);
      expect(labelEl.className).toContain("text-state-done");
    }
    const currentLabel = screen.getByText("Implementing");
    expect(currentLabel.className).toContain("text-accent");
    // Upcoming steps are muted
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
    expect(container.querySelectorAll(".animate-spin").length).toBe(1);
  });

  it("marks every step completed when currentState is Done, with the Done row itself styled as current", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    for (const label of [
      "To Do",
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
    ]) {
      expect(screen.getByText(label).className).toContain("text-state-done");
    }
    // The Done row is simultaneously "completed" and "current" — current (text-accent)
    // wins the Tailwind text-color merge since it's applied last.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("renders a relative timestamp for a step that has a matching event", () => {
    const events = [makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2024-01-01T00:00:05Z" })];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText("3m ago")).toBeDefined();
  });

  it("uses the first event's timestamp when multiple events transition to the same state", () => {
    const events = [
      makeEvent({ id: "a", payloadJson: { to: "Planning" }, createdAt: "first" }),
      makeEvent({ id: "b", payloadJson: { to: "Planning" }, createdAt: "second" }),
    ];
    // relativeTime is mocked to always return "3m ago" regardless of input,
    // but we can still confirm only one timestamp node renders per step.
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getAllByText("3m ago").length).toBe(1);
  });

  it("ignores events whose payload has no 'to' field", () => {
    const events = [makeEvent({ payloadJson: { foo: "bar" } })];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    expect(screen.queryByText("3m ago")).toBeNull();
  });

  it("renders the PlanRevision side-state panel and marks steps before its mapped index as completed", () => {
    render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
    expect(screen.getByText("Revising Plan")).toBeDefined();
    // Steps before the mapped index (PlanReview, idx 2) are completed; the mapped
    // row itself is neither "current" (exact state name differs) nor completed.
    expect(screen.getByText("To Do").className).toContain("text-state-done");
    expect(screen.getByText("Planning").className).toContain("text-state-done");
    expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
  });

  it("renders the AddressingReview side-state panel and marks steps before its mapped index as completed", () => {
    render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
    expect(screen.getByText("Addressing Review")).toBeDefined();
    expect(screen.getByText("Implementing").className).toContain("text-state-done");
    expect(screen.getByText("AI Review").className).toContain("text-text-muted");
  });

  it("renders a blocked-styled dot and 'Blocked' label for AIBlocked", () => {
    const { container } = render(
      <WorkflowStepper currentState="AIBlocked" events={[]} />,
    );
    expect(screen.getByText("Blocked")).toBeDefined();
    const dot = container.querySelector(".bg-state-blocked");
    expect(dot).not.toBeNull();
  });

  it("renders an active-styled dot and 'Needs Clarification' label for HumanClarificationNeeded", () => {
    const { container } = render(
      <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
    );
    expect(screen.getByText("Needs Clarification")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not render the side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="Planning" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });
});
