import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a known idle state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("inserts spaces before capitals for multi-word state labels", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the animate-pulse-dot class to the dot for an active-category state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply animate-pulse-dot for a non-active-category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("does not apply animate-pulse-dot for an unrecognized state (falls back to idle)", () => {
    const { container } = render(<StateBadge state="SomeUnknownState" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(screen.getByText("Some Unknown State")).toBeDefined();
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="my-extra-class" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
