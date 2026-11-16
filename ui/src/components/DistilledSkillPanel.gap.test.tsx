import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("DistilledSkillPanel — loading and error states", () => {
  it("renders a loading indicator when loading is true, regardless of other props", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders the error message and nothing else when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch run skills"
      />,
    );

    expect(screen.getByText("Failed to fetch run skills")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
    expect(screen.queryByText(/loading distilled skill/i)).toBeNull();
  });

  it("prioritizes the loading state over an error, when both are somehow set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="should not show"
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("should not show")).toBeNull();
  });
});

describe("DistilledSkillPanel — displaced skill notice", () => {
  const decision: DistillationDecision = {
    shouldPersist: true,
    reason: "Replaces a stale skill.",
    taskCategory: "deploy",
    name: "deploy-skill",
    description: "How to deploy safely.",
    displacedSkillId: "displaced-skill-id-123",
  };

  const skill: SkillDocument = {
    id: "skill-2",
    repoSlug: "org/repo",
    name: "deploy-skill",
    description: "How to deploy safely.",
    taskCategory: "deploy",
    skillMarkdown: "# Deploy\n\nSteps here.",
    utilityScore: 0,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  };

  it("shows a truncated displaced-skill id when the decision displaced a prior skill", () => {
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);

    // The id is truncated to its first 8 characters.
    const notice = screen.getByText(/Displaced skill:/);
    expect(notice.textContent).toContain("displac");
    expect(notice.textContent).not.toContain("displaced-skill-id-123");
  });
});
