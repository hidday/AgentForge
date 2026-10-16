import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders an active state with a formatted label, active badge classes, and a pulsing dot", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    expect(badge.className).toContain("bg-state-active-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("renders an idle state (Todo) without a pulsing dot", () => {
    render(<StateBadge state="Todo" />);
    const badge = screen.getByText("Todo");
    expect(badge.className).toContain("bg-state-idle-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-idle");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("renders a waiting state with a multi-word formatted label", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval");
    expect(badge.className).toContain("bg-state-waiting-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-waiting");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("renders a blocked state with blocked badge classes", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked");
    expect(badge.className).toContain("bg-state-blocked-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-blocked");
  });

  it("renders the done state with done badge classes", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    expect(badge.className).toContain("bg-state-done-bg");
    const dot = badge.querySelector("span");
    expect(dot?.className).toContain("bg-state-done");
  });

  it("falls back to idle styling for an unrecognized state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State");
    expect(badge.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="custom-marker" />);
    const badge = screen.getByText("Todo");
    expect(badge.className).toContain("custom-marker");
  });
});
