import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted label for a simple state", () => {
    render(<StateBadge state="Todo" />);
    expect(screen.getByText("Todo")).toBeDefined();
  });

  it("formats a multi-word PascalCase state into spaced words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category classes and pulsing dot for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const label = screen.getByText("Implementing");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    expect(badge?.className).toContain("text-state-active");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies waiting category classes and does not pulse for a waiting state", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const label = screen.getByText("Awaiting Plan Approval");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-waiting-bg");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies blocked category classes for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    const label = screen.getByText("A I Blocked");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-blocked");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies done category classes for the Done state", () => {
    render(<StateBadge state="Done" />);
    const label = screen.getByText("Done");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-done");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("falls back to the idle category for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const label = screen.getByText("Some Unknown State");
    const badge = label.closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-idle");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-custom-class" />);
    const label = screen.getByText("Todo");
    const badge = label.closest("span");
    expect(badge?.className).toContain("my-custom-class");
  });
});
