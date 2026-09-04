import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name for a simple state", () => {
    render(<StateBadge state="Done" />);
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("inserts spaces before capital letters for multi-word states", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category classes and pulse animation for active states", () => {
    render(<StateBadge state="Implementing" />);
    const label = screen.getByText("Implementing");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation for non-active (waiting) states", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const label = screen.getByText("Awaiting Plan Approval");
    const badge = label.closest("span");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies blocked category classes for blocked states", () => {
    render(<StateBadge state="AIBlocked" />);
    // formatStateName inserts a space before every capital letter, so
    // consecutive capitals ("AI") each get their own space.
    const label = screen.getByText("A I Blocked");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("applies done category classes for the done state", () => {
    render(<StateBadge state="Done" />);
    const label = screen.getByText("Done");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomethingUnknown" />);
    const label = screen.getByText("Something Unknown");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className with the generated classes", () => {
    render(<StateBadge state="Done" className="my-custom-class" />);
    const label = screen.getByText("Done");
    const badge = label.closest("span");
    expect(badge?.className).toContain("my-custom-class");
  });
});
