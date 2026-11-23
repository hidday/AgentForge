import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as its text content", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("inserts a space before internal capitals for multi-word states", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active-category badge class and pulse animation for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-active");
  });

  it("applies the blocked-category badge class and no pulse for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
    expect(dot?.className).toContain("bg-state-blocked");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Done" className="custom-extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("custom-extra-class");
  });
});
