import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Run, Artifact, RunEventRecord } from "@/api/client.ts";

const useRunMock = vi.fn();
const useActiveProcessesMock = vi.fn();
const useRunSkillsMock = vi.fn();

vi.mock("@/hooks/useRun.ts", () => ({
  useRun: (id: string) => useRunMock(id),
}));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({
  useActiveProcesses: (id: string) => useActiveProcessesMock(id),
}));
vi.mock("@/hooks/useRunSkills.ts", () => ({
  useRunSkills: (id: string) => useRunSkillsMock(id),
}));

// ChatPanel and ActionBar use `useSSE` via neither — they're rendered for
// real, but to keep this test focused on RunDetailPage's own composition
// (not re-testing ChatPanel's internals, covered by ChatPanel.test.tsx) we
// mock it to a simple marker that still reflects the props it was given.
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: ({ runId, artifacts }: { runId: string; artifacts: Artifact[] }) => (
    <div data-testid="chat-panel">
      chat-panel:{runId}:{artifacts.length}
    </div>
  ),
}));

import { RunDetailPage } from "./RunDetailPage.tsx";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "run-abcdef12",
    linearIssueId: "issue-abcdef12",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Fix the flaky test",
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "artifact-1",
    runId: "run-abcdef12",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-abcdef12",
    eventType: "RUN_REQUESTED",
    source: "system",
    payloadJson: {},
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const defaultProcesses = { processes: [], hasActive: false, output: "", activeProcessId: null };
const defaultSkills = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

