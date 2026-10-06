import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name for a known active state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    expect(screen.getByText("Planning")).toBeDefined();
    // active category => pulsing dot
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not pulse the dot for a non-active state (e.g. Done)", () => {
    const { container } = render(<StateBadge state="Done" />);
    expect(screen.getByText("Done")).toBeDefined();
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).toBeNull();
  });

  it("formats a multi-word camelCase state by splitting on capital letters", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("falls back to the idle category for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    expect(screen.getByText("Some Unknown State")).toBeDefined();
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("state-idle");
  });

  it("applies the blocked category styling for a blocked state", () => {
    const { container } = render(<StateBadge state="AIBlocked" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("state-blocked");
  });

  it("merges an additional className prop onto the badge", () => {
    const { container } = render(
      <StateBadge state="Todo" className="my-extra-class" />,
    );
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
