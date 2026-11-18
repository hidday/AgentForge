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
  it("shows a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading={true} />,
    );
    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });

  it("shows an error message when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load skill"
      />,
    );
    expect(screen.getByText("Failed to load skill")).toBeDefined();
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

  it("renders nothing when neither loading, error, decision, nor skill are provided", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("prioritizes the loading indicator over an error when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="Some error"
      />,
    );
    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
    expect(screen.queryByText("Some error")).toBeNull();
  });

  it("shows the displaced skill id (truncated) when the decision carries one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{
          ...decision,
          displacedSkillId: "abcdefgh-1234-5678",
        }}
      />,
    );
    expect(screen.getByText(/Displaced skill:/)).toBeDefined();
    expect(screen.getByText(/abcdefgh/)).toBeDefined();
  });

  it("falls back to the skill's taskCategory for the heading when both names are null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    // skillName falls back to distilledSkill.taskCategory; it's rendered both
    // as the heading and (separately) as the subtitle, so expect 2 matches.
    expect(screen.getAllByText(skill.taskCategory).length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the generic 'distilled-skill' heading when no name or category is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          taskCategory: null,
          description: null,
        }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
    // No skillDescription and no distilledSkill -> no export preview block
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });
});
