import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the animate-pulse-dot class to the dot for an active-category state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span span");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("does not apply animate-pulse-dot for a non-active-category state", () => {
    const { container } = render(<StateBadge state="Done" />);
    const dot = container.querySelector("span span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges an extra className onto the root element", () => {
    const { container } = render(<StateBadge state="Todo" className="extra-class" />);
    expect(container.querySelector("span")?.className).toContain("extra-class");
  });

  it("falls back to the idle category styling for an unknown state", () => {
    render(<StateBadge state="TotallyUnknown" />);
    expect(screen.getByText("Totally Unknown")).toBeDefined();
  });
});
