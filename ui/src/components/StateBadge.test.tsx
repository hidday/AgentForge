import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a known state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders a single-word state unchanged", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("applies the active category classes (with pulsing dot) for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not pulse the dot for a non-active category (done)", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the blocked category classes for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    // formatStateName inserts a space before every capital letter, including
    // consecutive ones, so "AIBlocked" renders as "A I Blocked".
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("merges a custom className into the badge", () => {
    render(<StateBadge state="Done" className="custom-extra" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("custom-extra");
  });
});
