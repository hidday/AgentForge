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
  it("shows a loading indicator when loading=true, regardless of other props", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading />,
    );
    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });

  it("shows the error message when error is set, taking priority over loading content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load distilled skill"
      />,
    );
    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
  });

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

  it("falls back through the name chain to distilledSkill.taskCategory when both names are absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "fallback-task-category" }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );

    expect(screen.getAllByText(/fallback-task-category/).length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' when no name/taskCategory is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows the displaced-skill id when the distillation decision displaced an existing skill", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "displaced-skill-12345" }}
      />,
    );

    expect(screen.getByText(/Displaced skill:/)).toBeDefined();
  });

  it("omits the description paragraph when no description is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    expect(screen.queryByText(/Use when changing prysmic/)).toBeNull();
    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
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
});
