import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

import { RunsTable } from "./RunsTable.tsx";
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
    linearIssueId: "issue-1234567890",
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
    for (const key of Object.keys(mockApi) as Array<keyof typeof mockApi>) {
      mockApi[key].mockResolvedValue(undefined);
    }
  });

  it("shows 'No runs found' when runs is empty", () => {
    renderTable([]);
    expect(screen.getByText("No runs found")).toBeDefined();
  });

  it("renders a row per run with StateBadge and repo text", () => {
    const runs = [
      makeRun({ id: "r1", state: "Implementing", repo: "acme/widgets" }),
      makeRun({ id: "r2", state: "Done", repo: "acme/gizmos" }),
    ];
    renderTable(runs);
    expect(screen.getByText("Implementing")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("acme/gizmos")).toBeDefined();
  });

  describe("issue title fallback chain", () => {
    it("uses linearIssueTitle when present", () => {
      renderTable([
        makeRun({
          linearIssueTitle: "Fix the bug",
          linearIssueIdentifier: "ENG-1",
          linearIssueId: "abcdef1234567890",
        }),
      ]);
      expect(screen.getByText("Fix the bug")).toBeDefined();
    });

    it("falls back to linearIssueIdentifier when title is missing", () => {
      renderTable([
        makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: "ENG-42",
          linearIssueId: "abcdef1234567890",
        }),
      ]);
      expect(screen.getByText("ENG-42")).toBeDefined();
    });

    it("falls back to a truncated linearIssueId when title and identifier are missing", () => {
      renderTable([
        makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdef1234567890",
        }),
      ]);
      expect(screen.getByText("abcdef12")).toBeDefined();
    });
  });

  describe("external Linear link", () => {
    it("is not rendered when linearIssueUrl is not set", () => {
      renderTable([makeRun({ linearIssueUrl: null })]);
      expect(screen.queryByTitle("Open in Linear")).toBeNull();
    });

    it("is rendered when linearIssueUrl is set and stops propagation on click (no bubbling to the row)", async () => {
      const user = userEvent.setup();
      renderTable([
        makeRun({ linearIssueUrl: "https://linear.app/issue/ENG-1" }),
      ]);
      const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("https://linear.app/issue/ENG-1");
      expect(link.target).toBe("_blank");

      // Attach a plain DOM listener on the ancestor row. If the anchor's
      // onClick did not call stopPropagation, this would still fire because
      // click events bubble by default.
      const row = link.closest("tr")!;
      const rowClickHandler = vi.fn();
      row.addEventListener("click", rowClickHandler);

      await user.click(link);

      expect(rowClickHandler).not.toHaveBeenCalled();
    });
  });

  describe("PR number formatting", () => {
    it("formats a present PR number as #N", () => {
      renderTable([makeRun({ prNumber: 42 })]);
      expect(screen.getByText("#42")).toBeDefined();
    });

    it("shows an em dash when there is no PR number", () => {
      renderTable([makeRun({ prNumber: null })]);
      expect(screen.getByText("—")).toBeDefined();
    });
  });

  it("shows a relative 'Updated' time", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    renderTable([makeRun({ updatedAt: fiveMinAgo })]);
    expect(screen.getByText(/5m ago/)).toBeDefined();
  });

  describe("per-row action buttons", () => {
    it("AwaitingPlanApproval shows approve+reject icons calling api.approvePlan/api.rejectPlan", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

      await user.click(screen.getByTitle("Approve Plan"));
      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
      });
      expect(onAction).toHaveBeenCalledTimes(1);

      await user.click(screen.getByTitle("Reject Plan"));
      await waitFor(() => {
        expect(mockApi.rejectPlan).toHaveBeenCalledWith("r1");
      });
      expect(onAction).toHaveBeenCalledTimes(2);
    });

    it("ReadyForHumanReview shows an approve icon calling api.approveReview", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      renderTable([makeRun({ id: "r1", state: "ReadyForHumanReview" })], onAction);

      await user.click(screen.getByTitle("Approve & Complete"));
      await waitFor(() => {
        expect(mockApi.approveReview).toHaveBeenCalledWith("r1");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("an active-category state shows a pause icon calling api.pauseRun", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      renderTable([makeRun({ id: "r1", state: "Implementing" })], onAction);

      await user.click(screen.getByTitle("Pause Run"));
      await waitFor(() => {
        expect(mockApi.pauseRun).toHaveBeenCalledWith("r1");
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it.each(["AIBlocked", "HumanClarificationNeeded"])(
      "%s shows a resume icon calling api.resumeRun",
      async (state) => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        renderTable([makeRun({ id: "r1", state })], onAction);

        await user.click(screen.getByTitle("Resume Run"));
        await waitFor(() => {
          expect(mockApi.resumeRun).toHaveBeenCalledWith("r1");
        });
        expect(onAction).toHaveBeenCalledTimes(1);
      },
    );

    it("does not render action icons for a state with no applicable action", () => {
      renderTable([makeRun({ id: "r1", state: "Done" })]);
      expect(screen.queryByTitle("Approve Plan")).toBeNull();
      expect(screen.queryByTitle("Reject Plan")).toBeNull();
      expect(screen.queryByTitle("Approve & Complete")).toBeNull();
      expect(screen.queryByTitle("Pause Run")).toBeNull();
      expect(screen.queryByTitle("Resume Run")).toBeNull();
    });

    it("does not throw or propagate when the API call rejects", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      mockApi.approvePlan.mockRejectedValue(new Error("network error"));
      renderTable([makeRun({ id: "r1", state: "AwaitingPlanApproval" })], onAction);

      await user.click(screen.getByTitle("Approve Plan"));

      await waitFor(() => {
        expect(mockApi.approvePlan).toHaveBeenCalledWith("r1");
      });
      // onAction is only called after a successful await, so it must not fire
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  it("renders a Link to /runs/:id for row navigation", () => {
    renderTable([makeRun({ id: "run-abc", linearIssueTitle: "Some issue" })]);
    const link = screen.getByRole("link", { name: "Some issue" });
    expect(link.getAttribute("href")).toBe("/runs/run-abc");
  });
});
