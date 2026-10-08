import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

const NOW = new Date("2026-01-10T12:00:00Z").getTime();

function ev(id: string, to: string | null, minutesAgo: number): RunEventRecord {
  return {
    id,
    runId: "r1",
    eventType: "STATE",
    source: "system",
    payloadJson: to ? { to } : null,
    createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  };
}

function label(text: string) {
  return screen.getByText(text);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("WorkflowStepper", () => {
  it("marks earlier states completed, the current state active and later ones upcoming", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(label("Planning").className).toContain("text-state-done");
    expect(label("Awaiting Approval").className).toContain("text-state-done");
    expect(label("Implementing").className).toContain("text-accent");
    expect(label("AI Review").className).toContain("text-text-muted");
    expect(label("Done").className).toContain("text-text-muted");
    expect(screen.queryByText("Revising Plan")).toBeNull();
  });

  it("marks every step completed when Done", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    for (const t of ["To Do", "Planning", "Human Review"]) {
      expect(label(t).className).toContain("text-state-done");
    }
    // Done is both completed and current; the current (accent) color wins the merge
    // but it renders the completed check icon rather than the spinner.
    expect(label("Done").className).toContain("text-accent");
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(0);
  });

  it("shows the first timestamp per state from events", () => {
    render(
      <WorkflowStepper
        currentState="PlanReview"
        events={[ev("e1", "Planning", 5), ev("e2", "Planning", 1), ev("e3", null, 2), ev("e4", "PlanReview", 120)]}
      />,
    );
    expect(label("Planning").nextElementSibling!.textContent).toBe("5m ago");
    expect(label("Plan Review").nextElementSibling!.textContent).toBe("2h ago");
    expect(label("To Do").nextElementSibling).toBeNull();
  });

  it.each([
    ["PlanRevision", "Revising Plan", "Plan Review", false],
    ["AddressingReview", "Addressing Review", "AI Review", false],
    ["AIBlocked", "Blocked", null, true],
    ["HumanClarificationNeeded", "Needs Clarification", null, false],
  ])("shows a side-state panel for %s", (state, text, mappedStep, blockedDot) => {
    const { container } = render(<WorkflowStepper currentState={state} events={[]} />);
    const panelLabel = screen.getByText(text);
    const dot = panelLabel.previousElementSibling!;
    if (blockedDot) {
      expect(dot.className).toContain("bg-state-blocked");
    } else if (state === "HumanClarificationNeeded") {
      // waiting category -> not blocked
      expect(dot.className).toContain("bg-state-active");
    } else {
      expect(dot.className).toContain("animate-pulse-dot");
    }
    if (mappedStep) {
      // steps before the mapped step are completed, the mapped step itself is not current
      expect(label("Planning").className).toContain("text-state-done");
      expect(screen.getAllByText(mappedStep)[0]!.className).toContain("text-text-muted");
    }
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(0);
  });
});
