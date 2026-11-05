import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepper } from "./WorkflowStepper.tsx";
import type { RunEventRecord } from "@/api/client.ts";

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "ev-1",
    runId: "run-1",
    eventType: "state-changed",
    source: "system",
    payloadJson: { to: "Planning" },
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WorkflowStepper", () => {
  it("renders every happy-path state label", () => {
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

  it("marks earlier steps completed and the current step as in-progress", () => {
    const { container } = render(
      <WorkflowStepper currentState="Implementing" events={[]} />,
    );
    // Current step label should carry the accent (in-progress) styling.
    const implementingLabel = screen.getByText("Implementing");
    expect(implementingLabel.className).toContain("text-accent");

    // An earlier step should carry the completed styling.
    const planningLabel = screen.getByText("Planning");
    expect(planningLabel.className).toContain("text-state-done");

    // A later, upcoming step should carry the muted styling.
    const doneLabel = screen.getByText("Done");
    expect(doneLabel.className).toContain("text-text-muted");

    // No side-state panel should render on the happy path.
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("marks every step completed when currentState is Done, even past its own index", () => {
    render(<WorkflowStepper currentState="Done" events={[]} />);
    const todoLabel = screen.getByText("To Do");
    expect(todoLabel.className).toContain("text-state-done");
    const doneLabel = screen.getByText("Done");
    // Done is itself the "current" step and should not be muted/upcoming.
    expect(doneLabel.className).not.toContain("text-text-muted");
  });

  it("renders a timestamp for a state with a matching event", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    expect(screen.getByText(/just now/i)).toBeDefined();
  });

  it("ignores events with no payload or no `to` field", () => {
    const events = [
      makeEvent({ payloadJson: null }),
      makeEvent({ payloadJson: {} }),
    ];
    const { container } = render(
      <WorkflowStepper currentState="Planning" events={events} />,
    );
    // No timestamp text should render anywhere since no event had a usable `to`.
    expect(container.querySelector(".text-\\[10px\\]")).toBeNull();
  });

  it("only keeps the first timestamp seen for a repeated `to` state", () => {
    const events = [
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: "2020-01-01T00:00:00Z" }),
      makeEvent({ payloadJson: { to: "Planning" }, createdAt: new Date().toISOString() }),
    ];
    render(<WorkflowStepper currentState="Implementing" events={events} />);
    // The first (oldest) timestamp wins, so it should read as a long time ago,
    // not "just now".
    expect(screen.queryByText(/just now/i)).toBeNull();
  });

  describe("side states", () => {
    it.each([
      ["PlanRevision", "Revising Plan"],
      ["AddressingReview", "Addressing Review"],
      // HumanClarificationNeeded's state category is "waiting" (not
      // "blocked"), so its side-state dot still pulses like an active state.
      ["HumanClarificationNeeded", "Needs Clarification"],
    ])("renders the %s side-state panel with the active/pulsing indicator", (state, label) => {
      const { container } = render(<WorkflowStepper currentState={state} events={[]} />);
      expect(screen.getByText(label)).toBeDefined();
      expect(container.querySelector(".animate-pulse-dot")).not.toBeNull();
      expect(container.querySelector(".bg-state-blocked")).toBeNull();
    });

    it("renders the AIBlocked side-state panel with the blocked (non-pulsing) indicator", () => {
      const { container } = render(
        <WorkflowStepper currentState="AIBlocked" events={[]} />,
      );
      expect(screen.getByText("Blocked")).toBeDefined();
      expect(container.querySelector(".bg-state-blocked")).not.toBeNull();
      expect(container.querySelector(".animate-pulse-dot")).toBeNull();
    });
  });

  it("renders no side-state panel for a happy-path state", () => {
    render(<WorkflowStepper currentState="AIReview" events={[]} />);
    expect(screen.queryByText("Blocked")).toBeNull();
    expect(screen.queryByText("Needs Clarification")).toBeNull();
    expect(screen.queryByText("Revising Plan")).toBeNull();
    expect(screen.queryByText("Addressing Review")).toBeNull();
  });
});