describe("RunDetailPage", () => {
  beforeEach(() => {
    useRunMock.mockReset();
    useActiveProcessesMock.mockReset();
    useRunSkillsMock.mockReset();
    useActiveProcessesMock.mockReturnValue(defaultProcesses);
    useRunSkillsMock.mockReturnValue(defaultSkills);
    // jsdom does not implement scrollIntoView; ChatPanel/ActionBar's
    // scroll-to-questions wiring calls it directly.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the loading indicator while the run is loading", () => {
    useRunMock.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });

    renderAt("/runs/run-1");

    expect(screen.getByText(/loading run/i)).toBeDefined();
  });

  it("shows the error message when the hook reports an error", () => {
    useRunMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Run fetch failed",
      refetch: vi.fn(),
    });

    renderAt("/runs/run-1");

    expect(screen.getByText("Run fetch failed")).toBeDefined();
  });

  it("shows a 'Run not found' fallback when there's no error but also no data", () => {
    useRunMock.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });

    renderAt("/runs/run-1");

    expect(screen.getByText(/run not found/i)).toBeDefined();
  });

  it("renders run header details: id, issue identifier, repo, created timestamp", () => {
    const run = makeRun({});
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText(run.id.slice(0, 8))).toBeDefined();
    expect(screen.getByText(run.linearIssueTitle!)).toBeDefined();
    expect(screen.getByText(run.repo)).toBeDefined();
    expect(screen.getByText(/created/i)).toBeDefined();
    // No branch/PR/Linear-URL/editor links since those fields are null
    expect(screen.queryByTitle("Open in Linear")).toBeNull();
    expect(screen.queryByTitle("Open PR on GitHub")).toBeNull();
    expect(screen.queryByTitle("Open in Cursor")).toBeNull();
  });

  it("renders Linear link, PR link, branch and editor links when all optional fields are present", () => {
    const run = makeRun({
      linearIssueUrl: "https://linear.app/acme/issue/ENG-42",
      branchName: "feature/foo",
      prNumber: 7,
      workingDirectory: "/home/user/work/acme-repo",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    const linearLink = screen.getByTitle("Open in Linear") as HTMLAnchorElement;
    expect(linearLink.href).toBe(run.linearIssueUrl);

    const prLink = screen.getByTitle("Open PR on GitHub") as HTMLAnchorElement;
    expect(prLink.href).toBe(`https://github.com/${run.repo}/pull/7`);

    expect(screen.getByText("feature/foo")).toBeDefined();

    const cursorLink = screen.getByTitle("Open in Cursor") as HTMLAnchorElement;
    expect(cursorLink.href).toContain("cursor://file");

    const claudeCliLink = screen.getByTitle(/Open Claude Code session/i) as HTMLAnchorElement;
    expect(claudeCliLink.href).toContain("claude-cli://open");

    const claudeDesktopLink = screen.getByTitle(/Open Claude Desktop/i) as HTMLAnchorElement;
    expect(claudeDesktopLink.href).toContain("claude://code/new");
  });

  it("falls back from issue title to identifier to raw id when title is missing", () => {
    const run = makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-99" });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");
    expect(screen.getByText("ENG-99")).toBeDefined();
  });

  it("falls back all the way to the raw linearIssueId when both title and identifier are missing", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueId: "issue-abcdefgh-raw",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");
    expect(screen.getByText(run.linearIssueId.slice(0, 8))).toBeDefined();
  });

  it("wires artifacts through to ChatPanel and ArtifactTabs", () => {
    const run = makeRun({});
    const artifacts = [
      makeArtifact({ id: "a1", type: "Plan", payloadJson: { openQuestions: [] } }),
      makeArtifact({ id: "a2", type: "ChatMessage", payloadJson: { role: "user", content: "hi" } }),
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByTestId("chat-panel").textContent).toBe(
      `chat-panel:${run.id}:2`,
    );
    // ArtifactTabs renders a "Plan" tab since a Plan artifact is present
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
  });

  it("shows the required open-questions panel when state is HumanClarificationNeeded", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required one?", requiredForExecution: true },
            { id: "q2", question: "Optional one?", requiredForExecution: false },
          ],
        },
      }),
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    // The Plan artifact tab (rendered by ArtifactTabs/PlanView) also lists
    // open questions, so scope the assertion to the dedicated panel.
    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).getByText("Required one?")).toBeDefined();
    expect(within(panel).getByText("Optional one?")).toBeDefined();
  });

  it("shows only optional open-questions when state is AwaitingPlanApproval", () => {
    const run = makeRun({ state: "AwaitingPlanApproval" });
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: {
          openQuestions: [
            { id: "q1", question: "Required one?", requiredForExecution: true },
            { id: "q2", question: "Optional one?", requiredForExecution: false },
          ],
        },
      }),
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    const panel = screen.getByRole("region", { name: "Open Questions" });
    expect(within(panel).queryByText("Required one?")).toBeNull();
    expect(within(panel).getByText("Optional one?")).toBeDefined();
  });

  it("renders no open-questions panel when there are none, or the artifact payload lacks them", () => {
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [makeArtifact({ id: "a1", type: "Plan", payloadJson: {} })];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.queryByText(/Required|Optional/)).toBeNull();
  });

  it("clicking ActionBar's 'Answer Questions' scrolls the questions panel into view", async () => {
    const user = userEvent.setup();
    const run = makeRun({ state: "HumanClarificationNeeded" });
    const artifacts = [
      makeArtifact({
        id: "a1",
        type: "Plan",
        payloadJson: {
          openQuestions: [{ id: "q1", question: "Required one?", requiredForExecution: true }],
        },
      }),
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts, events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    await user.click(screen.getByRole("button", { name: /answer questions/i }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("passes active-process output through to AgentOutputPanel", () => {
    const run = makeRun({});
    useActiveProcessesMock.mockReturnValue({
      processes: [
        {
          id: "p1",
          pid: 123,
          command: "claude",
          runId: run.id,
          stage: "Implementing",
          runtime: "claude",
          startedAt: "2024-01-01T00:00:00Z",
          elapsedMs: 0,
        },
      ],
      hasActive: true,
      output: "hello from agent",
      activeProcessId: "p1",
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText(/hello from agent/i)).toBeDefined();
  });

  it("renders the loading state of DistilledSkillPanel from useRunSkills", () => {
    const run = makeRun({});
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("renders the error state of DistilledSkillPanel from useRunSkills", () => {
    const run = makeRun({});
    useRunSkillsMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Skills fetch failed",
      refetch: vi.fn(),
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText("Skills fetch failed")).toBeDefined();
  });

  it("renders the distilled skill content from useRunSkills when present", () => {
    const run = makeRun({});
    useRunSkillsMock.mockReturnValue({
      data: {
        injectedSkills: [],
        distillationDecision: {
          shouldPersist: true,
          reason: "worth it",
          taskCategory: "testing",
          name: "my-skill",
          description: "desc",
          displacedSkillId: null,
        },
        distilledSkill: {
          id: "skill-1",
          repoSlug: "acme/repo",
          name: "my-skill",
          description: "desc",
          taskCategory: "testing",
          skillMarkdown: "# hi",
          utilityScore: 0,
          lastUsedAt: "2024-01-01T00:00:00Z",
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText("my-skill")).toBeDefined();
    expect(screen.getByText("Distilled Skill")).toBeDefined();
  });

  it("renders EventTimeline and WorkflowStepper from the fetched events", () => {
    const run = makeRun({});
    const events = [
      makeEvent({ id: "e1", eventType: "RUN_REQUESTED" }),
      makeEvent({ id: "e2", eventType: "PLAN_CREATED" }),
    ];
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    expect(screen.getByText("Events")).toBeDefined();
    expect(screen.getByText("Workflow")).toBeDefined();
    expect(screen.getByText(/run requested/i)).toBeDefined();
  });

  it("renders the back-to-dashboard link", () => {
    const run = makeRun({});
    useRunMock.mockReturnValue({
      data: { run, artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderAt("/runs/run-abcdef12");

    const backLink = screen.getAllByRole("link")[0] as HTMLAnchorElement;
    expect(backLink.getAttribute("href")).toBe("/");
  });
});
