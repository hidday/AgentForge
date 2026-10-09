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

  it("shows the loading spinner state and does not render skill content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        loading={true}
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("shows the error state in place of skill content, even when a skill would otherwise render", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
    expect(screen.queryByTestId("markdown-content")).toBeNull();
  });

  it("falls back to the distilled skill's own taskCategory when both name sources are absent", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "skill-task-category" }}
        distillationDecision={{ ...decision, name: null, taskCategory: "decision-task-category" }}
      />,
    );

    // distilledSkill?.name and distillationDecision.name are both null, so the
    // name falls through to distilledSkill's own taskCategory (checked before
    // distillationDecision's).
    expect(container.querySelector(".font-mono")?.textContent).toBe("skill-task-category");
  });

  it("falls back to distillationDecision.taskCategory, and omits description/preview, when neither skill nor decision has a name or description", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          taskCategory: "fallback-category",
          description: null,
        }}
      />,
    );

    expect(container.querySelector(".font-mono")?.textContent).toBe("fallback-category");
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("falls back to the literal 'distilled-skill' name when neither name nor taskCategory is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows the truncated displaced skill id when distillationDecision.displacedSkillId is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "abcdef1234567890" }}
      />,
    );

    expect(screen.getByText(/Displaced skill: abcdef12/)).toBeDefined();
  });
});
