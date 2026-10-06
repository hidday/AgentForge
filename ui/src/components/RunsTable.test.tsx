import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-123456789",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: "Todo",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/widgets",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
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

describe("RunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.approvePlan.mockResolvedValue({ ok: true, state: "Implementing" });
    mockApi.rejectPlan.mockResolvedValue({ ok: true, state: "Planning" });
    mockApi.approveReview.mockResolvedValue({ ok: true, state: "Done" });
    mockApi.pauseRun.mockResolvedValue({ ok: true });
    mockApi.resumeRun.mockResolvedValue({ ok: true });
  });

  it("renders the empty state when there are no runs", () => {
    renderTable([]);
    expect(screen.getByText(/no runs found/i)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a row per run with repo and relative-updated-time cells", () => {
    renderTable([makeRun({ id: "run-1", repo: "acme/widgets" })]);
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
  });

  it("falls back through issue title -> identifier -> truncated id for the issue link label", () => {
    const { rerender } = renderTable([
      makeRun({ linearIssueTitle: "Fix the thing", linearIssueIdentifier: "ACME-1" }),
    ]);
    expect(screen.getByText("Fix the thing")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable
          runs={[makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ACME-1" })]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("ACME-1")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable
          runs={[
            makeRun({
              linearIssueTitle: null,
              linearIssueIdentifier: null,
              linearIssueId: "issue-123456789",
            }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("issue-12")).toBeDefined();
  });

  it("renders an external Linear link only when linearIssueUrl is set", () => {
    const { rerender } = renderTable([makeRun({ linearIssueUrl: null })]);
    expect(screen.queryByTitle(/open in linear/i)).toBeNull();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ linearIssueUrl: "https://linear.app/issue/1" })]} />
      </MemoryRouter>,
    );
    const link = screen.getByTitle(/open in linear/i);
    expect(link.getAttribute("href")).toBe("https://linear.app/issue/1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows the PR number when present, or an em dash placeholder when absent", () => {
    const { rerender } = renderTable([makeRun({ prNumber: 42 })]);
    expect(screen.getByText("#42")).toBeDefined();

    rerender(
      <MemoryRouter>
        <RunsTable runs={[makeRun({ prNumber: null })]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("—")).toBeDefined();
  });

  it("AwaitingPlanApproval renders Approve and Reject actions wired to the API", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-1", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledOnce();
    });

    await userEvent.click(screen.getByTitle("Reject Plan"));
    await waitFor(() => {
      expect(mockApi.rejectPlan).toHaveBeenCalledWith("run-1");
      expect(onAction).toHaveBeenCalledTimes(2);
    });
  });

  it("ReadyForHumanReview renders Approve & Complete wired to the API", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-2", state: "ReadyForHumanReview" })], onAction);

    await userEvent.click(screen.getByTitle("Approve & Complete"));
    await waitFor(() => {
      expect(mockApi.approveReview).toHaveBeenCalledWith("run-2");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it("an active-category state renders a Pause action wired to the API", async () => {
    const onAction = vi.fn();
    renderTable([makeRun({ id: "run-3", state: "Implementing" })], onAction);

    await userEvent.click(screen.getByTitle("Pause Run"));
    await waitFor(() => {
      expect(mockApi.pauseRun).toHaveBeenCalledWith("run-3");
      expect(onAction).toHaveBeenCalledOnce();
    });
  });

  it.each(["AIBlocked", "HumanClarificationNeeded"])(
    "%s renders a Resume action wired to the API",
    async (state) => {
      const onAction = vi.fn();
      renderTable([makeRun({ id: "run-4", state })], onAction);

      await userEvent.click(screen.getByTitle("Resume Run"));
      await waitFor(() => {
        expect(mockApi.resumeRun).toHaveBeenCalledWith("run-4");
        expect(onAction).toHaveBeenCalledOnce();
      });
    },
  );

  it("does not render any state-specific action button for a state with no actions (e.g. Done)", () => {
    renderTable([makeRun({ state: "Done" })]);
    expect(screen.queryByTitle("Approve Plan")).toBeNull();
    expect(screen.queryByTitle("Reject Plan")).toBeNull();
    expect(screen.queryByTitle("Approve & Complete")).toBeNull();
    expect(screen.queryByTitle("Pause Run")).toBeNull();
    expect(screen.queryByTitle("Resume Run")).toBeNull();
  });

  it("swallows a rejected action without calling onAction and without crashing", async () => {
    const onAction = vi.fn();
    mockApi.approvePlan.mockRejectedValue(new Error("server exploded"));
    renderTable([makeRun({ id: "run-5", state: "AwaitingPlanApproval" })], onAction);

    await userEvent.click(screen.getByTitle("Approve Plan"));

    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledOnce();
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("works without an onAction callback", async () => {
    renderTable([makeRun({ id: "run-6", state: "AwaitingPlanApproval" })]);
    await userEvent.click(screen.getByTitle("Approve Plan"));
    await waitFor(() => {
      expect(mockApi.approvePlan).toHaveBeenCalledWith("run-6");
    });
  });

  it("always renders a chevron link to the run detail page", () => {
    renderTable([makeRun({ id: "run-7" })]);
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-7")).toBe(true);
  });
});
