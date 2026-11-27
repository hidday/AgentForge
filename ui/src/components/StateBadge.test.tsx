import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a formatted label for a known idle state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("inserts spaces before capitals for multi-word states", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active pulse-dot class for an active-category state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse-dot class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category classes for an unknown state", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("bg-state-idle-bg");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(
      <StateBadge state="Done" className="my-extra-class" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("my-extra-class");
  });
});
