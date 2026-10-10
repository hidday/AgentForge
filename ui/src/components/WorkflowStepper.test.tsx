import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "RUN_REQUESTED",
    source: "human",
    payloadJson: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function labelClass(text: string): string {
  return screen.getByText(text).className;
}

describe("WorkflowStepper", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks only the first happy-path state as current when currentState is Todo", () => {
    render(<WorkflowStepper currentState="Todo" events={[]} />);

    expect(labelClass("To Do")).toContain("text-accent");
    expect(labelClass("To Do")).not.toContain("text-state-done");

    for (const label of [
      "Planning",
      "Plan Review",
      "Awaiting Approval",
      "Implementing",
      "AI Review",
      "Human Review",
      "Done",
    ]) {
      expect(labelClass(label)).toContain("text-text-muted");
    }
  });

  it("marks earlier states completed, the current state current, and later states upcoming for a middle state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);

    for (const label of ["To Do", "Planning", "Plan Review", "Awaiting Approval"]) {
      expect(labelClass(label)).toContain("text-state-done");
    }

    expect(labelClass("Implementing")).toContain("text-accent");

    for (const label of ["AI Review", "Human Review", "Done"]) {
      expect(labelClass(label)).toContain("text-text-muted");
    }
  });

  it("marks every step completed when currentState is Done, overriding the normal index comparison", () => {
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
      expect(labelClass(label)).toContain("text-state-done");
      expect(labelClass(label)).not.toContain("text-text-muted");
    }

    // The Done row itself is both "current" and "completed"; the completed
    // (Check icon) branch takes priority in the icon render.
    const doneRow = screen.getByText("Done").closest(".pb-4") as HTMLElement;
    expect(doneRow.innerHTML).toContain("bg-state-done/20");
    expect(doneRow.innerHTML).not.toContain("bg-accent/20");
  });

  it.each([
    { state: "PlanRevision", label: "Revising Plan", blocked: false },
    { state: "AddressingReview", label: "Addressing Review", blocked: false },
    { state: "AIBlocked", label: "Blocked", blocked: true },
    { state: "HumanClarificationNeeded", label: "Needs Clarification", blocked: false },
  ])(
    "renders the $state side-track banner with its label and dot color",
    ({ state, label, blocked }) => {
      render(<WorkflowStepper currentState={state} events={[]} />);

      const banner = screen.getByText(label);
      expect(banner).toBeDefined();

      const dot = banner.parentElement?.querySelector("div") as HTMLElement;
      expect(dot).toBeDefined();
      if (blocked) {
        expect(dot.className).toContain("bg-state-blocked");
        expect(dot.className).not.toContain("animate-pulse-dot");
      } else {
        expect(dot.className).toContain("bg-state-active");
        expect(dot.className).toContain("animate-pulse-dot");
      }
    },
  );

  it("does not render a side-track banner for a happy-path state", () => {
    render(<WorkflowStepper currentState="Implementing" events={[]} />);
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("shows a relative-time label next to a step whose state transition was found in events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));

    const events = [
      makeEvent({ id: "ev-1", payloadJson: { to: "Implementing" }, createdAt: "2026-01-01T00:00:00Z" }),
    ];

    render(<WorkflowStepper currentState="Implementing" events={events} />);

    expect(screen.getByText("5m ago")).toBeDefined();
  });

  it("does not render a timestamp label for an event whose payload.to does not match any happy-path state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));

    const events = [
      makeEvent({ id: "ev-1", payloadJson: { to: "SomeOtherSideState" }, createdAt: "2026-01-01T00:00:00Z" }),
    ];

    render(<WorkflowStepper currentState="Implementing" events={events} />);

    expect(screen.queryByText("5m ago")).toBeNull();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("does not render a timestamp label for an event with no payload.to at all", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));

    const events = [makeEvent({ id: "ev-1", payloadJson: {}, createdAt: "2026-01-01T00:00:00Z" })];

    render(<WorkflowStepper currentState="Implementing" events={events} />);

    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("uses only the first event encountered for a given state when multiple events map to it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:05:00Z"));

    const events = [
      // Appears first in the array -> should win, despite being the "older" looking entry.
      makeEvent({ id: "ev-older", payloadJson: { to: "Implementing" }, createdAt: "2026-01-01T00:05:00Z" }),
      makeEvent({ id: "ev-newer", payloadJson: { to: "Implementing" }, createdAt: "2026-01-01T01:00:00Z" }),
    ];

    render(<WorkflowStepper currentState="Implementing" events={events} />);

    // First event: 1h05m - 0h05m = 1h diff -> "1h ago"
    expect(screen.getByText("1h ago")).toBeDefined();
    // Second event would have produced "5m ago" -- must not appear.
    expect(screen.queryByText("5m ago")).toBeNull();
  });
});
