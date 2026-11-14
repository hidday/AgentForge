import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active pulsing dot class for an active state", () => {
    const { container } = render(<StateBadge state="Implementing" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulsing dot class for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span > span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges an extra className onto the badge", () => {
    const { container } = render(<StateBadge state="Todo" className="extra-class" />);
    expect(container.querySelector("span")?.className).toContain("extra-class");
  });
});
