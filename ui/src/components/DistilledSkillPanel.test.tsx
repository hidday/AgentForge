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

  it("shows a loading state when loading is true, regardless of other props", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
  });

  it("shows an error message when error is set, taking priority over loading being false", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });

  it("renders nothing when distillationDecision is null and there is no loading/error state", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );
    expect(container.firstChild).toBeNull();
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

  it("falls back to the literal 'distilled-skill' name when no name or taskCategory is available anywhere", () => {
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
  });

  it("falls back to distillationDecision.taskCategory for the name when no name is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null }}
      />,
    );

    // Same string renders twice: once as the skill name, once as the category line.
    expect(screen.getAllByText("dev-env pause/resume tooling").length).toBe(2);
  });

  it("falls back to distilledSkill.taskCategory for the name when no name is set on either side", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null }}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getAllByText(skill.taskCategory).length).toBe(2);
  });

  it("renders a truncated displaced skill id when one is present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "0123456789abcdef" }}
      />,
    );

    expect(screen.getByText(/Displaced skill: 01234567/)).toBeDefined();
  });
});
