import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("DistilledSkillPanel – loading and error states", () => {
  it("shows a loading indicator when loading is true, regardless of decision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });

  it("shows the error message when error is set, taking precedence over the decision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load distillation decision"
      />,
    );

    expect(screen.getByText("Failed to load distillation decision")).toBeDefined();
    expect(screen.queryByText("Loading distilled skill...")).toBeNull();
  });
});

describe("DistilledSkillPanel – skillName/skillDescription fallback chain", () => {
  const baseSkill: SkillDocument = {
    id: "skill-1",
    repoSlug: "org/repo",
    name: null,
    description: null,
    taskCategory: "fallback-category",
    skillMarkdown: "# content",
    utilityScore: 0,
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  };

  const baseDecision: DistillationDecision = {
    shouldPersist: true,
    reason: "",
    taskCategory: null,
    name: null,
    description: null,
    displacedSkillId: null,
  };

  it("falls back to the skill's taskCategory when both names are missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, taskCategory: "from-skill" }}
        distillationDecision={{ ...baseDecision, taskCategory: "from-decision" }}
      />,
    );

    expect(screen.getAllByText("from-skill").length).toBeGreaterThan(0);
  });

  it("falls back to the decision's taskCategory when names and skill taskCategory are missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, taskCategory: null as unknown as string }}
        distillationDecision={{ ...baseDecision, taskCategory: "from-decision" }}
      />,
    );

    expect(screen.getAllByText("from-decision").length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' name when every source is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, taskCategory: null as unknown as string }}
        distillationDecision={{ ...baseDecision, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("omits the description paragraph and export preview when no description is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={baseSkill}
        distillationDecision={baseDecision}
      />,
    );

    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("shows the displaced skill id when the decision reports one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={baseSkill}
        distillationDecision={{ ...baseDecision, displacedSkillId: "abcd1234efgh5678" }}
      />,
    );

    expect(screen.getByText(/Displaced skill: abcd1234/)).toBeDefined();
  });
});
