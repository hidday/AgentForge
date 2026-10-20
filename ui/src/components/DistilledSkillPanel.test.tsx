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

  it("shows the loading state and nothing else while loading is true", () => {
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

  it("shows an error message and suppresses the panel content when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        error="Failed to load skill data"
      />,
    );

    expect(screen.getByText("Failed to load skill data")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("falls back through name/description sources when the skill document lacks its own name and description", () => {
    const bareSkill: SkillDocument = {
      ...skill,
      name: null,
      description: null,
    };

    render(
      <DistilledSkillPanel
        distilledSkill={bareSkill}
        distillationDecision={decision}
      />,
    );

    // Falls back to distillationDecision.name.
    expect(screen.getByText("dev-env-pause-resume-footguns")).toBeDefined();
    // Falls back to distillationDecision.description; the export preview
    // (which requires both distilledSkill and a resolved skillDescription)
    // still renders using that fallback description.
    expect(screen.getByText(/SKILL.md export preview/i)).toBeDefined();
  });

  it("falls all the way back to 'distilled-skill' and omits description/export preview when no name or description is available anywhere", () => {
    const bareDecision: DistillationDecision = {
      ...decision,
      name: null,
      description: null,
      taskCategory: null,
    };

    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={bareDecision}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
    expect(screen.queryByText(/dev-env pause\/resume tooling/)).toBeNull();
  });

  it("renders the displaced skill id when the distillation decision reports one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-123" }}
      />,
    );

    const displacedText = screen.getByText(/Displaced skill:/);
    expect(displacedText.textContent).toBe("Displaced skill: old-skil");
  });
});
