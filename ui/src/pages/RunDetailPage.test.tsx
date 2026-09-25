import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useParamsMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => useParamsMock(),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const useRunMock = vi.fn();
vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));

const useRunSkillsMock = vi.fn();
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));

const useActiveProcessesMock = vi.fn();
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));

const stateBadgeMock = vi.fn();
vi.mock("@/components/StateBadge.tsx", () => ({
  StateBadge: (props: unknown) => {
    stateBadgeMock(props);
    return <div data-testid="state-badge-marker" />;
  },
}));

const workflowStepperMock = vi.fn();
vi.mock("@/components/WorkflowStepper.tsx", () => ({
  WorkflowStepper: (props: unknown) => {
    workflowStepperMock(props);
    return <div data-testid="workflow-stepper-marker" />;
  },
}));

const artifactTabsMock = vi.fn();
vi.mock("@/components/ArtifactTabs.tsx", () => ({
  ArtifactTabs: (props: unknown) => {
    artifactTabsMock(props);
    return <div data-testid="artifact-tabs-marker" />;
  },
}));

const agentOutputPanelMock = vi.fn();
vi.mock("@/components/AgentOutputPanel.tsx", () => ({
  AgentOutputPanel: (props: unknown) => {
    agentOutputPanelMock(props);
    return <div data-testid="agent-output-panel-marker" />;
  },
}));

const eventTimelineMock = vi.fn();
vi.mock("@/components/EventTimeline.tsx", () => ({
  EventTimeline: (props: unknown) => {
    eventTimelineMock(props);
    return <div data-testid="event-timeline-marker" />;
  },
}));

const actionBarMock = vi.fn();
vi.mock("@/components/ActionBar.tsx", () => ({
  ActionBar: (props: unknown) => {
    actionBarMock(props);
    return <div data-testid="action-bar-marker" />;
  },
}));

const openQuestionsPanelMock = vi.fn();
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: (props: unknown) => {
    openQuestionsPanelMock(props);
    return <div data-testid="open-questions-panel-marker" />;
  },
}));

const chatPanelMock = vi.fn();
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: (props: unknown) => {
    chatPanelMock(props);
    return <div data-testid="chat-panel-marker" />;
  },
}));

const distilledSkillPanelMock = vi.fn();
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: (props: unknown) => {
    distilledSkillPanelMock(props);
    return <div data-testid="distilled-skill-panel-marker" />;
  },
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-abc12345",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "org/repo",
    branchName: "feature/fix",
    prNumber: 42,
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
  } as Run;
}

const NO_PROCESSES = { processes: [], hasActive: false, output: "", activeProcessId: null };

function defaultSkills() {
  return {
    data: { injectedSkills: [], distillationDecision: null, distilledSkill: null },
    loading: false,
    error: null,
  };
}

