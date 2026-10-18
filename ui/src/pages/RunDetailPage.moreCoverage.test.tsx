import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useParamsMock = vi.fn();
const useRunMock = vi.fn();
const useRunSkillsMock = vi.fn();
const useActiveProcessesMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => useParamsMock(),
  };
});

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));

vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));

vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: ({ state }: { state: string }) => (
    <div data-testid="state-badge">{state}</div>
  ),
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

// Capture the onScrollToQuestions callback so we can invoke scrollToQuestions
// directly, the way a real ActionBar's "Answer Questions" button would.
let capturedScrollToQuestions: (() => void) | null = null;
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: ({ onScrollToQuestions }: { onScrollToQuestions?: () => void }) => {
    capturedScrollToQuestions = onScrollToQuestions ?? null;
    return <div data-testid="action-bar" />;
  },
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-abc12345"]}>
      <RunDetailPage />
    </MemoryRouter>,
  );
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-abc12345",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "HumanClarificationNeeded",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Run;
}

function defaultActiveProcesses() {
  return { processes: [], hasActive: false, output: "", activeProcessId: null };
}

function defaultSkills() {
  return { data: null, loading: false, error: null, refetch: vi.fn() };
}

describe("RunDetailPage – additional branch coverage", () => {
  const originalScrollIntoView = (
    Element.prototype as unknown as { scrollIntoView?: () => void }
  ).scrollIntoView;
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    useParamsMock.mockReset();
    useRunMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReset();
    capturedScrollToQuestions = null;

    useParamsMock.mockReturnValue({ id: "run-abc12345" });
    useActiveProcessesMock.mockReturnValue(defaultActiveProcesses());
    useRunSkillsMock.mockReturnValue(defaultSkills());

    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      scrollIntoViewMock;
    scrollIntoViewMock.mockClear();
  });

  afterEach(() => {
    (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
      originalScrollIntoView;
  });

  it("scrolls the open-questions panel into view when scrollToQuestions is invoked", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [{ id: "q1", question: "What auth?", requiredForExecution: true }],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(capturedScrollToQuestions).not.toBeNull();
    act(() => {
      capturedScrollToQuestions!();
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("falls back to the issue identifier, then the truncated issue id, when the title is missing", () => {
    const run = makeRun({ linearIssueTitle: null, state: "Done" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] as RunEventRecord[] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("ENG-1")).toBeDefined();
  });

  it("falls back to a truncated issue id when both title and identifier are missing", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "abcdefgh12345",
      state: "Done",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("abcdefgh")).toBeDefined();
  });

  it("renders an external 'Linear' link when the run has a linearIssueUrl", () => {
    const run = makeRun({
      linearIssueUrl: "https://linear.app/team/issue/ENG-1",
      state: "Done",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const link = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(link.href).toBe("https://linear.app/team/issue/ENG-1");
  });
});
