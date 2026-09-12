import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the humanized state name", () => {
    render(<StateBadge state="Implementing" />);
    expect(screen.getByText("Implementing")).toBeDefined();
  });

  it("splits camel-cased state names into words", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active category classes and pulsing dot for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing").closest("span");
    expect(badge?.className).toContain("bg-state-active-bg");
    expect(badge?.className).toContain("text-state-active");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-active");
    expect(dot?.className).toContain("animate-pulse-dot");
  });

  it("applies blocked category classes without a pulsing dot for a blocked state", () => {
    render(<StateBadge state="AIBlocked" />);
    const badge = screen.getByText("A I Blocked").closest("span");
    expect(badge?.className).toContain("bg-state-blocked-bg");
    expect(badge?.className).toContain("text-state-blocked");

    const dot = badge?.querySelector("span");
    expect(dot?.className).toContain("bg-state-blocked");
    expect(dot?.className).not.toContain("animate-pulse-dot");
  });

  it("applies done category classes for the Done state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("bg-state-done-bg");
    expect(badge?.className).toContain("text-state-done");
  });

  it("falls back to the idle category for an unknown state", () => {
    render(<StateBadge state="SomeUnknownState" />);
    const badge = screen.getByText(/Some Unknown State/).closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });

  it("merges a custom className onto the badge", () => {
    render(<StateBadge state="Todo" className="my-extra-class" />);
    const badge = screen.getByText("Todo").closest("span");
    expect(badge?.className).toContain("my-extra-class");
  });
});
