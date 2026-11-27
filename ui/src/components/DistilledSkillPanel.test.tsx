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

  it("renders the loading state when loading is true, regardless of other props", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    // Nothing else is rendered while loading
    expect(container.textContent).not.toContain("Distilled Skill");
  });

  it("renders the error state and takes priority over loading/decision content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        loading={false}
        error="Could not load distilled skill"
      />,
    );

    expect(screen.getByText("Could not load distilled skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("falls back to taskCategory-derived name and omits the export preview when description is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          shouldPersist: true,
          reason: "",
          taskCategory: "fallback-category",
          name: null,
          description: null,
          displacedSkillId: null,
        }}
      />,
    );

    // name falls back to distillationDecision.taskCategory since both
    // distilledSkill and distillationDecision.name are absent. It's shown
    // twice (as the name and as the task-category subtitle).
    expect(screen.getAllByText("fallback-category").length).toBe(2);
    // No description -> no export preview, and no reason blockquote.
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("falls all the way back to the literal 'distilled-skill' name when nothing provides a name or category", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          shouldPersist: true,
          reason: "",
          taskCategory: null,
          name: null,
          description: null,
          displacedSkillId: null,
        }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows the displaced-skill note when displacedSkillId is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{
          ...decision,
          displacedSkillId: "displaced-skill-id-12345",
        }}
      />,
    );

    expect(screen.getByText(/Displaced skill:/i).textContent).toContain(
      "displace",
    );
  });
});
