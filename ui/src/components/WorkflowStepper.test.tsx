import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(
  to: string | undefined,
  createdAt: string,
  id = `ev-${to}-${createdAt}`,
): RunEventRecord {
  return {
    id,
    runId: "run-1",
    eventType: "StateTransition",
    source: "system",
    payloadJson: to === undefined ? null : { to },
    createdAt,
  };
}

describe("WorkflowStepper", () => {
  it("renders all happy-path labels", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
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
  });

  it("marks the current state's label as active and later states as upcoming", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);
    const current = screen.getByText("To Do");
    expect(current.className).toContain("text-accent");

    const upcoming = screen.getByText("Planning");
    expect(upcoming.className).toContain("text-text-muted");
    expect(upcoming.className).not.toContain("text-accent");
    expect(upcoming.className).not.toContain("text-state-done");
  });

  it("marks earlier states as completed and current state as active for a mid-flow state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    const completed = screen.getByText("Planning");
    expect(completed.className).toContain("text-state-done");

    const current = screen.getByText("Implementing");
    expect(current.className).toContain("text-accent");

    const upcoming = screen.getByText("AI Review");
    expect(upcoming.className).toContain("text-text-muted");
  });

  it("marks every step as completed when currentState is Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    // All steps before the final one are completed-only.
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
    // The final "Done" step is both completed and current; twMerge keeps the
    // later (current/accent) color utility since both apply to the same step.
    expect(screen.getByText("Done").className).toContain("text-accent");
  });

  it("renders a relative timestamp for a state that has a recorded transition event", () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-01-01T00:10:00.000Z");
    vi.setSystemTime(fixedNow);

    const fiveMinAgo = new Date(fixedNow.getTime() - 5 * 60 * 1000).toISOString();
    const events = [makeEvent("Planning", fiveMinAgo)];

    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("5m ago")).toBeDefined();

    vi.useRealTimers();
  });

  it("keeps the first recorded timestamp when multiple events target the same state", () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-01-01T00:10:00.000Z");
    vi.setSystemTime(fixedNow);

    const tenMinAgo = new Date(fixedNow.getTime() - 10 * 60 * 1000).toISOString();
    const twoMinAgo = new Date(fixedNow.getTime() - 2 * 60 * 1000).toISOString();
    const events = [makeEvent("Planning", tenMinAgo), makeEvent("Planning", twoMinAgo)];

    render(<WorkflowStepper currentState="Planning" events={events} />);
    expect(screen.getByText("10m ago")).toBeDefined();
    expect(screen.queryByText("2m ago")).toBeNull();

    vi.useRealTimers();
  });

  it("ignores events without a `to` field in their payload", () => {
    const events = [makeEvent(undefined, new Date().toISOString())];
    render(<WorkflowStepper currentState="Todo" events={events} />);
    // Should render without throwing, and no timestamp text should appear
    // for a state lacking a transition ("just now" would appear otherwise).
    expect(screen.queryByText("just now")).toBeNull();
  });

  describe("side states", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows 'Revising Plan' with an active dot for PlanRevision", () => {
      render(<WorkflowStepper currentState="PlanRevision" events={[]} />);
      expect(screen.getByText("Revising Plan")).toBeDefined();
      // PlanReview (the effective step) is neither completed nor current, so it's upcoming
      expect(screen.getByText("Plan Review").className).toContain("text-text-muted");
    });

    it("shows 'Addressing Review' for AddressingReview", () => {
      render(<WorkflowStepper currentState="AddressingReview" events={[]} />);
      expect(screen.getByText("Addressing Review")).toBeDefined();
    });

    it("shows 'Blocked' with a blocked-colored dot for AIBlocked", () => {
      const { container } = render(
        <WorkflowStepper currentState="AIBlocked" events={[]} />,
      );
      expect(screen.getByText("Blocked")).toBeDefined();
      const dot = container.querySelector(".bg-state-blocked");
      expect(dot).not.toBeNull();
    });

    it("shows 'Needs Clarification' with an active (non-blocked) dot for HumanClarificationNeeded", () => {
      const { container } = render(
        <WorkflowStepper currentState="HumanClarificationNeeded" events={[]} />,
      );
      expect(screen.getByText("Needs Clarification")).toBeDefined();
      const dot = container.querySelector(".bg-state-active.animate-pulse-dot");
      expect(dot).not.toBeNull();
    });

    it("does not render the side-state box for a happy-path state", () => {
      render(<WorkflowStepper currentState="Planning" events={[]} />);
      expect(screen.queryByText("Revising Plan")).toBeNull();
      expect(screen.queryByText("Addressing Review")).toBeNull();
      expect(screen.queryByText("Blocked")).toBeNull();
      expect(screen.queryByText("Needs Clarification")).toBeNull();
    });
  });
});
