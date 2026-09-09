import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category's badge classes and pulsing dot for active states", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    const dot = container.querySelector(".animate-pulse-dot");
    expect(dot).not.toBeNull();
  });

  it("does not pulse the dot for a non-active state", () => {
    const { container } = render(<StateBadge state="Done" />);
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("merges an extra className via the className prop", () => {
    render(<StateBadge state="Todo" className="custom-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("custom-class");
  });

  it("falls back to the idle badge classes for an unrecognized state", () => {
    render(<StateBadge state="MadeUpState" />);
    const badge = screen.getByText("Made Up State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });
});
