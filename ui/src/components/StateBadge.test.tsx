import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted label for a known active state and applies the active pulse dot", () => {
    const { container } = render(<StateBadge state="Planning" />);
    expect(screen.getByText("Planning")).toBeDefined();
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-active");
  });

  it("splits camelCase state names into separate words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders the waiting category styling without the pulse animation", () => {
    const { container } = render(<StateBadge state="ReadyForHumanReview" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-waiting");
  });

  it("renders the blocked category styling for AIBlocked", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("renders the done category styling for Done", () => {
    const { container } = render(<StateBadge state="Done" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("falls back to the idle category for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges an additional className prop onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="custom-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("custom-class");
  });
});
