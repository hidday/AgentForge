import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("formats a camel-cased state name into spaced words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("renders the active category style and pulsing dot for an active state", () => {
    const { container } = render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("renders the waiting category style without a pulsing dot", () => {
    const { container } = render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval").closest("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");
    const dot = container.querySelector("span > span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("renders the blocked category style for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
  });

  it("renders the done category style for the Done state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
  });

  it("falls back to the idle category style for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-idle");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges an additional className onto the badge", () => {
    render(<StateBadge state="Todo" className="extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("extra-class");
  });
});
