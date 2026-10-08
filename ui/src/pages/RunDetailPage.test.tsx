import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();
vi.mock("@/hooks/useRun.ts", () => ({ useRun: (id: string) => useRunMock(id) }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: (id: string) => useRunSkillsMock(id) }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));
vi.mock("@/api/client.ts", () => ({ api: {} }));

// Child components with their own suites are stubbed to expose the props the
// page passes them.
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (p: { questions: { id: string }[]; runState: string; onSubmitted: () => void }) => (
    <div data-testid="questions">
      {p.runState}:{p.questions.map((q) => q.id).join(",")}
      <button onClick={p.onSubmitted}>submit-questions</button>
    </div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (p: { runId: string; artifacts: unknown[] }) => (
    <div data-testid="chat">
      chat:{p.runId}:{p.artifacts.length}
    </div>
  ),
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (p: {
    distilledSkill: { name: string } | null;
    distillationDecision: unknown;
    loading: boolean;
    error: string | null;
  }) => (
    <div data-testid="skills">
      {JSON.stringify({
        skill: p.distilledSkill?.name ?? null,
        decision: p.distillationDecision,
        loading: p.loading,
        error: p.error,
      })}
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-12345678-abcd",
    linearIssueId: "lin-abcdefgh-123",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/dir x",
    latestArtifactVersion: 0,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function planArtifact(openQuestions: unknown[]): Artifact {
  return {
    id: "art-1",
    runId: "run-12345678-abcd",
    type: "Plan",
    version: 1,
    payloadJson: { summary: "Plan summary", openQuestions },
    rawText: "",
    createdAt: "2026-01-01T10:00:00Z",
  };
}

let refetch: ReturnType<typeof vi.fn>;

function setData(run: Run, artifacts: Artifact[] = [], events = []) {
  useRunMock.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch });
}

function renderPage(id = "run-12345678-abcd") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/" element={<div>dashboard-home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  refetch = vi.fn();
  useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
  useActiveProcessesMock.mockReturnValue({ processes: [], output: "" });
});

