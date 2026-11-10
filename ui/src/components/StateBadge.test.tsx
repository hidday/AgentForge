import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";
import { getStateBadgeClass, getStateDotClass } from "@/lib/stateColors.ts";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("inserts spaces before capital letters for multi-word states", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the badge class matching the state's category (active)", () => {
    render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning");
    const expectedClasses = getStateBadgeClass("Planning").split(" ");
    for (const cls of expectedClasses) {
      expect(badge.className).toContain(cls);
    }
  });

  it("applies the pulsing dot animation class only for active-category states", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    const dot = badge.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-dot");
    expect(dot!.className).toContain(getStateDotClass("Implementing"));
  });

  it("does not apply the pulsing dot animation for non-active-category states (e.g. Done)", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    const dot = badge.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the 'idle' category styling for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State");
    expect(badge.className).toContain(getStateBadgeClass("SomeUnknownState"));
    const dot = badge.querySelector("span");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = screen.getByText("Todo");
    expect(badge.className).toContain("my-extra-class");
  });
});
