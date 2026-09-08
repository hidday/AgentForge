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
  it("renders a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    // Should not attempt to render skill content while loading.
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders an error message when error is set, taking precedence over loading/decision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
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

  it("shows a fallback message when persistence succeeded but content is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
  });

  it("falls back to distillationDecision.name when distilledSkill.name is absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null }}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText(decision.name!)).toBeDefined();
  });

  it("falls back to distilledSkill.taskCategory when both name fields are absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "fallback-task-category" }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );

    // Renders twice: once as the resolved skillName, once as the taskCategory line.
    expect(screen.getAllByText("fallback-task-category").length).toBe(2);
  });

  it("falls back to distillationDecision.taskCategory when distilledSkill is null and decision.name is absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: "decision-task-category" }}
      />,
    );

    // Renders twice: once as the resolved skillName, once as the taskCategory line.
    expect(screen.getAllByText("decision-task-category").length).toBe(2);
  });

  it("falls back to the literal 'distilled-skill' name when every name/category source is absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("falls back to distillationDecision.description when distilledSkill.description is absent", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={decision}
      />,
    );

    expect(screen.getAllByText(decision.description!).length).toBeGreaterThan(0);
  });

  it("omits the description paragraph and export preview when no description source is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    // No description text anywhere, and the export preview block (which
    // requires both distilledSkill and a resolved skillDescription) is absent.
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
    // distilledSkill is still truthy (markdown still renders) but
    // skillDescription is falsy, so the `distilledSkill && skillDescription`
    // guard must be false — the export preview stays hidden.
    expect(screen.getByTestId("markdown-content")).toBeDefined();
  });

  it("shows a truncated displaced skill id when distillationDecision.displacedSkillId is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "abcdef1234567890" }}
      />,
    );

    expect(screen.getByText(/Displaced skill: abcdef12/)).toBeDefined();
  });
});
