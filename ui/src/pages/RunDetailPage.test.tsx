import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

// Avoid exercising every sub-component's internals here — those have their
// own dedicated test files. We stub them to keep this page test focused on
// RunDetailPage's own composition/branch logic (loading/error states, which
// panels render for which run state, question extraction from the Plan
// artifact, etc).
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: () => <div data-testid="action-bar" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-12345678",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "acme/widgets",
    branchName: "feature/fix",
    prNumber: 7,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-1"]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunSkillsMock.mockReturnValue({ data: null, loading: false, error: null });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the run fails to load", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Run not found",
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("shows a generic 'Run not found' message when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders run header details once loaded", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Fix the bug")).toBeDefined();
    expect(screen.getByText("acme/widgets")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByText("PR #7")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("action-bar")).toBeDefined();
  });

  it("falls back to the issue identifier when there is no title", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9" }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("ENG-9")).toBeDefined();
  });

  it("falls back to the issue id prefix when neither title nor identifier exist", () => {
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({
          linearIssueTitle: null,
          linearIssueIdentifier: null,
          linearIssueId: "abcdefgh12345",
        }),
        artifacts: [],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("does not render branch/PR/open-in-editor links when branchName is absent", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ branchName: null, prNumber: null }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText("PR #7")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("shows the HumanClarificationNeeded questions panel prominently when there are open questions", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "What env?", requiredForExecution: true },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("What env?")).toBeDefined();
  });

  it("shows optional questions panel for AwaitingPlanApproval when optional questions exist", () => {
    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required one", requiredForExecution: true },
          { id: "q2", question: "Optional one", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "AwaitingPlanApproval" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Optional one")).toBeDefined();
    expect(screen.queryByText("Required one")).toBeNull();
  });

  it("does not render a questions panel when there is no Plan artifact", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun({ state: "HumanClarificationNeeded" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByText(/Open Questions/)).toBeNull();
  });

  it("passes distilled skill data from useRunSkills through to the panel", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRunSkillsMock.mockReturnValue({
      data: { injectedSkills: [], distillationDecision: null, distilledSkill: null },
      loading: false,
      error: null,
    });
    renderPage();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });

  it("scrolls the open-questions panel into view when the real ActionBar requests it", async () => {
    vi.doUnmock("@/components/ActionBar.tsx");
    vi.resetModules();
    const { RunDetailPage: PageWithRealActionBar } = await import("./RunDetailPage.tsx");
    const userEventModule = await import("@testing-library/user-event");

    const planArtifact: Artifact = {
      id: "a1",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [{ id: "q1", question: "What env?", requiredForExecution: true }],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue({
      data: {
        run: makeRun({ state: "HumanClarificationNeeded" }),
        artifacts: [planArtifact],
        events: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <MemoryRouter initialEntries={["/runs/run-1"]}>
        <Routes>
          <Route path="/runs/:id" element={<PageWithRealActionBar />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEventModule.default.click(
      screen.getByRole("button", { name: /Answer Questions/i }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    vi.doMock("@/components/ActionBar.tsx", () => ({
      ActionBar: () => <div data-testid="action-bar" />,
    }));
  });

  it("includes extra editor/Linear/PR links when the run has them", () => {
    useRunMock.mockReturnValue({
      data: { run: makeRun(), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByTitle("Open in Linear")).toBeDefined();
    expect(screen.getByTitle("Open PR on GitHub")).toBeDefined();
    expect(screen.getByTitle("Open in Cursor")).toBeDefined();
    expect(screen.getByTitle("Open Claude Code session in this run's worktree")).toBeDefined();
    expect(screen.getByTitle("Open Claude Desktop (Code) in this run's worktree")).toBeDefined();
  });
});
