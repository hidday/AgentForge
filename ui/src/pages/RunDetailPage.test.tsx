import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Run } from "@/api/client.ts";

const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (...args: unknown[]) => useRunMock(...args),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (...args: unknown[]) => useRunSkillsMock(...args),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (...args: unknown[]) => useActiveProcessesMock(...args),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => <div data-testid="state-badge">{state}</div>,
}));
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: () => <div data-testid="workflow-stepper" />,
}));
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: () => <div data-testid="artifact-tabs" />,
}));
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: () => <div data-testid="agent-output-panel" />,
}));
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions: () => void }) => (
    <button onClick={onScrollToQuestions}>scroll-to-questions</button>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: unknown[] }) => (
    <div data-testid="open-questions-panel">{questions.length} questions</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

const baseRun = {
  id: "run-1234567890",
  linearIssueId: "issue-1",
  linearIssueIdentifier: "ENG-1",
  linearIssueDescription: null,
  linearIssueTitle: "Fix the thing",
  linearIssueUrl: "https://linear.app/issue/ENG-1",
  repo: "acme/repo",
  branchName: "agent/fix-thing",
  prNumber: 42,
  state: "Implementing",
  planVersion: 1,
  approvedPlanVersion: 1,
  plannerRuntime: "claude",
  executorRuntime: "claude",
  reviewerRuntime: "claude",
  remediationRuntime: null,
  workingDirectory: "/tmp/wt",
  latestArtifactVersion: 1,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
} satisfies Run;

interface RunHookResult {
  data: { run: Run; artifacts: unknown[]; events: unknown[] } | null;
  loading: boolean;
  error: string | null;
  refetch: ReturnType<typeof vi.fn>;
}

function defaultRunHookResult(overrides: Partial<RunHookResult> = {}): RunHookResult {
  return { ...baseRunHook(), ...overrides };
}

function baseRunHook(): RunHookResult {
  return {
    data: { run: baseRun, artifacts: [], events: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderPage(id = "run-1234567890") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: false,
      error: null,
    });
    useActiveProcessesMock.mockReturnValue({
      processes: [],
      hasActive: false,
      output: "",
      activeProcessId: null,
    });
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue(defaultRunHookResult({ loading: true, data: null }));
    renderPage();
    expect(screen.getByText(/Loading run/i)).toBeDefined();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunMock.mockReturnValue(
      defaultRunHookResult({ error: "Run failed to load", data: null }),
    );
    renderPage();
    expect(screen.getByText("Run failed to load")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there's no error but also no data", () => {
    useRunMock.mockReturnValue(defaultRunHookResult({ error: null, data: null }));
    renderPage();
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the run header and main panels once loaded", () => {
    useRunMock.mockReturnValue(defaultRunHookResult());
    renderPage();

    expect(screen.getByText("Run Detail")).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByTestId("state-badge").textContent).toBe("Implementing");
    expect(screen.getByTestId("workflow-stepper")).toBeDefined();
    expect(screen.getByTestId("artifact-tabs")).toBeDefined();
    expect(screen.getByTestId("agent-output-panel")).toBeDefined();
    expect(screen.getByTestId("event-timeline")).toBeDefined();
    expect(screen.getByTestId("chat-panel")).toBeDefined();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
    expect(screen.getByRole("link", { name: /Linear/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /PR #42/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Cursor/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Claude Code/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^Claude$/i })).toBeDefined();
  });

  it("falls back to linearIssueIdentifier then to a truncated id when there's no title", () => {
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: {
          run: { ...baseRun, linearIssueTitle: null },
          artifacts: [],
          events: [],
        },
      }),
    );
    renderPage();
    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated linearIssueId when neither title nor identifier exist", () => {
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: {
          run: {
            ...baseRun,
            linearIssueTitle: null,
            linearIssueIdentifier: null,
            linearIssueUrl: null,
          },
          artifacts: [],
          events: [],
        },
      }),
    );
    renderPage();
    expect(screen.getByText(baseRun.linearIssueId.slice(0, 8))).toBeDefined();
    expect(screen.queryByRole("link", { name: /Linear/i })).toBeNull();
  });

  it("omits branch/PR/editor links when the run has no branch or PR", () => {
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: {
          run: {
            ...baseRun,
            branchName: null,
            prNumber: null,
            workingDirectory: "",
          },
          artifacts: [],
          events: [],
        },
      }),
    );
    renderPage();
    expect(screen.queryByRole("link", { name: /PR #/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Cursor/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Claude Code/i })).toBeNull();
  });

  it("shows the OpenQuestionsPanel with all open questions when state is HumanClarificationNeeded", () => {
    const planArtifact = {
      id: "a1",
      runId: baseRun.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Q1?", requiredForExecution: true },
          { id: "q2", question: "Q2?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: {
          run: { ...baseRun, state: "HumanClarificationNeeded" },
          artifacts: [planArtifact],
          events: [],
        },
      }),
    );
    renderPage();
    const panels = screen.getAllByTestId("open-questions-panel");
    expect(panels[0].textContent).toContain("2 questions");
  });

  it("shows only optional questions in AwaitingPlanApproval state, and wires scrollToQuestions", async () => {
    const user = userEvent.setup();
    const planArtifact = {
      id: "a1",
      runId: baseRun.id,
      type: "Plan",
      version: 1,
      payloadJson: {
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Optional?", requiredForExecution: false },
        ],
      },
      rawText: "",
      createdAt: "2024-01-01T00:00:00Z",
    };
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: {
          run: { ...baseRun, state: "AwaitingPlanApproval" },
          artifacts: [planArtifact],
          events: [],
        },
      }),
    );
    renderPage();
    const panel = screen.getByTestId("open-questions-panel");
    expect(panel.textContent).toContain("1 questions");

    // scrollIntoView isn't implemented in jsdom; stub it so the click handler
    // (wired through ActionBar's onScrollToQuestions) doesn't throw.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    await user.click(screen.getByRole("button", { name: "scroll-to-questions" }));
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("renders no OpenQuestionsPanel when there is no Plan artifact", () => {
    useRunMock.mockReturnValue(
      defaultRunHookResult({
        data: { run: { ...baseRun, state: "HumanClarificationNeeded" }, artifacts: [], events: [] },
      }),
    );
    renderPage();
    expect(screen.queryByTestId("open-questions-panel")).toBeNull();
  });

  it("passes skills data and loading/error state down to DistilledSkillPanel", () => {
    useRunMock.mockReturnValue(defaultRunHookResult());
    useRunSkillsMock.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: { id: "s1" },
      },
      loading: true,
      error: "skills error",
    });
    renderPage();
    expect(screen.getByTestId("distilled-skill-panel")).toBeDefined();
  });
});
