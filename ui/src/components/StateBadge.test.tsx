import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="PlanReview" />);
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("applies the active category classes and pulsing dot for an active state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies the waiting category classes without the pulsing dot animation", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the blocked category classes for a blocked state", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    expect(screen.getByText("A I Blocked")).toBeDefined();
  });

  it("applies the done category classes for a done state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("applies the idle category classes for an unrecognized state", () => {
    const { container } = render(<StateBadge state="SomethingNew" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="custom-extra" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("custom-extra");
  });
});
