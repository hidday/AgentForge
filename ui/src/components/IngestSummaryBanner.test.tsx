import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IngestSummaryBanner } from "./IngestSummaryBanner.tsx";

describe("IngestSummaryBanner", () => {
  it("renders 'Started N runs' (no skipped suffix) when skipped is zero", () => {
    render(<IngestSummaryBanner started={2} skipped={0} onDismiss={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Started 2 runs");
    expect(status.textContent).not.toContain("skipped");
  });

  it("renders singular 'Started 1 run' when started is 1", () => {
    render(<IngestSummaryBanner started={1} skipped={0} onDismiss={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Started 1 run");
    expect(status.textContent).not.toContain("Started 1 runs");
  });

  it("renders 'Started N runs, skipped M' when skipped > 0", () => {
    render(<IngestSummaryBanner started={3} skipped={2} onDismiss={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Started 3 runs");
    expect(status.textContent).toContain("skipped 2");
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<IngestSummaryBanner started={1} skipped={0} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
