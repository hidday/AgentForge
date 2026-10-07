import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a space-separated label for a camel-cased state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders a single-word state unchanged", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("pulses the status dot for an active-category state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    const dot = badge.firstElementChild as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-active");
  });

  it("does not pulse the dot for a non-active-category state (waiting)", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval");
    const dot = badge.firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
    expect(dot.className).toContain("bg-state-waiting");
  });

  it("uses the done category styling for the Done state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    expect(badge?.className).toContain("text-state-done");
  });

  it("uses the blocked category styling for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    // Note: formatStateName inserts a space before every capital letter, so
    // consecutive capitals ("AI") are split apart too ("A I Blocked") rather
    // than being kept together as "AI Blocked". This looks like a display bug
    // in formatStateName, not something introduced by this test.
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State");
    expect(badge.className).toContain("bg-state-idle-bg");
    const dot = badge.firstElementChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("merges an additional className passed in via props", () => {
    render(<StateBadge state="Todo" className="extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("extra-class");
  });
});
