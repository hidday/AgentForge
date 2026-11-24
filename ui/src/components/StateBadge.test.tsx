import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the pulsing dot animation class for an active state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulsing animation for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="custom-class" />);
    expect(container.querySelector("span")?.className).toContain("custom-class");
  });
});
