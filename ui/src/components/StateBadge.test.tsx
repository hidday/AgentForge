import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name for a simple single-word state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("splits camel-case state names into separate words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("splits consecutive capitals in acronym-like state names", () => {
    render(<StateBadge state="AIBlocked" />);
    expect(screen.getByText("A I Blocked")).toBeDefined();
  });

  it("applies the active category styling and pulse animation for an active state", () => {
    render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning");
    expect(badge.className).toContain("bg-state-active-bg");
    expect(badge.className).toContain("text-state-active");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies the waiting category styling without pulse animation", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval");
    expect(badge.className).toContain("bg-state-waiting-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies the blocked category styling", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked");
    expect(badge.className).toContain("bg-state-blocked-bg");
    expect(badge.className).toContain("text-state-blocked");
  });

  it("applies the done category styling", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    expect(badge.className).toContain("bg-state-done-bg");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State");
    expect(badge.className).toContain("bg-state-idle-bg");
    expect(badge.className).toContain("text-state-idle");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = screen.getByText("Todo");
    expect(badge.className).toContain("my-extra-class");
  });
});
