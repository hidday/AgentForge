import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateBadge } from "./StateBadge.tsx";

describe("StateBadge", () => {
  it("renders the formatted state name as text", () => {
    render(<StateBadge state="AwaitingPlanApproval" />);
    expect(screen.getByText("Awaiting Plan Approval")).toBeDefined();
  });

  it("applies the active dot pulse animation for an active state", () => {
    render(<StateBadge state="Implementing" />);
    const badge = screen.getByText("Implementing");
    const dot = badge.querySelector("span") as HTMLElement;
    expect(dot.className).toContain("animate-pulse-dot");
  });

  it("does not apply the pulse animation for a non-active state", () => {
    render(<StateBadge state="Done" />);
    const badge = screen.getByText("Done");
    const dot = badge.querySelector("span") as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse-dot");
  });

  it("merges an extra className onto the badge span", () => {
    render(<StateBadge state="Done" className="my-extra-class" />);
    const badge = screen.getByText("Done").closest("span");
    expect(badge?.className).toContain("my-extra-class");
  });

  it("falls back to idle styling for an unknown state", () => {
    render(<StateBadge state="TotallyUnknown" />);
    const badge = screen.getByText("Totally Unknown").closest("span");
    expect(badge?.className).toContain("bg-state-idle-bg");
  });
});