describe("RunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useParamsMock.mockReturnValue({ id: "run-abc12345" });
    useRunSkillsMock.mockReturnValue(defaultSkills());
    useActiveProcessesMock.mockReturnValue(NO_PROCESSES);
  });

  it("reads the ':id' route param and passes it to useRun and useRunSkills", () => {
    useParamsMock.mockReturnValue({ id: "my-run-id" });
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    render(<RunDetailPage />);

    expect(useRunMock).toHaveBeenCalledWith("my-run-id");
    expect(useRunSkillsMock).toHaveBeenCalledWith("my-run-id");
    expect(useActiveProcessesMock).toHaveBeenCalledWith("my-run-id");
  });

  it("shows a loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    render(<RunDetailPage />);
    expect(screen.getByText(/loading run/i)).toBeDefined();
    expect(screen.queryByTestId("workflow-stepper-marker")).toBeNull();
  });

  it("shows an error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Network error",
      refetch: vi.fn(),
    });
    render(<RunDetailPage />);
    expect(screen.getByText("Network error")).toBeDefined();
  });

  it("shows a 'Run not found' fallback message when there is no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    render(<RunDetailPage />);
    expect(screen.getByText("Run not found")).toBeDefined();
  });

  it("renders the full layout with run data: header fields, state badge, child components", () => {
    const run = makeRun({});
    const artifacts: Artifact[] = [];
    const events: RunEventRecord[] = [];
    const refetch = vi.fn();
    useRunMock.mockReturnValue({ data: { run, artifacts, events }, loading: false, error: null, refetch });

    render(<RunDetailPage />);

    // Header content derived from run fields
    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText("Fix the thing")).toBeDefined();
    expect(screen.getByText("org/repo")).toBeDefined();
    expect(screen.getByText("feature/fix")).toBeDefined();
    expect(screen.getByText("PR #42")).toBeDefined();

    // Child components rendered with correct props
    expect(workflowStepperMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentState: "Implementing", events }),
    );
    expect(artifactTabsMock).toHaveBeenCalledWith(expect.objectContaining({ artifacts }));
    expect(eventTimelineMock).toHaveBeenCalledWith(expect.objectContaining({ events }));
    expect(chatPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, artifacts }),
    );
    expect(actionBarMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, state: "Implementing", onAction: refetch }),
    );
    expect(stateBadgeMock).toHaveBeenCalledWith(expect.objectContaining({ state: "Implementing" }));
  });

  it("extracts open questions from the Plan artifact and passes them to OpenQuestionsPanel in HumanClarificationNeeded state", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
        type: "Plan",
        version: 1,
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "What auth?", requiredForExecution: true },
            { id: "q2", question: "Which env?", requiredForExecution: false },
          ],
        },
        rawText: "",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<RunDetailPage />);

    expect(openQuestionsPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          { id: "q1", question: "What auth?", requiredForExecution: true },
          { id: "q2", question: "Which env?", requiredForExecution: false },
        ],
        runId: run.id,
        readOnly: false,
        runState: "HumanClarificationNeeded",
      }),
    );
    // Only one panel expected here (the HumanClarificationNeeded prominent one)
    expect(openQuestionsPanelMock).toHaveBeenCalledTimes(1);
  });

  it("shows only optional open questions in AwaitingPlanApproval state", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts: Artifact[] = [
      {
        id: "a1",
        runId: run.id,
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
      },
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<RunDetailPage />);

    expect(openQuestionsPanelMock).toHaveBeenCalledTimes(1);
    expect(openQuestionsPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [{ id: "q2", question: "Optional one", requiredForExecution: false }],
        runState: "AwaitingPlanApproval",
      }),
    );
    expect(actionBarMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasOptionalQuestions: true }),
    );
  });

  it("does not render OpenQuestionsPanel when there is no Plan artifact or no questions", () => {
    const run = makeRun({ state: "Implementing" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<RunDetailPage />);

    expect(openQuestionsPanelMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("open-questions-panel-marker")).toBeNull();
    expect(actionBarMock).toHaveBeenCalledWith(
      expect.objectContaining({ hasOptionalQuestions: false }),
    );
  });

  it("passes distilled skill data and loading/error state to DistilledSkillPanel", () => {
    const run = makeRun({});
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRunSkillsMock.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: "distill",
        distilledSkill: { title: "Skill", content: "Do X" },
      },
      loading: true,
      error: "skill error",
    });

    render(<RunDetailPage />);

    expect(distilledSkillPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        distilledSkill: { title: "Skill", content: "Do X" },
        distillationDecision: "distill",
        loading: true,
        error: "skill error",
      }),
    );
  });

  it("passes active processes and output to AgentOutputPanel", () => {
    const run = makeRun({});
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const processes = [
      {
        id: "p1",
        pid: 123,
        command: "npm test",
        runId: run.id,
        stage: "Implementing",
        runtime: "claude",
        startedAt: "2024-01-01T00:00:00Z",
        elapsedMs: 1000,
      },
    ];
    useActiveProcessesMock.mockReturnValue({
      processes,
      hasActive: true,
      output: "some output",
      activeProcessId: "p1",
    });

    render(<RunDetailPage />);

    expect(agentOutputPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({ processes, output: "some output" }),
    );
  });

  it("does not render optional links (Linear/PR/Cursor/Claude) when their run fields are absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueUrl: null,
      branchName: null,
      prNumber: null,
      workingDirectory: "",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<RunDetailPage />);

    // Falls back to linearIssueId slice since title/identifier are null
    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });
});
