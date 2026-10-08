import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunsMock = vi.fn();
vi.mock("@/hooks/useRuns.ts", () => ({ useRuns: () => useRunsMock() }));

vi.mock("@/api/client.ts", () => ({ api: {} }));

// LinearSyncDialog has its own test suite; stub it so the page test can drive
// its callbacks directly.
vi.mock("@/components/LinearSyncDialog.tsx", () => ({
  LinearSyncDialog: (props: {
    open: boolean;
    onClose: () => void;
    onIngested: () => void;
    onIngestComplete: (s: { started: number; skipped: number }) => void;
  }) =>
    props.open ? (
      <div data-testid="sync-dialog">
        <button onClick={props.onClose}>close-sync</button>
        <button onClick={props.onIngested}>ingested</button>
        <button onClick={() => props.onIngestComplete({ started: 2, skipped: 1 })}>complete</button>
      </div>
    ) : null,
}));

import { DashboardPage } from "./DashboardPage.tsx";

function run(id: string, state: string): Run {
  return {
    id,
    linearIssueId: `issue-${id}`,
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: `Title ${id}`,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state,
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
  };
}

const runs = [
  run("a", "Planning"),
  run("b", "Implementing"),
  run("c", "AwaitingPlanApproval"),
  run("d", "AIBlocked"),
  run("e", "Done"),
  run("f", "Todo"),
  run("g", "SomethingNew"),
];

let refetch: ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function stat(label: string) {
  return screen.getAllByText(label).find((e) => e.className.includes("text-text-muted"))!
    .previousElementSibling!.textContent;
}

function issueLinks() {
  return screen.queryAllByRole("link", { name: /^Title / }).map((l) => l.textContent);
}

beforeEach(() => {
  refetch = vi.fn();
  useRunsMock.mockReturnValue({ runs, loading: false, error: null, refetch });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardPage", () => {
  it("shows a loading state", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: true, error: null, refetch });
    renderPage();
    expect(screen.getByText("Loading runs...")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an error state", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: "Server down", refetch });
    renderPage();
    expect(screen.getByText("Server down")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("computes stats by category, counting unknown states as idle", () => {
    renderPage();
    expect(stat("Total")).toBe("7");
    expect(stat("Active")).toBe("2");
    expect(stat("Awaiting")).toBe("1");
    expect(stat("Blocked")).toBe("1");
    expect(stat("Done")).toBe("1");
  });

  it("shows zero stats with no runs", () => {
    useRunsMock.mockReturnValue({ runs: [], loading: false, error: null, refetch });
    renderPage();
    expect(stat("Total")).toBe("0");
    expect(stat("Active")).toBe("0");
    expect(screen.getByText("No runs found")).toBeTruthy();
  });

  it("filters the table by category", () => {
    renderPage();
    const filterBar = screen.getByRole("button", { name: "All" }).parentElement!;
    expect(issueLinks()).toHaveLength(7);
    expect(screen.getByRole("button", { name: "All" }).className).toContain("bg-accent");

    fireEvent.click(within(filterBar).getByRole("button", { name: "Active" }));
    expect(issueLinks()).toEqual(["Title a", "Title b"]);
    expect(within(filterBar).getByRole("button", { name: "Active" }).className).toContain("bg-accent");

    fireEvent.click(within(filterBar).getByRole("button", { name: "Awaiting Human" }));
    expect(issueLinks()).toEqual(["Title c"]);

    fireEvent.click(within(filterBar).getByRole("button", { name: "Blocked" }));
    expect(issueLinks()).toEqual(["Title d"]);

    fireEvent.click(within(filterBar).getByRole("button", { name: "Done" }));
    expect(issueLinks()).toEqual(["Title e"]);

    fireEvent.click(within(filterBar).getByRole("button", { name: "All" }));
    expect(issueLinks()).toHaveLength(7);
  });

  it("opens and closes the Linear sync dialog and wires onIngested to refetch", () => {
    renderPage();
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Linear" }));
    expect(screen.getByTestId("sync-dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("ingested"));
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("close-sync"));
    expect(screen.queryByTestId("sync-dialog")).toBeNull();
  });

  it("shows an ingest summary banner that auto-dismisses after 5s", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Linear" }));
    fireEvent.click(screen.getByText("complete"));
    expect(screen.getByRole("status").textContent).toBe("Started 2 runs, skipped 1");
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets the user dismiss the ingest banner manually", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Linear" }));
    fireEvent.click(screen.getByText("complete"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
