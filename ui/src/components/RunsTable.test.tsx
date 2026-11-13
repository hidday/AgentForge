import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { RunsTable } from "./RunsTable.tsx";
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

const mockApi = api as unknown as {
  approvePlan: ReturnType<typeof vi.fn>;
  rejectPlan: ReturnType<typeof vi.fn>;
  approveReview: ReturnType<typeof vi.fn>;
  pauseRun: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
};

function makeRun(overrides: Partial<Run> & { id: string; state: string }): Run {
  return {
    id: overrides.id,
    linearIssueId: overrides.linearIssueId ?? "issue-full-id-123456",
    linearIssueIdentifier: overrides.linearIssueIdentifier ?? null,
    linearIssueDescription: null,
    linearIssueTitle: overrides.linearIssueTitle ?? null,
    linearIssueUrl: overrides.linearIssueUrl ?? null,
    repo: overrides.repo ?? "acme/widgets",
    branchName: null,
    prNumber: overrides.prNumber ?? null,
    state: overrides.state,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2024-01-01T00:00:00Z",
  };
}

function renderTable(runs: Run[], onAction = vi.fn()) {
  return render(
    <MemoryRouter>
      <RunsTable runs={runs} onAction={onAction} />
    </MemoryRouter>,
  );
}

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders the issue title when present", () => {
    renderTable([makeRun({ id: "r1", state: "Todo", linearIssueTitle: "Fix the bug" })]);
    expect(screen.getByText("Fix the bug")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no title", () => {
    renderTable([
      makeRun({ id: "r1", state: "Todo", linearIssueIdentifier: "ENG-42" }),
    ]);
    expect(screen.getByText("ENG-42")).toBeDefined();
  });

  it("falls back to a truncated issue id when there is no title or identifier", () => {
    renderTable([makeRun({ id: "r1", state: "Todo", linearIssueId: "abcdefgh12345" })]);
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is set", () => {
    const { rerender } = renderTable([
      makeRun({ id: "r1", state: "Todo", linearIssueUrl: "https://linear.app/x" }),
    ]);
    expect(screen.getByTitle("Open in Linear")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ id: "r1", state: "Todo" })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
  });

  it("calls stopPropagation when the external Linear link is clicked", () => {
    renderTable([
      makeRun({ id: "r1", state: "Todo", linearIssueUrl: "https://linear.app/x" }),
    ]);
    const link = screen.getByTitle("Open in Linear");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");

    link.dispatchEvent(event);

    expect(stopPropagationSpy).toHaveBeenCalledOnce();
  });

  it("renders the PR number when present, and an em dash otherwise", () => {
    const { rerender } = renderTable([
      makeRun({ id: "r1", state: "Todo", prNumber: 42 }),
    ]);
    expect(screen.getByText("#42")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ id: "r1", state: "Todo", prNumber: null })]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("—")).toBeDefined();
  });

  it("shows approve/reject actions only for AwaitingPlanApproval", () => {
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })]);
    expect(screen.getByTitle("Approve Plan")).toBeDefined();
    expect(screen.getByTitle("Reject Plan")).toBeDefined();
  });

  it("calls api.approvePlan and onAction when Approve Plan is clicked", async () => {
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("calls api.rejectPlan when Reject Plan is clicked", async () => {
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Reject Plan"));

    expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledOnce());
  });

  it("does not call onAction when the action rejects", async () => {
    mockApi.approvePlan.mockRejectedValue(new Error("boom"));
    const onAction = vi.fn();
    renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await vi.waitFor(() => expect(mockApi.approvePlan).toHaveBeenCalled());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the Approve & Complete action only for ReadyForHumanReview", async () => {
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    renderTable([makeRun({ id: "r1", state: "ReadyForHumanReview" })]);
    const btn = screen.getByTitle("Approve & Complete");
    await userEvent.click(btn);
    expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
  });

  it("shows the Pause action for active-category states", async () => {
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r1", state: "Implementing" })]);
    await userEvent.click(screen.getByTitle("Pause Run"));
    expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
  });

  it("shows the Resume action for AIBlocked and HumanClarificationNeeded", async () => {
    mockApi.resumeRun.mockResolvedValue({ ok: true });
    renderTable([makeRun({ id: "r1", state: "AIBlocked" })]);
    await userEvent.click(screen.getByTitle("Resume Run"));
    expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
  });

  it("shows no action buttons for a plain Done run besides the row link", () => {
    renderTable([makeRun({ id: "r1", state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("links the issue cell and chevron to the run detail route", () => {
    renderTable([makeRun({ id: "run-xyz", state: "Todo" })]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-xyz")).toBe(true);
  });

  it("renders a StateBadge-derived label and the repo column", () => {
    renderTable([makeRun({ id: "r1", state: "Todo", repo: "acme/widgets" })]);
    expect(screen.getByText("Todo")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });
});
