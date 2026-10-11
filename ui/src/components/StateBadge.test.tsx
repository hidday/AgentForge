import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders an active state with a spaced label and active badge/dot classes", () => {
    render(<StateBadge state="Planning" />);
    const badge = screen.getByText("Planning").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-active-bg");
    expect(badge!.className).toContain("text-state-active");

    const dot = badge!.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-state-active");
    // Active states pulse.
    expect(dot!.className).toContain("animate-pulse-dot");
  });

  it("renders a waiting state with waiting classes and no pulse", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    const badge = screen.getByText("Awaiting Plan Approval").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-waiting-bg");

    const dot = badge!.querySelector("span");
    expect(dot!.className).toContain("bg-state-waiting");
    expect(dot!.className).not.toContain("animate-pulse-dot");
  });

  it("renders a blocked state with blocked classes", () => {
    render(<StateBadge state="AIBlocked" />);
    // formatStateName inserts a space before every capital letter, so
    // "AIBlocked" (A, I, B all capitals) becomes "A I Blocked".
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-blocked-bg");
    expect(badge!.className).toContain("text-state-blocked");
  });

  it("renders a done state with done classes", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-done-bg");
    expect(badge!.className).toContain("text-state-done");
  });

  it("renders an idle state (Todo) with idle classes", () => {
    render(<StateBadge state="Todo" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-idle-bg");
    expect(badge!.className).toContain("text-state-idle");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText("Some Unknown State").closest("span");
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain("bg-state-idle-bg");
    expect(badge!.className).toContain("text-state-idle");
  });

  it("merges a provided className onto the badge", () => {
    render(<StateBadge state="Done" className="extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge!.className).toContain("extra-class");
  });
});
