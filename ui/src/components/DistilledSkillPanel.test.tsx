import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

const decision: DistillationDecision = {
  shouldPersist: true,
  reason: "Non-trivial repo-specific insight.",
  taskCategory: "dev-env pause/resume tooling",
  name: "dev-env-pause-resume-footguns",
  description:
    "Use when changing prysmic dev-env pause/resume, deploy-while-paused behavior, or terraform_runner.",
  displacedSkillId: null,
};

const skill: SkillDocument = {
  id: "skill-1",
  repoSlug: "prysmic-ai/prysmic",
  name: "dev-env-pause-resume-footguns",
  description:
    "Use when changing prysmic dev-env pause/resume, deploy-while-paused behavior, or terraform_runner.",
  taskCategory: "dev-env pause/resume tooling",
  skillMarkdown: "# Pause/resume footguns\n\nAlways pass `-var-file`.",
  utilityScore: 0,
  lastUsedAt: "2026-06-08T16:26:58.000Z",
};

describe("DistilledSkillPanel", () => {
  it("renders nothing when distillation did not persist a skill", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          shouldPersist: false,
          reason: "novelty_gate_failed",
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders the skill name, description, markdown, and export preview", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText("Distilled Skill")).toBeDefined();
    expect(screen.getByText("dev-env-pause-resume-footguns")).toBeDefined();
    expect(screen.getAllByText(/Use when changing prysmic dev-env pause\/resume/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "# Pause/resume footguns",
    );
    expect(screen.getByText(/SKILL.md export preview/i)).toBeDefined();
    expect(screen.getByText(/name: dev-env-pause-resume-footguns/)).toBeDefined();
  });

  it("shows a fallback message when persistence succeeded but content is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
  });

  it("shows a loading indicator when loading is true, regardless of other props", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("falls back through the name/description chain when distilledSkill's fields are null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, description: null }}
        distillationDecision={{
          ...decision,
          name: "decision-level-name",
          description: "decision-level-description",
        }}
      />,
    );

    // distilledSkill.name/description are null, so the decision's values
    // should be used instead (the `??` fallback chain).
    expect(screen.getByText("decision-level-name")).toBeDefined();
    expect(screen.getByText("decision-level-description")).toBeDefined();
  });

  it("falls back to the distilledSkill's taskCategory when both names are null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "fallback-category" }}
        distillationDecision={{ ...decision, name: null, taskCategory: "unused-category" }}
      />,
    );

    expect(screen.getAllByText("fallback-category").length).toBeGreaterThan(0);
  });

  it("falls all the way back to 'distilled-skill' when no name or taskCategory is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows the displaced skill id when the distillation decision displaced a previous skill", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-123" }}
      />,
    );

    const displacedLine = screen.getByText(/Displaced skill:/);
    expect(displacedLine.textContent).toContain("old-skil");
  });

  it("shows the error message when error is set, taking priority over loading content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load distillation decision"
      />,
    );

    expect(screen.getByText("Failed to load distillation decision")).toBeDefined();
    expect(screen.queryByText(/loading distilled skill/i)).toBeNull();
  });
});
