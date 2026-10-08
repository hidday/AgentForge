import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

vi.mock("@/api/client.ts", () => ({
  api: {
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveReview: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";
import { RunsTable } from "./RunsTable.tsx";

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "abcdef123456",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderTable(runs: Run[], onAction?: () => void) {
  return render(
    <MemoryRouter>
      <RunsTable runs={runs} onAction={onAction} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(mockApi)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe("RunsTable", () => {
  it("shows an empty state with no table", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders run columns and prefers title > identifier > truncated id", () => {
    renderTable([
      makeRun({ id: "a", linearIssueTitle: "Fix login", linearIssueIdentifier: "ENG-1", prNumber: 7 }),
      makeRun({ id: "b", linearIssueIdentifier: "ENG-2" }),
      makeRun({ id: "c" }),
    ]);
    const link = screen.getByRole("link", { name: "Fix login" });
    expect(link.getAttribute("href")).toBe("/runs/a");
    expect(screen.getByRole("link", { name: "ENG-2" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "abcdef12" })).toBeTruthy();
    expect(screen.getByText("#7")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getAllByText("org/repo")).toHaveLength(3);
    expect(screen.getAllByText("just now")).toHaveLength(3);
  });

  it("renders a Linear link when a URL is present", () => {
    renderTable([makeRun({ linearIssueUrl: "https://linear.app/x" })]);
    const ext = screen.getByTitle("Open in Linear");
    expect(ext.getAttribute("href")).toBe("https://linear.app/x");
    expect(ext.getAttribute("target")).toBe("_blank");
    // React's handler stops propagation, so the click never reaches listeners
    // above the React root.
    const outerClick = vi.fn();
    document.addEventListener("click", outerClick);
    ext.addEventListener("click", (e) => e.preventDefault());
    ext.click();
    document.removeEventListener("click", outerClick);
    expect(outerClick).not.toHaveBeenCalled();
  });

  it("offers approve/reject for AwaitingPlanApproval and calls the API then onAction", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r9", state: "AwaitingPlanApproval" })], onAction);
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    await userEvent.click(screen.getByTitle("Approve Plan"));
    expect(mockApi.approvePlan).toHaveBeenCalledWith("r9");
    expect(onAction).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTitle("Reject Plan"));
    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r9");
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("offers approve & complete for ReadyForHumanReview", async () => {
    renderTable([makeRun({ id: "r2", state: "ReadyForHumanReview" })]);
    await userEvent.click(screen.getByTitle("Approve & Complete"));
    expect(mockApi.approveReview).toHaveBeenCalledWith("r2");
  });

  it("offers pause for active states", async () => {
    renderTable([makeRun({ id: "r3", state: "Implementing" })]);
    expect(screen.queryByTitle("Resume Run")).toBeNull();
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r3");
  });

  it.each(["AIBlocked", "HumanClarificationNeeded"])("offers resume for %s", async (state) => {
    renderTable([makeRun({ id: "r4", state })]);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r4");
  });

  it("offers no action buttons for Done", () => {
    renderTable([makeRun({ state: "Done" })]);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("swallows API errors and skips onAction", async () => {
    const onAction = vi.fn();
    mockApi.pauseRun!.mockRejectedValue(new Error("nope"));
    renderTable([makeRun({ state: "Planning" })], onAction);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback", async () => {
    renderTable([makeRun({ id: "r5", state: "Planning" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r5");
  });
});
