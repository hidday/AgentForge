import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state label", () => {
    render(<StateBadge state="PlanReview" />);
    expect(screen.getByText("Plan Review")).toBeDefined();
  });

  it("applies the active dot animation class for an active state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span");
    expect(dot).toBeDefined();
    expect(dot?.className).toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-active");
  });

  it("does not apply the pulse animation for a non-active (waiting) state", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-waiting");
  });

  it("does not apply the pulse animation for a blocked state", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-blocked");
  });

  it("does not apply the pulse animation for a done state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-done");
  });

  it("falls back to the idle appearance for an unknown state", () => {
    const { container } = render(<StateBadge state="SomethingUnknown" />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Something Unknown")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="my-extra-class" />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("my-extra-class");
  });
});
