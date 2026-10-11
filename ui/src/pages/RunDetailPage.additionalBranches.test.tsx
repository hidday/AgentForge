import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/hooks/useRun.ts", () => ({ useRun: vi.fn() }));
vi.mock("@/hooks/useActiveProcesses.ts", () => ({ useActiveProcesses: vi.fn() }));
vi.mock("@/hooks/useRunSkills.ts", () => ({ useRunSkills: vi.fn() }));

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
  ActionBar: ({
    onScrollToQuestions,
  }: {
    onScrollToQuestions: () => void;
    hasOptionalQuestions: boolean;
  }) => (
    <div data-testid="action-bar">
      <button onClick={onScrollToQuestions}>scroll-to-questions</button>
    </div>
  ),
}));
vi.mock("@/components/OpenQuestionsPanel.tsx", () => ({
  OpenQuestionsPanel: ({ questions }: { questions: { id: string }[] }) => (
    <div data-testid="open-questions-panel">{questions.map((q) => q.id).join(",")}</div>
  ),
}));
vi.mock("@/components/ChatPanel.tsx", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));
vi.mock("@/components/DistilledSkillPanel.tsx", () => ({
  DistilledSkillPanel: () => <div data-testid="distilled-skill-panel" />,
}));

import { useRun } from "@/hooks/useRun.ts";
import { useActiveProcesses } from "@/hooks/useActiveProcesses.ts";
import { useRunSkills } from "@/hooks/useRunSkills.ts";
import { RunDetailPage } from "./RunDetailPage.tsx";

const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseActiveProcesses = useActiveProcesses as unknown as ReturnType<typeof vi.fn>;
const mockUseRunSkills = useRunSkills as unknown as ReturnType<typeof vi.fn>;

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-abc12345",
    repo: "org/repo",
    state: "Implementing",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ISSUE-1",
    linearIssueTitle: null,
    linearIssueUrl: null,
    branchName: null,
    workingDirectory: null,
    prNumber: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRoute(id = "run-abc12345") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${id}`]}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveProcesses.mockReturnValue({ processes: [], hasActive: false, output: "", activeProcessId: null });
    mockUseRunSkills.mockReturnValue({ data: null, loading: false, error: null });
  });

  it("scrolls the open-questions container into view when the action bar requests it", async () => {
    const planArtifact = {
      id: "a1",
      type: "Plan",
      payloadJson: {
        openQuestions: [{ id: "q1", question: "Q1", requiredForExecution: true }],
      },
    };
    mockUseRun.mockReturnValue({
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
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      renderWithRoute();

      await userEvent.click(screen.getByText("scroll-to-questions"));

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("does nothing (no crash) when scroll is requested but the questions ref never mounted", async () => {
    // No HumanClarificationNeeded/AwaitingPlanApproval state and no open
    // questions, so the ref-bearing <div> around OpenQuestionsPanel never
    // renders — questionsRef.current stays null.
    mockUseRun.mockReturnValue({
      data: { run: makeRun({ state: "Implementing" }), artifacts: [], events: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      renderWithRoute();

      await userEvent.click(screen.getByText("scroll-to-questions"));

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
