import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders a humanized state label with the category's badge classes", () => {
    render(<StateBadge state="AwaitingPlanApproval" className="extra" />);
    const badge = screen.getByText("Awaiting Plan Approval");
    expect(badge.className).toContain("bg-state-waiting-bg");
    expect(badge.className).toContain("extra");
    const dot = badge.querySelector("span")!;
    expect(dot.className).toContain("bg-state-waiting");
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("pulses the dot for active states", () => {
    render(<StateBadge state="Implementing" />);
    const dot = screen.getByText("Implementing").querySelector("span")!;
    expect(dot.className).toContain("bg-state-active");
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("falls back to idle styling for unknown states", () => {
    render(<StateBadge state="Mystery" />);
    const badge = screen.getByText("Mystery");
    expect(badge.className).toContain("bg-state-idle-bg");
  });
});
