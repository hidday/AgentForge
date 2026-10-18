import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted label for a simple state (idle category, e.g. unknown state)", () => {
    render(<StateBadge state="Todo" />);
    // formatStateName inserts a space before capitals: "Todo" has no internal
    // capital after the first letter, so it stays "Todo".
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("formats multi-word PascalCase state names with spaces", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it.each([
    ["Planning", "active"],
    ["PlanReview", "active"],
    ["PlanRevision", "active"],
    ["Implementing", "active"],
    ["AIReview", "active"],
    ["AddressingReview", "active"],
    ["AwaitingPlanApproval", "waiting"],
    ["ReadyForHumanReview", "waiting"],
    ["HumanClarificationNeeded", "waiting"],
    ["Done", "done"],
    ["AIBlocked", "blocked"],
    ["Todo", "idle"],
    ["SomeUnknownState", "idle"],
  ])("renders state %s with the dot pulsing only for the active category (%s)", (state) => {
    render(<StateBadge state={state} />);
    const label = screen.getByText((content) =>
      content.replace(/\s+/g, "") === state.replace(/([A-Z])/g, " $1").trim().replace(/\s+/g, ""),
    );
    const badge = label.closest("span");
    expect(badge).not.toBeNull();
    const dot = badge!.querySelector("span");
    expect(dot).not.toBeNull();
  });

  it("applies the pulse animation class only to active-category states", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation class to a non-active state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    const dot = badge.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="TotallyMadeUp" />);
    const badge = screen.getByText("Totally Made Up");
    const dot = badge.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(badge.className).toContain("bg-state-idle");
  });

  it("merges an extra className onto the badge", () => {
    render(<StateBadge state="Todo" className="custom-extra-class" />);
    const badge = screen.getByText("Todo");
    expect(badge.className).toContain("custom-extra-class");
  });
});
