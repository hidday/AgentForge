import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";
import { formatStateName } from "@/lib/stateColors.ts";

describe("StateBadge", () => {
  it("renders the formatted label for a known 'active' state with the pulsing dot", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const outer = container.querySelector("span");
    const dot = container.querySelector("span > span");

    expect(outer?.textContent).toBe(formatStateName("Planning"));
    expect(outer?.className).toContain("state-active");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not pulse for a non-active state (waiting category)", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const outer = container.querySelector("span");
    const dot = container.querySelector("span > span");

    expect(outer?.textContent).toBe(formatStateName("AwaitingPlanApproval"));
    expect(outer?.className).toContain("state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("renders the 'blocked' category styling", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("state-blocked");
  });

  it("renders the 'done' category styling", () => {
    const { container } = render(<StateBadge state="Done" />);
    const outer = container.querySelector("span");
    expect(outer?.textContent).toBe("Done");
    expect(outer?.className).toContain("state-done");
  });

  it("falls back to the 'idle' category for an unrecognized state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("state-idle");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(
      <StateBadge state="Todo" className="my-custom-class" />,
    );
    const outer = container.querySelector("span");
    expect(outer?.className).toContain("my-custom-class");
  });
});
