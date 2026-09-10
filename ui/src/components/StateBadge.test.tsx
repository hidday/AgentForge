import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge";

describe("StateBadge", () => {
  it("renders a formatted label for the given state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the pulsing dot animation for active states", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span span")!;
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("does not pulse for non-active states", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span span")!;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Done" className="my-extra-class" />);
    expect(container.querySelector("span")!.className).toContain("my-extra-class");
  });
});
