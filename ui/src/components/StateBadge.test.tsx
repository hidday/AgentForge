import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a multi-word state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category classes and pulsing dot for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    expect(badge?.className).toContain("text-state-active");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies the waiting category classes without a pulsing dot", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval").closest("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the blocked category classes for AIBlocked", () => {
    render(<StateBadge state="AIBlocked" />);
    // formatStateName inserts a space before every capital letter, so
    // consecutive capitals ("AI") each get their own space.
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    expect(badge?.className).toContain("text-state-blocked");
  });

  it("applies the done category classes for Done", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    expect(badge?.className).toContain("text-state-done");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomethingWeird" />);
    const badge = screen.getByText("Something Weird").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    expect(badge?.className).toContain("text-state-idle");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-custom-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("my-custom-class");
  });
});
