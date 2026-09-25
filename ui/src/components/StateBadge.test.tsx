import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it.each([
    ["Todo", "idle"],
    ["Planning", "active"],
    ["PlanReview", "active"],
    ["PlanRevision", "active"],
    ["AwaitingPlanApproval", "waiting"],
    ["Implementing", "active"],
    ["AIReview", "active"],
    ["AddressingReview", "active"],
    ["ReadyForHumanReview", "waiting"],
    ["Done", "done"],
    ["AIBlocked", "blocked"],
    ["HumanClarificationNeeded", "waiting"],
  ])("renders formatted label for known state %s (category %s)", (state) => {
    render(<StateBadge state={state} />);
    // formatStateName splits camelCase with spaces
    const expectedLabel = state.replace(/([A-Z])/g, " $1").trim();
    expect(screen.getByText(expectedLabel)).toBeDefined();
  });

  it("falls back to idle category styling for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const label = screen.getByText("Some Unknown State");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("shows the pulsing dot class only for active-category states", () => {
    const { container: activeContainer } = render(<StateBadge state="Planning" />);
    const activeDot = activeContainer.querySelector("span > span");
    expect(activeDot?.className).toContain("animate-pulse-dot");

    const { container: doneContainer } = render(<StateBadge state="Done" />);
    const doneDot = doneContainer.querySelector("span > span");
    expect(doneDot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies a custom className passed in via props", () => {
    render(<StateBadge state="Done" className="my-extra-class" />);
    const label = screen.getByText("Done");
    const badge = label.closest("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
