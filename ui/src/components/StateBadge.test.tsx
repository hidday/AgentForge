import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category's dot animation class for an active state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-dot");
    expect(dot!.className).toContain("bg-state-active");
  });

  it("does not apply the pulse animation for a non-active (waiting) state", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const dot = container.querySelector("span > span");
    expect(dot).not.toBeNull();
    expect(dot!.className).not.toContain("animate-pulse-dot");
    expect(dot!.className).toContain("bg-state-waiting");
  });

  it("applies blocked styling for AIBlocked", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge!.className).toContain("state-blocked");
  });

  it("applies done styling for Done", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge!.className).toContain("state-done");
  });

  it("falls back to idle styling for an unknown state and still renders the raw name", () => {
    render(<StateBadge state="TotallyUnknownState" />);
    const badge = screen.getByText("Totally Unknown State").closest("span");
    expect(badge!.className).toContain("state-idle");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge!.className).toContain("my-extra-class");
  });
});