describe("RunDetailPage", () => {
  it("passes the route id to all hooks and shows loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch });
    renderPage("xyz");
    expect(screen.getByText("Loading run...")).toBeTruthy();
    expect(useRunMock).toHaveBeenCalledWith("xyz");
    expect(useRunSkillsMock).toHaveBeenCalledWith("xyz");
    expect(useActiveProcessesMock).toHaveBeenCalledWith("xyz");
  });

  it("shows the error message", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: "Boom", refetch });
    renderPage();
    expect(screen.getByText("Boom")).toBeTruthy();
  });

  it("shows 'Run not found' when there is no data and no error", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch });
    renderPage();
    expect(screen.getByText("Run not found")).toBeTruthy();
  });

  it("renders the minimal header without optional links", () => {
    setData(makeRun());
    renderPage();
    expect(screen.getByText("Run Detail")).toBeTruthy();
    expect(screen.getByText("run-1234")).toBeTruthy();
    expect(screen.getByText("lin-abcd")).toBeTruthy();
    expect(screen.getByText("org/repo")).toBeTruthy();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
    expect(screen.getByText(/^Created /)).toBeTruthy();
    // composed children render
    expect(screen.getByText("Workflow")).toBeTruthy();
    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.getByText(/No artifacts yet/)).toBeTruthy();
    expect(screen.getByTestId("chat").textContent).toBe("chat:run-12345678-abcd:0");
    expect(screen.queryByTestId("questions")).toBeNull();
  });

  it("renders issue title, Linear, PR, branch and editor links", () => {
    setData(
      makeRun({
        linearIssueTitle: "Fix the bug",
        linearIssueIdentifier: "ENG-9",
        linearIssueUrl: "https://linear.app/i/ENG-9",
        branchName: "feat/x",
        prNumber: 17,
      }),
    );
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeTruthy();
    expect(screen.getByTitle("Open in Linear").getAttribute("href")).toBe("https://linear.app/i/ENG-9");
    expect(screen.getByTitle("Open PR on GitHub").getAttribute("href")).toBe(
      "https://github.com/org/repo/pull/17",
    );
    expect(screen.getByText("PR #17")).toBeTruthy();
    expect(screen.getByText("feat/x")).toBeTruthy();
    expect(screen.getByTitle("Open in Cursor").getAttribute("href")).toBe("cursor://file/work/dir x");
    expect(screen.getByTitle(/Open Claude Code session/).getAttribute("href")).toBe(
      "claude-cli://open?cwd=%2Fwork%2Fdir%20x",
    );
    expect(screen.getByTitle(/Open Claude Desktop/).getAttribute("href")).toBe(
      "claude://code/new?folder=%2Fwork%2Fdir%20x",
    );
  });

  it("falls back to the issue identifier when there is no title", () => {
    setData(makeRun({ linearIssueIdentifier: "ENG-3" }));
    renderPage();
    expect(screen.getByText("ENG-3")).toBeTruthy();
  });

  it("hides editor links when there is no working directory", () => {
    setData(makeRun({ branchName: "b", workingDirectory: "" }));
    renderPage();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("passes skills data through to the distilled skill panel", () => {
    setData(makeRun());
    useRunSkillsMock.mockReturnValue({
      data: {
        injectedSkills: [],
        distilledSkill: { name: "my-skill" },
        distillationDecision: { shouldPersist: true },
      },
      loading: true,
      error: "partial",
    });
    renderPage();
    expect(JSON.parse(screen.getByTestId("skills").textContent!)).toEqual({
      skill: "my-skill",
      decision: { shouldPersist: true },
      loading: true,
      error: "partial",
    });
  });

  it("passes null skill props when skills data is absent", () => {
    setData(makeRun());
    renderPage();
    expect(JSON.parse(screen.getByTestId("skills").textContent!)).toEqual({
      skill: null,
      decision: null,
      loading: false,
      error: null,
    });
  });

  it("renders agent output from active processes", () => {
    setData(makeRun());
    useActiveProcessesMock.mockReturnValue({ processes: [], output: "agent says hi" });
    renderPage();
    expect(screen.getByText("agent says hi")).toBeTruthy();
  });

  it("shows all questions for HumanClarificationNeeded and scrolls to them", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    setData(makeRun({ state: "HumanClarificationNeeded" }), [
      planArtifact([
        { id: "q1", question: "A?", requiredForExecution: true },
        { id: "q2", question: "B?", requiredForExecution: false },
      ]),
    ]);
    renderPage();
    expect(screen.getByTestId("questions").textContent).toContain("HumanClarificationNeeded:q1,q2");
    fireEvent.click(screen.getByText("submit-questions"));
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Answer Questions" }));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("does not show the questions panel for HumanClarificationNeeded with no questions", () => {
    setData(makeRun({ state: "HumanClarificationNeeded" }), [planArtifact([])]);
    renderPage();
    expect(screen.queryByTestId("questions")).toBeNull();
    // scrolling with no target is a safe no-op
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Answer Questions" }))).not.toThrow();
  });

  it("shows only optional questions when awaiting plan approval", () => {
    setData(makeRun({ state: "AwaitingPlanApproval" }), [
      planArtifact([
        { id: "q1", question: "A?", requiredForExecution: true },
        { id: "q2", question: "B?", requiredForExecution: false },
      ]),
    ]);
    renderPage();
    expect(screen.getByTestId("questions").textContent).toContain("AwaitingPlanApproval:q2");
    expect(screen.getByRole("button", { name: "Answer Optional Questions" })).toBeTruthy();
  });

  it("hides optional questions UI when all questions are required", () => {
    setData(makeRun({ state: "AwaitingPlanApproval" }), [
      planArtifact([{ id: "q1", question: "A?", requiredForExecution: true }]),
    ]);
    renderPage();
    expect(screen.queryByTestId("questions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer Optional Questions" })).toBeNull();
  });

  it("links back to the dashboard", () => {
    setData(makeRun());
    renderPage();
    fireEvent.click(screen.getAllByRole("link")[0]!);
    expect(screen.getByText("dashboard-home")).toBeTruthy();
  });
});
